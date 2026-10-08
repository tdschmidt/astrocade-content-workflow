import type { FootageAnalysis } from '../shared/domain.js';
import { z } from 'zod';
import { validateEditPlan, type EditPlan } from '../../experiments/troll-editor/schema.js';

import { payoffEndingIssues } from '../../experiments/troll-editor/payoff-ending.js';

export interface EvidenceWindow {
  id: string;
  start: number;
  end: number;
  basis: 'core-analysis' | 'feedback-search-lead' | 'source-review';
  /** Prior analysis covers these bounds only; surrounding context is new. */
  analyzedBounds?: { start: number; end: number };
  observation: string;
}

/** Explicit source review replaces automatic candidates; fresh decoding still proves the edit. */
export function reviewedWindows(input: unknown, sourceSha256: string, duration: number): EvidenceWindow[] {
  const supplied = z.object({
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceReview: z.string().trim().min(1).max(2000),
    windows: z.array(z.object({
      start: z.number().nonnegative(), end: z.number().positive(), observation: z.string().trim().min(1).max(2000),
    }).strict()).min(1).max(10),
  }).strict().parse(input);
  if (supplied.sourceSha256 !== sourceSha256) throw new Error('Reviewed windows belong to a different source hash.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Source duration must be finite and positive.');
  return supplied.windows.map((window, index) => {
    if (window.end <= window.start || window.end > duration || window.end - window.start > 30) throw new Error('Reviewed window must be nonempty, within the source, and at most 30 seconds.');
    return { id: `source-review-${index + 1}`, ...window, basis: 'source-review' as const };
  }).sort((a, b) => a.start - b.start);
}

/** Controller reports locate candidates; fresh source images must verify them. */
export function feedbackWindow(record: unknown, name: string, duration: number): EvidenceWindow | undefined {
  if (!record || typeof record !== 'object') return;
  const value = record as { observation?: unknown; elapsedMs?: unknown; sampledFrames?: Array<{ elapsedMs?: unknown }> };
  if (typeof value.observation !== 'string' || typeof value.elapsedMs !== 'number' || !Array.isArray(value.sampledFrames) || !value.sampledFrames.length) return;
  if (!/dial|watch|omnitrix|select(?:or|ion|ed)?|transform|unlock|upgrade|equip|purchase|shop|level|stage|checkpoint|victory|defeat|score|answer|quiz/iu.test(value.observation)) return;
  const times = value.sampledFrames.map(frame => frame.elapsedMs);
  if (times.some((time, i) => typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > (value.elapsedMs as number) || (i > 0 && time < (times[i - 1] as number)))) return;
  const first = times[0] as number;
  if (!Number.isFinite(value.elapsedMs) || first >= value.elapsedMs || value.elapsedMs / 1000 > duration) return;
  // The first during-action sample occurs shortly after input. Include the
  // preceding half second so an opening click/selection is not cut away.
  const start = Math.max(0, first / 1000 - 0.5), end = Math.min(duration, value.elapsedMs / 1000 + 0.5);
  if (end - start > 20) return;
  return { id: name, start, end, basis: 'feedback-search-lead', observation: value.observation.slice(0, 1200) };
}

export function collectWindows(analysis: FootageAnalysis | undefined, feedback: EvidenceWindow[], duration: number): EvidenceWindow[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Source duration must be finite and positive.');
  for (const event of analysis?.events ?? []) {
    if (!Number.isFinite(event.startSeconds) || !Number.isFinite(event.endSeconds) || event.startSeconds < 0 || event.endSeconds <= event.startSeconds || event.endSeconds > duration) throw new Error('Prior analysis event has invalid source bounds.');
  }
  const core: EvidenceWindow[] = (analysis?.events ?? []).map((event, index) => ({
    id: `event-${index + 1}`, start: Math.max(0, event.startSeconds - 0.4), end: Math.min(duration, event.endSeconds + 0.4),
    basis: 'core-analysis', analyzedBounds: { start: event.startSeconds, end: event.endSeconds }, observation: `${event.event} Evidence: ${event.evidence} Result: ${event.outcome}`,
  }));
  for (const window of core) if (!(Number.isFinite(window.start) && Number.isFinite(window.end) && window.start >= 0 && window.end > window.start && window.end <= duration && window.end - window.start <= 30)) throw new Error('Core candidate window is invalid or exceeds 30 seconds; review source analysis.');
  const supplements = feedback.filter(window => !core.some(item => window.start >= item.start && window.end <= item.end));
  const observedClauses = (window: EvidenceWindow) => window.observation.split(/[.!?;:]/u)
    .filter(clause => !/\b(?:no|not|never|without|unchanged|absent|will|would|could|may|might|should|next|goal|need|earlier|remains?|still)\b|\b(?:didn|wasn|isn)['’]t\b/iu.test(clause)).join(' ');
  const milestone = (window: EvidenceWindow) => /\blevel[\s-]*up\b|\b(?:transformed|unlocked|purchased)\b|\bpurchase\s+succeeded\b|\bupgrade\s+(?:succeeded|applied)\b|\b(?:morph|transformation)\s+effects?\b|\bcompleted\s+the\s+transformation\b/iu.test(observedClauses(window));
  const setup = supplements.find(window => /\b(?:opened|selected|equipped)\b/iu.test(observedClauses(window)));
  const spread = (items: EvidenceWindow[], limit: number) => items.length <= limit ? items : limit === 1 ? [items[0]!] : Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]!);
  // A bare level mention is often another tapping batch. Keep an observed
  // selector setup and actual changes before filling chronological coverage.
  // These priorities only locate footage; fresh images must verify the event.
  const chosen = setup ? [setup] : [];
  chosen.push(...spread(supplements.filter(window => window !== setup && milestone(window)), 4 - chosen.length));
  if (chosen.length < 4) chosen.push(...spread(supplements.filter(window => !chosen.includes(window)), 4 - chosen.length));
  return [...core, ...chosen].sort((a, b) => a.start - b.start);
}

export function samplingFps(window: EvidenceWindow): 1 | 2 | 4 | 8 {
  return ([8, 4, 2, 1] as const).find(fps => Math.ceil((window.end - window.start) * fps) <= 30) ?? 1;
}

export function validateObservedPlan(input: unknown, options: { id: string; title: string; sourcePath: string; duration: number; windows: EvidenceWindow[]; style?: EditPlan['style']; sourceCrop?: EditPlan['sourceCrop']; audioCatalogPath?: string; maxDuration?: number; minDuration?: number; requirePayoff?: boolean; frameTimes?: number[]; audioAssets?: Array<{ id: string; kind: string; durationSeconds: number }> }) {
  const checked = validateEditPlan(input, options.duration), plan = checked.plan;
  if (plan.id !== options.id || plan.title !== options.title || plan.sourcePath !== options.sourcePath || (options.style && plan.style !== options.style)) throw new Error('Edit changed immutable job identity, source or requested style.');
  if (JSON.stringify(plan.sourceCrop) !== JSON.stringify(options.sourceCrop)) throw new Error('Edit changed the recorded gameplay crop.');
  if (plan.audioCatalogPath !== options.audioCatalogPath) throw new Error('Edit changed the reviewed audio catalog.');
  if (checked.duration > (options.maxDuration ?? 15) || checked.duration < (options.minDuration ?? 3)) throw new Error(`Meme edit must be ${options.minDuration ?? 3}–${options.maxDuration ?? 15} seconds including freezes.`);
  if (options.requirePayoff) {
    if (plan.style !== 'velocity' && !plan.narrativeBeats) throw new Error('A fresh phonk edit must identify and synchronize its primary observed climax.');
    const issues = payoffEndingIssues(plan);
    if (issues.length) throw new Error(issues.join('; '));
  }
  let previous = 0;
  for (const segment of plan.segments) {
    const start = segment.kind === 'clip' ? segment.start : segment.at;
    const end = segment.kind === 'clip' ? segment.end : segment.at;
    if (!options.windows.some(window => start >= window.start - 1e-6 && end <= window.end + 1e-6)) throw new Error('A segment uses unobserved footage or bridges an unobserved gap.');
    if (segment.kind === 'freeze' && options.frameTimes && !options.frameTimes.some(time => Math.abs(time - segment.at) < 1e-6)) throw new Error('Freeze must use an exact supplied source-frame timestamp.');
    // A held sampled frame may precede the prior endpoint by one 4-FPS bucket;
    // regular clips must remain forward so the tolerance cannot replay action.
    const tolerance = segment.kind === 'freeze' ? 0.26 : 1e-6;
    if (start < previous - tolerance) throw new Error('Edit reverses or replays source chronology.');
    previous = Math.max(previous, end);
  }
  if (options.audioCatalogPath) {
    const music = options.audioAssets?.find(asset => asset.id === plan.music.assetId && asset.kind === 'music');
    if (!music || plan.music.sourceStart + checked.duration - plan.music.dropAt > music.durationSeconds + 0.03) throw new Error('Music must use an in-bounds reviewed music asset.');
    for (const cue of plan.soundCues) {
      const asset = options.audioAssets?.find(asset => asset.id === cue.assetId && asset.kind === 'sfx');
      if (!asset || cue.duration === undefined || cue.sourceStart + cue.duration > asset.durationSeconds + 0.03) throw new Error('Sound cue must use an in-bounds reviewed sound asset.');
    }
  }
  return checked;
}
