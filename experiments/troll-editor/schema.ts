import { z } from 'zod';

const seconds = z.number().finite().nonnegative();
const visual = z.enum(['clean', 'bw', 'deepfry']).default('clean');
const zoom = z.number().finite().min(1).max(1.3).default(1);
const clip = z.object({
  kind: z.literal('clip'), start: seconds, end: seconds,
  speed: z.number().finite().min(0.5).max(3).default(1), visual, zoom,
}).strict();
const freeze = z.object({
  kind: z.literal('freeze'), at: seconds,
  duration: z.number().finite().min(0.15).max(2), visual, zoom,
}).strict();
const narrativeBeats = z.object({
  candidates: z.array(z.object({ sourceAt: seconds, significance: z.string().min(10).max(400), rank: z.number().int().min(1).max(8) }).strict()).min(2).max(8),
  setup: z.object({ sourceAt: seconds, description: z.string().min(10).max(400) }).strict(),
  escalation: z.object({ sourceAt: seconds, description: z.string().min(10).max(400) }).strict(),
  climax: z.object({ segmentIndex: z.number().int().nonnegative(), sourceAt: seconds, outputAt: seconds, visualSegmentIndex: z.number().int().nonnegative(), punchIndex: z.number().int().nonnegative(), reason: z.string().min(20).max(600) }).strict(),
  result: z.object({ sourceAt: seconds, description: z.string().min(10).max(400) }).strict(),
  tailReason: z.string().min(20).max(500),
  latePayoffException: z.string().max(500),
}).strict();

/** Closed edit language: agents supply values, never shell or filter expressions. */
export const EditPlanSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  title: z.string().min(1).max(100),
  style: z.enum(['troll-freeze', 'ironic-fail', 'velocity']),
  sourcePath: z.string().min(1),
  sourceCrop: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional(),
  audioCatalogPath: z.string().min(1).optional(),
  narrativeBeats: narrativeBeats.optional(),
  segments: z.array(z.discriminatedUnion('kind', [clip, freeze])).min(1).max(32),
  captions: z.array(z.object({
    start: seconds, end: seconds, text: z.string().trim().min(1).max(72),
    position: z.enum(['top', 'bottom']).default('top'), emphasis: z.boolean().default(false),
  }).strict()).max(24).default([]),
  stickers: z.array(z.object({
    start: seconds, end: seconds, asset: z.literal('reaction'),
    x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
    size: z.number().finite().min(0.1).max(0.55),
  }).strict()).max(12).default([]),
  faceAttachments: z.array(z.object({
    segmentIndex: z.number().int().nonnegative(), asset: z.literal('reaction'),
    coordinateSpace: z.literal('output-pixels'),
    headBox: z.object({ x: seconds, y: seconds, width: z.number().finite().min(12).max(250), height: z.number().finite().min(12).max(250) }).strict(),
    scale: z.number().finite().min(0.9).max(1.5).default(1.15),
    rotationDegrees: z.number().finite().min(-180).max(180).default(0),
    evidence: z.string().min(20).max(800),
  }).strict()).max(4).default([]),
  punches: z.array(z.object({
    at: seconds, duration: z.number().finite().min(0.05).max(0.6),
    strength: z.number().finite().min(0).max(1),
  }).strict()).max(16).default([]),
  soundCues: z.array(z.object({
    at: seconds, kind: z.enum(['impact', 'record-stop', 'whoosh', 'ping']),
    assetId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).optional(),
    sourceStart: seconds.default(0), duration: z.number().finite().min(0.05).max(12).optional(),
    gainDb: z.number().finite().min(-36).max(0).default(-6),
  }).strict()).max(20).default([]),
  music: z.object({
    asset: z.enum(['troll', 'ironic', 'velocity']), dropAt: seconds,
    assetId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).optional(),
    sourceStart: seconds.default(0),
    leadInSeconds: seconds.max(30).default(0),
    leadInGainDb: z.number().finite().min(-36).max(0).default(-22),
    gainDb: z.number().finite().min(-36).max(0).default(-9),
  }).strict(),
  rationale: z.string().min(1).max(3000),
}).strict();

export type EditPlan = z.infer<typeof EditPlanSchema>;
// Structured Outputs requires every property to be required. Local legacy
// validation remains permissive for immutable v1 plans; revised agent jobs use
// this fully specified catalog contract.
const cueSchema=EditPlanSchema.shape.soundCues.unwrap().element;
export const RevisedAgentPlanSchema=EditPlanSchema.omit({narrativeBeats:true}).extend({
  sourceCrop:EditPlanSchema.shape.sourceCrop.unwrap(),
  audioCatalogPath:EditPlanSchema.shape.audioCatalogPath.unwrap(),
  music:EditPlanSchema.shape.music.extend({assetId:EditPlanSchema.shape.music.shape.assetId.unwrap()}),
  soundCues:z.array(cueSchema.extend({assetId:cueSchema.shape.assetId.unwrap(),duration:cueSchema.shape.duration.unwrap()})).max(20).default([]),
});
export const ClimaxAgentPlanSchema=RevisedAgentPlanSchema.extend({narrativeBeats});
export const LegacyAgentPlanSchema=EditPlanSchema.omit({sourceCrop:true,audioCatalogPath:true,narrativeBeats:true}).extend({
  music:EditPlanSchema.shape.music.omit({assetId:true}),
  soundCues:z.array(cueSchema.omit({assetId:true,duration:true})).max(20).default([]),
});
export type Segment = EditPlan['segments'][number];
export interface SegmentMapping {
  index: number; kind: Segment['kind']; sourceStart: number; sourceEnd: number;
  outputStart: number; outputEnd: number; speed: number; visual: Segment['visual']; zoom: number;
}

export function segmentDuration(segment: Segment): number {
  const value = segment.kind === 'clip' ? (segment.end - segment.start) / segment.speed : segment.duration;
  return Math.round(value * 30) / 30;
}

export function buildTimeline(plan: EditPlan): SegmentMapping[] {
  let outputStart = 0;
  return plan.segments.map((segment, index) => {
    const outputEnd = outputStart + segmentDuration(segment);
    const mapping = { index, kind: segment.kind,
      sourceStart: segment.kind === 'clip' ? segment.start : segment.at,
      sourceEnd: segment.kind === 'clip' ? segment.end : segment.at,
      outputStart, outputEnd, speed: segment.kind === 'clip' ? segment.speed : 0,
      visual: segment.visual, zoom: segment.zoom };
    outputStart = outputEnd;
    return mapping;
  });
}

export function musicWindow(plan:EditPlan,duration:number):{sourceStart:number;outputStart:number;duration:number;sourceDrop:number;outputDrop:number}{
  const outputStart=plan.music.dropAt-plan.music.leadInSeconds;
  return {sourceStart:plan.music.sourceStart-plan.music.leadInSeconds,outputStart,duration:duration-outputStart,sourceDrop:plan.music.sourceStart,outputDrop:plan.music.dropAt};
}

export function validateEditPlan(input: unknown, sourceDuration: number): { plan: EditPlan; timeline: SegmentMapping[]; duration: number } {
  const plan = EditPlanSchema.parse(input);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('Source must have a finite positive duration');
  for (const segment of plan.segments) {
    if (segment.kind === 'clip') {
      if (segment.end <= segment.start || segment.end > sourceDuration + 1e-6) throw new Error('Clip lies outside source duration or has reversed bounds');
      if (segmentDuration(segment) < 1 / 30) throw new Error('Clip has no output frames');
    } else if (segment.at >= sourceDuration - 1 / 30) throw new Error('Freeze timestamp must leave a source frame to decode');
  }
  const timeline = buildTimeline(plan), duration = timeline.at(-1)!.outputEnd;
  if (duration < 3 || duration > 45) throw new Error('Experiment edits must last between 3 and 45 seconds');
  for (const [kind,cues] of [['caption',plan.captions],['sticker',plan.stickers]] as const) for (const [index,cue] of cues.entries()) {
    if (cue.end <= cue.start || cue.end > duration + 1e-6) throw new Error(`Caption/sticker has invalid output timing: ${kind}[${index}] spans ${cue.start}–${cue.end}s; quantized output duration is ${duration}s`);
  }
  for (const caption of plan.captions) {
    if (caption.end - caption.start < 0.6) throw new Error('Caption needs at least 0.6 seconds reading time');
    if (caption.text.split(/\s+/u).length > 12 || caption.text.split(/\s+/u).some(word => word.length > 24)) throw new Error('Caption is too dense');
  }
  for (const side of ['top', 'bottom']) {
    const captions = plan.captions.filter(caption => caption.position === side).toSorted((a, b) => a.start - b.start);
    if (captions.some((caption, i) => i > 0 && caption.start < captions[i - 1]!.end - 1e-6)) throw new Error('Captions overlap in the same position');
  }
  for (const sticker of plan.stickers) {
    const halfWidth = sticker.size / 2, halfHeight = sticker.size * 720 / 1280 / 2;
    if (sticker.x < halfWidth || sticker.x + halfWidth > 1 || sticker.y < halfHeight || sticker.y + halfHeight > 1) throw new Error('Sticker extends outside the frame');
  }
  if (plan.audioCatalogPath) {
    if (!plan.music.assetId || plan.soundCues.some(cue => !cue.assetId)) throw new Error('Catalog edits must reference real catalog music and sound IDs');
    if (plan.stickers.length) throw new Error('Revised edits must attach faces to freeze-frame head boxes, not floating stickers');
  }
  for (const attachment of plan.faceAttachments) {
    if (plan.segments[attachment.segmentIndex]?.kind !== 'freeze') throw new Error('A face attachment must target a frozen source segment');
    const { x, y, width, height } = attachment.headBox;
    if (x + width > 720 || y + height > 1280) throw new Error('Observed head box lies outside the output frame');
  }
  for (const punch of plan.punches) if (punch.at + punch.duration > duration + 1e-6) throw new Error('Punch lies outside output timeline');
  for (const cue of plan.soundCues) if (cue.at >= duration) throw new Error('Sound cue starts after output ends');
  if (plan.music.dropAt >= duration) throw new Error('Music drop must occur during the edit');
  if (plan.music.leadInSeconds > plan.music.dropAt || plan.music.leadInSeconds > plan.music.sourceStart) throw new Error('Music lead-in cannot start before output or source audio zero');
  if (plan.narrativeBeats) {
    const beats=plan.narrativeBeats, primary=beats.climax, tolerance=2/30+1e-6;
    const event=timeline[primary.segmentIndex], treatment=timeline[primary.visualSegmentIndex], punch=plan.punches[primary.punchIndex];
    if (!event || primary.sourceAt<event.sourceStart-1e-6 || primary.sourceAt>event.sourceEnd+1e-6) throw new Error('Primary climax is not inside its declared source segment');
    const mapped=event.outputStart+(event.kind==='clip'?(primary.sourceAt-event.sourceStart)/event.speed:0);
    if (Math.abs(mapped-primary.outputAt)>tolerance) throw new Error('Primary climax source/output clocks disagree');
    if (Math.abs(plan.music.dropAt-primary.outputAt)>tolerance) throw new Error('Main music drop must coincide with the declared primary climax');
    if (!treatment || treatment.visual==='clean' || Math.abs(treatment.outputStart-primary.outputAt)>tolerance) throw new Error('Primary visual change must coincide with the declared climax');
    if (!punch || Math.abs(punch.at-primary.outputAt)>tolerance || plan.punches.some(other=>other.strength>punch.strength)) throw new Error('Strongest punch must coincide with the declared primary climax');
    // Climax placement follows causal evidence, not a fixed percentage or five-second tail cap.
    // Fresh phonk jobs additionally require payoff breathing room in agent.ts; historical plans remain renderable.
    const observed=(at:number)=>timeline.some(segment=>at>=segment.sourceStart-1e-6&&at<=segment.sourceEnd+1e-6);
    if ([beats.setup.sourceAt,beats.escalation.sourceAt,beats.result.sourceAt,...beats.candidates.map(candidate=>candidate.sourceAt)].some(at=>!observed(at))) throw new Error('Narrative beat references omitted or unobserved source footage');
    if (!(beats.setup.sourceAt<=beats.escalation.sourceAt && beats.escalation.sourceAt<=primary.sourceAt && primary.sourceAt<=beats.result.sourceAt)) throw new Error('Narrative beats must follow setup, escalation, climax and result chronology');
    if (beats.candidates.filter(candidate=>candidate.rank===1).length!==1 || !beats.candidates.some(candidate=>candidate.rank===1&&Math.abs(candidate.sourceAt-primary.sourceAt)<=tolerance)) throw new Error('The top-ranked candidate must be the declared primary climax');
  }
  return { plan, timeline, duration };
}
