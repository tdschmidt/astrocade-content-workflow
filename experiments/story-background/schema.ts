import { z } from 'zod';

const seconds = z.number().finite().nonnegative();
export const StoryPlanSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  title: z.string().trim().min(1).max(120),
  source: z.object({
    path: z.string().min(1),
    crop: z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}).strict().optional(),
    windows: z.array(z.object({
      start: seconds, end: seconds,
      speed: z.number().finite().min(0.5).max(2).default(1),
    }).strict()).min(1).max(12),
  }).strict(),
  narration: z.object({
    path: z.string().min(1), script: z.string().trim().min(20).max(16000),
    voiceLabel: z.string().trim().min(1).max(100),
    words: z.array(z.object({
      text: z.string().trim().min(1).max(50).regex(/^\S+$/u, 'Each timing entry must contain one word'),
      start: seconds, end: seconds,
    }).strict()).min(2).max(800),
    alignmentMethod: z.string().trim().min(1).max(200),
  }).strict(),
  story: z.object({
    kind: z.enum(['reddit', 'information', 'original', 'game-overview']),
    title: z.string().trim().min(1).max(200),
    permalink: z.url().regex(/^https:\/\//u).optional(),
    attribution: z.string().trim().min(1).max(80).optional(),
  }).strict(),
  caption: z.object({
    position: z.enum(['middle', 'upper-middle', 'lower-middle']).default('upper-middle'),
    wordsPerGroup: z.number().int().min(2).max(5).default(4),
    mode: z.enum(['phrase', 'highlight']).default('highlight'),
    casing: z.enum(['upper','sentence']).default('upper'),
  }).strict().default({ position: 'upper-middle', wordsPerGroup: 4, mode: 'highlight', casing:'upper' }),
  rationale: z.string().trim().min(1).max(3000),
}).strict();

export type StoryPlan = z.infer<typeof StoryPlanSchema>;
export type Word = StoryPlan['narration']['words'][number];
export interface WindowMapping {
  index: number; sourceStart: number; sourceEnd: number; speed: number;
  outputStart: number; outputEnd: number;
}
export interface PhraseGroup { words: Word[]; start: number; end: number }

/** Plan enough source frames for narration plus its final 0.3s tail; never loop. */
export function validateStoryPlan(input: unknown, sourceDuration: number, narrationDuration: number): {
  plan: StoryPlan; timeline: WindowMapping[]; duration: number; availableDuration: number;
} {
  const plan = StoryPlanSchema.parse(input);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('Source duration must be finite and positive');
  if (!Number.isFinite(narrationDuration) || narrationDuration < 5 || narrationDuration > 90) throw new Error('Narration must last 5–90 seconds');
  if (plan.story.kind === 'reddit' && !plan.story.permalink) throw new Error('A Reddit retelling requires its primary-source permalink');
  let previousEnd = 0;
  for (const word of plan.narration.words) {
    if (word.end < word.start || (word.end===word.start&&plan.caption.mode!=='phrase') || word.start < previousEnd - 1e-6 || word.end > narrationDuration + 0.04) throw new Error('Word timestamps must be nonoverlapping, ordered, and within the measured narration; zero-length provider words are phrase-only');
    previousEnd = word.end;
  }
  if(groupWords(plan.narration.words,plan.caption.wordsPerGroup).some(g=>g.words.at(-1)!.end<=g.start))throw new Error('Every caption phrase requires a positive measured speech span');
  let sourceEnd = 0;
  for (const window of plan.source.windows) {
    if (window.end <= window.start || window.end > sourceDuration + 1e-6 || (window.end - window.start) / window.speed < 1 / 30) throw new Error('Source window is reversed, too short, or outside source footage');
    if (window.start < sourceEnd - 1e-6) throw new Error('Source windows must be chronological and nonoverlapping; repeated gameplay is not permitted');
    sourceEnd = window.end;
  }
  const duration = Math.ceil((narrationDuration + 0.3 - 1e-9) * 30) / 30;
  const availableDuration = plan.source.windows.reduce((total, window) => total + Math.floor((window.end - window.start) / window.speed * 30 + 1e-7) / 30, 0);
  if (availableDuration + 1e-6 < duration) throw new Error(`Insufficient gameplay: ${availableDuration.toFixed(3)}s available, ${duration.toFixed(3)}s required; choose more source footage instead of looping`);
  let outputStart = 0;
  const timeline: WindowMapping[] = [];
  for (const [index, window] of plan.source.windows.entries()) {
    if (outputStart >= duration - 1e-6) break;
    const available = Math.floor((window.end - window.start) / window.speed * 30 + 1e-7) / 30;
    const used = Math.min(available, duration - outputStart);
    const outputEnd = outputStart + used;
    timeline.push({ index, sourceStart: window.start, sourceEnd: window.start + used * window.speed, speed: window.speed, outputStart, outputEnd });
    outputStart = outputEnd;
  }
  return { plan, timeline, duration, availableDuration };
}

/** Prefer punctuation/pause boundaries, while keeping every phrase 2–5 words. */
export function groupWords(words: readonly Word[], target = 4): PhraseGroup[] {
  if (!Number.isInteger(target) || target < 2 || target > 5 || words.length < 2) throw new Error('Caption groups need at least two words and a target of 2–5');
  const groups: Word[][] = [];
  let current: Word[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    current.push(word);
    const next = words[index + 1];
    const naturalBoundary = /[.!?;:]$/u.test(word.text) || !!(next && next.start - word.end >= 0.22);
    if (current.length >= target || (current.length >= 2 && naturalBoundary)) { groups.push(current); current = []; }
  }
  if (current.length === 1 && groups.length) {
    const previous = groups.at(-1)!;
    if (previous.length < 5) previous.push(...current);
    else { current.unshift(previous.pop()!); groups.push(current); }
  } else if (current.length) groups.push(current);
  return groups.map((group, index) => ({ words: group, start: group[0]!.start,
    end: Math.min(group.at(-1)!.end + 0.12, groups[index + 1]?.[0]?.start ?? Number.POSITIVE_INFINITY) }));
}
