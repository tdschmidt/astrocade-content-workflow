import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runProcess } from '../../src/server/media/process.js';
import { mediaExecutables, probeMedia } from '../../src/server/media/probe.js';
import { storyTools } from '../story-background/render.js';

export interface OverviewChapterSelection {
  id: string;
  shots: Array<{ start: number; end: number }>;
}

export interface OverviewShot {
  chapterId: string;
  originalStart: number;
  originalEnd: number;
  derivedStart: number;
  derivedEnd: number;
  frames: number;
}

export function mapOverviewChapters(chapters: OverviewChapterSelection[], duration: number): OverviewShot[] {
  const shots: OverviewShot[] = [];
  let previous = 0, frames = 0;
  if (!Number.isFinite(duration) || duration <= 0 || chapters.length < 2 || chapters.length > 4 ||
      new Set(chapters.map(chapter => chapter.id)).size !== chapters.length) {
    throw new Error('Overview requires 2–4 distinct chapters and finite source duration.');
  }
  for (const chapter of chapters) {
    if (!/^[a-z][a-z0-9-]{0,40}$/u.test(chapter.id) || !chapter.shots.length || chapter.shots.length > 5) {
      throw new Error('Overview chapter identity/shot count is invalid.');
    }
    for (const shot of chapter.shots) {
      const count = Math.floor((shot.end - shot.start) * 30 + 1e-6);
      if (!Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.start < previous - 1e-6 ||
          shot.end > duration || count < 3) {
        throw new Error('Overview shots must be forward, unique and within original source bounds.');
      }
      shots.push({
        chapterId: chapter.id,
        originalStart: shot.start,
        originalEnd: shot.start + count / 30,
        derivedStart: frames / 30,
        derivedEnd: (frames + count) / 30,
        frames: count,
      });
      frames += count;
      previous = shot.end;
    }
  }
  return shots;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Deterministic hard cuts of model-selected shots; original source/time/hash are retained. */
export async function prepareOverviewChapters(options: {
  sourcePath: string;
  sourceSha256: string;
  chapters: OverviewChapterSelection[];
  output: string;
  signal?: AbortSignal;
}) {
  const sourcePath = resolve(options.sourcePath), output = resolve(options.output), tools = storyTools();
  if (await hashFile(sourcePath) !== options.sourceSha256) throw new Error('Original overview source hash changed.');
  const source = await probeMedia(sourcePath, tools, options.signal);
  const mapping = mapOverviewChapters(options.chapters, source.durationSeconds);
  await mkdir(output);
  const { ffmpeg } = mediaExecutables(tools), clips = [];
  for (const [index, shot] of mapping.entries()) {
    const filename = `clip-${String(index).padStart(2, '0')}.mp4`, path = join(output, filename);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-ss', String(shot.originalStart), '-i', sourcePath,
      '-an', '-vf', 'setpts=PTS-STARTPTS,fps=30,setsar=1', '-frames:v', String(shot.frames),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', filename,
    ];
    await runProcess(ffmpeg, args, { cwd: output, timeoutMs: 120_000, signal: options.signal });
    clips.push({ ...shot, filename, path, sha256: await hashFile(path), command: [ffmpeg, ...args] });
  }
  await writeFile(join(output, 'concat.txt'), clips.map(clip => `file '${clip.filename}'`).join('\n') + '\n', { flag: 'wx' });
  const path = join(output, 'selected-source.mp4');
  await runProcess(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', 'concat.txt',
    '-an', '-vf', 'setpts=N/(30*TB)', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000', '-movie_timescale', '90000', '-movflags', '+faststart', path,
  ], { cwd: output, timeoutMs: 120_000, signal: options.signal });
  const media = await probeMedia(path, tools, options.signal), sourceSha256 = await hashFile(path);
  const duration = mapping.at(-1)!.derivedEnd;
  if (Math.abs(media.durationSeconds - duration) > 1e-6) {
    throw new Error(`Derived overview source timing ${media.durationSeconds}s differs from its original-source map ${duration}s.`);
  }
  const provenancePath = join(output, 'provenance.json');
  await writeFile(provenancePath, JSON.stringify({
    version: 1,
    originalSourcePath: sourcePath,
    originalSourceSha256: options.sourceSha256,
    sourcePath: path,
    sourceSha256,
    durationSeconds: media.durationSeconds,
    mapping,
    clips,
    selection: options.chapters,
    policy: 'Fresh editorial-agent choices, deterministic forward hard cuts; no loop, frozen frame, reordering or generated gameplay. Original-source provenance remains attached to every derived frame interval. Each shot is rounded down to whole 30fps frames, removing less than one frame at its end.',
  }, null, 2) + '\n', { flag: 'wx' });
  return { path, sourceSha256, durationSeconds: media.durationSeconds, mapping, provenancePath };
}
