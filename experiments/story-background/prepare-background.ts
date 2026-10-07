import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { probeMedia } from '../../src/server/media/probe.js';
import { runProcess } from '../../src/server/media/process.js';
import { storyTools } from './render.js';
import {ProgressionReviewSchema,assertProgressionReview} from './background-quality.js';

const selectionSchema = z.object({
 gameTitle: z.string(), gameUrl: z.string(), rationale: z.string(),
 matchesExactReferenceGenre:z.boolean().default(false),progressionReview:ProgressionReviewSchema,
 clips: z.array(z.object({ path: z.string(), start: z.number().nonnegative(), end: z.number().positive(), evidence: z.string(), reason: z.string() })).min(1).max(24),
});
const [selectionPath, outputDirectory] = process.argv.slice(2);
if (!selectionPath || !outputDirectory) throw new Error('Usage: prepare-background.ts REVIEWED_SELECTION.json NEW_OUTPUT_DIR');
const selectionText = await readFile(resolve(selectionPath), 'utf8');
const selection = selectionSchema.parse(JSON.parse(selectionText));
if(selection.clips.some(c=>c.end<=c.start))throw new Error('Selected clip has reversed bounds');
assertProgressionReview(selection.progressionReview,selection.clips.reduce((sum,c)=>sum+Math.floor((c.end-c.start)*30+1e-6)/30,0));
const output = resolve(outputDirectory); await mkdir(output);
const tools = storyTools();
const ffmpeg = tools.ffmpegPath!;
const hashes = new Map<string, string>();
const ranges = new Map<string, Array<[number, number]>>();
const timeline = [];
let frameCursor = 0;
for (const [index, clip] of selection.clips.entries()) {
 const path = resolve(clip.path);
 const source = await probeMedia(path, tools);
 if (!source.video || source.video.width !== 720 || source.video.height !== 1280 || clip.end <= clip.start || clip.end > source.durationSeconds) throw new Error('Selected native clip is invalid or outside its actual source');
 let sha256 = hashes.get(path);
 if (!sha256) { sha256 = createHash('sha256').update(await readFile(path)).digest('hex'); hashes.set(path, sha256); }
 const previous = ranges.get(sha256) ?? [];
 if (previous.some(([start, end]) => clip.start < end && clip.end > start)) throw new Error('Selected montage repeats source frames');
 previous.push([clip.start, clip.end]); ranges.set(sha256, previous);
 const frames = Math.floor((clip.end - clip.start) * 30 + 1e-6);
 if (frames < 3) throw new Error('Selected clip has fewer than three frames');
 const filename = `clip-${String(index).padStart(2, '0')}.mp4`;
 await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-ss', String(clip.start), '-i', path, '-an', '-vf', 'setpts=PTS-STARTPTS,fps=30,setsar=1', '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', filename], { cwd: output, timeoutMs: 120_000 });
 timeline.push({ sourcePath: path, sourceSha256: sha256, sourceStart: clip.start, sourceEnd: clip.start + frames / 30, speed: 1, outputStart: frameCursor / 30, outputEnd: (frameCursor + frames) / 30, frames, evidence: clip.evidence, reason: clip.reason, file: filename });
 frameCursor += frames;
}
await writeFile(join(output, 'clips.txt'), timeline.map(clip => `file '${clip.file}'`).join('\n'));
await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', 'clips.txt', '-c', 'copy', '-movflags', '+faststart', 'source.mp4'], { cwd: output, timeoutMs: 120_000 });
const sourcePath = join(output, 'source.mp4');
const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
const media = await probeMedia(sourcePath, tools);
const provenance = { createdAt: new Date().toISOString(), selectionPath: resolve(selectionPath), selectionSha256: createHash('sha256').update(selectionText).digest('hex'), selection, timeline, sourcePath, sourceSha256, media, classification: selection.clips.length===1?'Single selected native gameplay interval':'Montage of reviewed progressing gameplay sections; not one continuous run', repeatedSourceFrames: false, gameplaySpeed: 1, gameAudioDiscarded: true };
await writeFile(join(output, 'provenance.json'), JSON.stringify(provenance, null, 2));
await writeFile(join(output, 'background.json'), JSON.stringify({ sourcePath, sourceSha256, gameTitle: selection.gameTitle, matchesExactReferenceGenre: selection.matchesExactReferenceGenre, progressionReview: selection.progressionReview, genreLimit: `${provenance.classification}. ${selection.rationale} Original-source timing and hashes are preserved in ${join(output, 'provenance.json')}.`, segments: [{ sourceStart: 0, sourceEnd: frameCursor / 30, speed: 1 }], crop: { x: 30, y: 0, width: 660, height: 1176 }, caption: { position: 'lower-middle', wordsPerGroup: 4, mode: 'highlight', casing: 'upper' } }, null, 2));
console.log(JSON.stringify({ sourcePath, durationSeconds: media.durationSeconds, sourceSha256 }));
