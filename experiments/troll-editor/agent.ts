import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CodexServices } from '../../src/server/providers/codex.js';
import { extractVideoFrames } from '../../src/server/media/frames.js';
import { probeMedia } from '../../src/server/media/probe.js';
import type { MediaInput } from '../../src/server/providers/inference.js';
import { ClimaxAgentPlanSchema, EditPlanSchema, LegacyAgentPlanSchema, RevisedAgentPlanSchema, buildTimeline, validateEditPlan } from './schema.js';

import { payoffEndingIssues } from './payoff-ending.js';

const here = dirname(fileURLToPath(import.meta.url));
const JobSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  style: z.enum(['troll-freeze', 'ironic-fail', 'velocity']),
  title: z.string(), sourcePath: z.string(),
  start: z.number().nonnegative(), end: z.number().positive(),
  fps: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(4),
  observationWindows: z.array(z.object({ start:z.number().nonnegative(),end:z.number().positive(),fps:z.union([z.literal(1),z.literal(2),z.literal(4),z.literal(8)]) }).strict()).min(1).max(6).optional(),
  audioCatalogPath: z.string().optional(),
  minDuration:z.number().min(3).max(45).optional(),maxDuration:z.number().min(3).max(45).optional(),
  requireNarrativeBeats:z.boolean().optional(),
  brief: z.string(),
}).strict();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const jobPath = arg('--job'), outPath = arg('--out');
  if (!jobPath || !outPath) throw new Error('Usage: node --import tsx experiments/troll-editor/agent.ts --job JOB.json --out NEW_DIRECTORY [--feedback REVIEW.txt]');
  const job = JobSchema.parse(JSON.parse(await readFile(resolve(jobPath), 'utf8')));
  const sourcePath = resolve(job.sourcePath), output = resolve(outPath);
  const info = await probeMedia(sourcePath);
  if (!info.video || job.start >= job.end || job.end > info.durationSeconds) throw new Error('Invalid observed source window');
  const observationWindows=job.observationWindows??[{start:job.start,end:job.end,fps:job.fps}];
  if(observationWindows.some(window=>window.start<job.start||window.end>job.end||window.start>=window.end)||observationWindows.reduce((sum,window)=>sum+(window.end-window.start)*window.fps,0)>120)throw new Error('Use bounded valid observation windows totaling at most 120 sampled frames');
  // Every run is immutable. A revised brief/feedback needs a new directory.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const [system, style, references, sourceHash, feedback] = await Promise.all([
    readFile(resolve(here, 'prompts/system.md'), 'utf8'),
    readFile(resolve(here, `styles/${job.style}.md`), 'utf8'),
    readFile(resolve(here, 'prompts/reference-guidance.md'), 'utf8'),
    sha256(sourcePath),
    arg('--feedback') ? readFile(resolve(arg('--feedback')!), 'utf8') : Promise.resolve(''),
  ]);
  const sampled=[];
  for(const [index,window]of observationWindows.entries())sampled.push(await extractVideoFrames(sourcePath,resolve(output,`source-frames-${index}`),{fps:window.fps,start_offset:`${window.start}s`,end_offset:`${window.end}s`}));
  const frames={sourcePath,startSeconds:job.start,endSeconds:job.end,windows:sampled,frames:sampled.flatMap(window=>window.frames)};
  const observed = frames.frames.map((frame, index) => `Image ${index + 1}: source ${frame.sourceSeconds.toFixed(6)}s.`).join('\n');
  const catalog=job.audioCatalogPath?JSON.parse(await readFile(resolve(job.audioCatalogPath),'utf8')):null;
  const contract = `Renderer contract: version=1; sourcePath must equal supplied absolute path. Clip output duration=(end-start)/speed, each rounded to nearest 1/30s; freeze duration similarly rounded. Visual clean/bw/deepfry. Zoom=1 protects HUD. Optional sourceCrop uses source pixels; use {x:30,y:0,width:660,height:1176} on these720x1280 captures to remove only platform side/footer chrome. This crop maps source head boxes to720x1280 output with x=(sourceX-30)*1.0884+0.8, y=sourceY*1.0884, sizes*=1.0884 when zoom=1. Captions top y225 or bottom y1085, >=0.6s, <=12words; prefer2–5words. DO NOT add game names or watermarks. stickers MUST be empty. faceAttachments may target ONLY a freeze segmentIndex; coordinateSpace='output-pixels'; headBox{x,y,width,height} must tightly describe the actual character HEAD in that exact frozen frame after crop/zoom. asset='reaction', scale=1.1–1.25, rotationDegrees follows the head's visible rotation, evidence explains raw source position and transformed output box. Use an exact supplied observed timestamp for the freeze. No face over moving footage; omit face if uncertain. A face is composited before shake, keeping it attached. No generic empty-sky stickers. music.asset stays troll/ironic/velocity as style label but assetId selects an actual supplied catalog ID, sourceStart is the chosen source drop offset, dropAt is the matching output drop time. music.leadInSeconds defaults0 and can include genuine preceding music: excerpt starts at sourceStart-leadInSeconds and output dropAt-leadInSeconds, preserving the true marked drop. Must be <=sourceStart and <=dropAt. leadInGainDb controls quieter pre-drop volume; gainDb controls post-drop. Prefer real lead-in rather than silence for a longer edit. SoundCues kind remains impact/record-stop/whoosh/ping as descriptive label; assetId selects real sound, sourceStart default0, optional duration trims it. Catalog edits disable every synthesized tone/riser; choose real source assets only. Gain range-36..0dB, prefer music-12, cues-8. Include audioCatalogPath exactly from job. Preserve calm readable setup, action and payoff across15–25seconds if requested; remove actual idle gaps, never stretch idle to hit runtime. Every source timestamp must be inside one supplied observation window, with monotonically forward gameplay. Freeze may hold preceding source moment. Target output ${job.minDuration??3}–${job.maxDuration??45}seconds. Rationale<=3000chars. Fresh troll-freeze and ironic-fail catalog edits need at least4seconds after the main drop, including2seconds of moving aftermath; aim4–6seconds, let the key drop hit resolve, and choose the endpoint from reviewed audio timing. A deliberate aligned face hold of1–2seconds is welcome (single-freeze maximum2s). Music already fades over its final0.3seconds: source end=music.sourceStart+total output duration-music.dropAt. Record the source endpoint/fade interval and audition status in the rationale; do not add new fade fields or place a fresh SFX in the fade. No publication.`;
  const narrativeContract=job.requireNarrativeBeats?`NARRATIVE VALIDATION: Supply narrativeBeats with 2–8 ranked candidates (unique rank1 is the primary event), setup, escalation, climax and result plus tailReason and latePayoffException. All sourceAt values must be in retained footage. Climax.segmentIndex identifies the segment containing the primary source frame; outputAt must map through that segment within2/30seconds. visualSegmentIndex identifies a bw/deepfry segment START at that same output instant. punchIndex identifies the strongest punch, also at that instant. music.dropAt must agree within2/30seconds. You may show explosion contact in bw, then freeze a later visible head frame; the primary anchor remains the explosion onset. Rank1 sourceAt must agree with climax.sourceAt within2/30seconds. Choose the strongest actual event after a meaningful build, without a fixed percentage rule. Let the drop play for roughly4–6seconds with real aftermath and a complete reviewed musical phrase; fresh phonk jobs require at least4seconds after dropAt including at least2seconds of moving footage. Do not move the drop to a weaker earlier event or pad idle footage to pass. A purposeful1–2second aligned face hold can let the drop land; preserve the real consequence before or after it. Select enough aftermath and choose the endpoint where the key drop hit has resolved, using the existing final0.3second music fade rather than an abrupt cutoff. Explain the music-source endpoint, fade interval, hold timing and listening-review status in tailReason; latePayoffException is retained for compatibility and may be empty.`:'';
  const prompt = `${system}\n\n${style}\n\n${references}\n\n${contract}\n\n${narrativeContract}\n\nJOB\n${JSON.stringify({ ...job, sourcePath, sourceInfo: info, sourceSha256: sourceHash }, null, 2)}\n\nREAL AUDIO CATALOG\n${JSON.stringify(catalog)}\n\nSOURCE FRAME TIMESTAMPS\n${observed}\n\n${feedback ? `REVIEW FEEDBACK FOR THIS NEW REVISION\n${feedback}\n` : ''}Choose the edit yourself from the evidence and return complete executable JSON. Keep id,title,style,sourcePath equal to job values.`;
  const request = {
    createdAt: new Date().toISOString(), provider: 'CodexServices', model: 'default',
    job: { ...job, sourcePath }, sourceSha256: sourceHash, sourceInfo: info,
    systemPromptSha256: createHash('sha256').update(system).digest('hex'),
    stylePromptSha256: createHash('sha256').update(style).digest('hex'),
    referencePromptSha256: createHash('sha256').update(references).digest('hex'),
    frameCount: frames.frames.length,
  };
  await Promise.all([
    writeFile(resolve(output, 'request.json'), `${JSON.stringify(request, null, 2)}\n`),
    writeFile(resolve(output, 'prompt.txt'), prompt),
    writeFile(resolve(output, 'frames.json'), `${JSON.stringify(frames, null, 2)}\n`),
  ]);
  const events: unknown[] = [];
  const provider = new CodexServices({ reasoningModel: 'default', timeoutMs: 180_000 }, event => {
    events.push(event);
    process.stderr.write(`${JSON.stringify(event)}\n`);
  });
  const media: MediaInput[] = await Promise.all(frames.frames.map(async frame => ({
    type: 'image' as const, mime_type: 'image/jpeg' as const, data: (await readFile(frame.path)).toString('base64'),
  })));
  try {
    let currentPrompt = prompt;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const generated = EditPlanSchema.parse(await provider.json(currentPrompt, job.requireNarrativeBeats ? ClimaxAgentPlanSchema : job.audioCatalogPath ? RevisedAgentPlanSchema : LegacyAgentPlanSchema, media));
      await writeFile(resolve(output, `response-attempt-${attempt}.json`), `${JSON.stringify(generated, null, 2)}\n`);
      try {
        if (generated.sourcePath !== sourcePath || generated.id !== job.id || generated.style !== job.style || generated.title !== job.title) throw new Error('Agent changed immutable job identity or source');
        let previousSource = job.start;
        for (const segment of generated.segments) {
          const start = segment.kind === 'clip' ? segment.start : segment.at;
          const end = segment.kind === 'clip' ? segment.end : segment.at;
          if (start < job.start || end > job.end) throw new Error('Agent used footage outside its observed window');
          if(!observationWindows.some(window=>start>=window.start&&end<=window.end))throw new Error('Agent used an unobserved idle gap between supplied windows');
          if (start < previousSource - 0.26) throw new Error('Agent reversed or replayed source chronology without labeling');
          previousSource = end;
        }
        const validation = validateEditPlan(generated, info.durationSeconds);
        if(job.audioCatalogPath){const endingIssues=payoffEndingIssues(validation.plan);if(endingIssues.length)throw new Error(endingIssues.join('; '));}
        if(validation.duration<(job.minDuration??3)||validation.duration>(job.maxDuration??45))throw new Error('Agent did not meet the requested meaningful duration range');
        if(job.audioCatalogPath&&generated.audioCatalogPath!==resolve(job.audioCatalogPath))throw new Error('Agent changed the reviewed audio catalog');
        await writeFile(resolve(output, 'plan.json'), `${JSON.stringify(validation.plan, null, 2)}\n`);
        await writeFile(resolve(output, 'validation.json'), `${JSON.stringify({ attempt, duration: validation.duration, timeline: validation.timeline, sourceWindow: [job.start, job.end], sourceSha256: sourceHash, validatedAt: new Date().toISOString() }, null, 2)}\n`);
        process.stdout.write(`${resolve(output, 'plan.json')}\n`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeFile(resolve(output, `validation-error-attempt-${attempt}.json`), `${JSON.stringify({ message }, null, 2)}\n`);
        if (attempt === 2) throw error;
        const computedTimeline=buildTimeline(generated);
        currentPrompt = `${prompt}\n\nThe preceding draft failed deterministic validation: ${message}\nExact renderer-computed timeline (use this, not prose arithmetic):\n${JSON.stringify({duration:computedTimeline.at(-1)?.outputEnd,timeline:computedTimeline})}\nPrevious draft:\n${JSON.stringify(generated)}\nReturn a corrected COMPLETE plan. Preserve evidence-based story and repair this error. This is the only automatic repair attempt.`;
        await writeFile(resolve(output, 'repair-prompt.txt'), currentPrompt);
      }
    }
  } catch (error) {
    await writeFile(resolve(output, 'error.json'), `${JSON.stringify({ message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }, null, 2)}\n`);
    throw error;
  } finally {
    await writeFile(resolve(output, 'inference-events.json'), `${JSON.stringify(events, null, 2)}\n`);
  }
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
