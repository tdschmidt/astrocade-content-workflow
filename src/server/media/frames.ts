import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { mediaExecutables, probeMedia, type MediaTools } from './probe.js';
import { runProcess } from './process.js';

export interface VideoFrameProcessing { fps: 1 | 8; start_offset?: string; end_offset?: string }
export interface VideoFrames {
  sourcePath: string;
  fps: 1 | 8;
  startSeconds: number;
  endSeconds: number;
  /** Actual presentation times, never nominal frame index / requested FPS. */
  frames: Array<{ path: string; sourceSeconds: number; windowSeconds: number }>;
}

const MAX_FRAMES = 360;
function offset(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+(?:\.\d+)?s?$/.test(value)) throw new Error('Frame offsets must be nonnegative seconds, optionally suffixed with s.');
  const seconds = Number(value.replace(/s$/, ''));
  if (!Number.isFinite(seconds)) throw new Error('Frame offset is not finite.');
  return seconds;
}

/** First decoded frame in each FPS-sized bucket of [start, end); never pads gaps. */
export async function extractVideoFrames(
  path: string, outputDir: string, processing: VideoFrameProcessing, tools: MediaTools = {}, signal?: AbortSignal,
): Promise<VideoFrames> {
  signal?.throwIfAborted();
  const fps = processing.fps;
  if (fps !== 1 && fps !== 8) throw new Error('Frame sampling supports only 1 or 8 FPS.');
  const sourcePath = resolve(path), directory = resolve(outputDir);
  const startSeconds = offset(processing.start_offset, 0);
  const requestedEnd = offset(processing.end_offset, Number.NaN);
  const info = await probeMedia(sourcePath, tools, signal);
  if (!info.video) throw new Error('Frame extraction requires a video stream.');
  const endSeconds = Number.isNaN(requestedEnd) ? info.durationSeconds : requestedEnd;
  if (startSeconds >= endSeconds || endSeconds > info.durationSeconds) throw new Error('Frame window must be nonempty and lie inside the source video.');
  if (Math.ceil((endSeconds - startSeconds) * fps - 1e-9) > MAX_FRAMES) throw new Error(`Requested sampling exceeds the ${MAX_FRAMES}-frame limit; select a shorter window.`);
  await mkdir(dirname(directory), { recursive: true });
  // An exclusive directory means failed extraction can clean up only its own files.
  await mkdir(directory);
  try {
    const bucket = (time: string) => `floor((${time}-${startSeconds})*${fps}+0.000001)`;
    const filter = `settb=expr=1/1000000,trim=start=${startSeconds}:end=${endSeconds},select='if(isnan(prev_selected_t),1,gt(${bucket('t')},${bucket('prev_selected_t')}))',metadata=mode=add:key=sample:value=1,metadata=mode=print:file=timings.txt`;
    await runProcess(mediaExecutables(tools).ffmpeg, [
      // Native tab recordings can resize briefly. Reinitializing resets the
      // bucket selection and truncates timings.txt, breaking the JPEG/PTS map.
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-reinit_filter', '0', '-i', sourcePath,
      '-map', '0:v:0', '-an', '-vf', filter, '-fps_mode', 'passthrough',
      '-frames:v', String(MAX_FRAMES + 1), '-pix_fmt', 'yuvj420p', '-q:v', '3', '-start_number', '0', 'frame-%04d.jpg',
    ], { cwd: directory, signal, timeoutMs: 120_000 });
    // AVTB represents actual decoded timestamps in integer microseconds. Keeping
    // the source clock through trim avoids relabeling a late first frame as t=0.
    const metadata = await readFile(join(directory, 'timings.txt'), 'utf8');
    const timestamps = [...metadata.matchAll(/^frame:\d+\s+pts:\s*(-?\d+)\s+pts_time:/gm)].map(match => Number(match[1]) / 1_000_000);
    const files = (await readdir(directory)).filter(name => /^frame-\d{4}\.jpg$/.test(name)).sort();
    if (!timestamps.length || timestamps.length !== files.length || timestamps.length > MAX_FRAMES) throw new Error('Frame extraction did not produce a complete bounded timestamp map.');
    if (timestamps.some((time, index) => !Number.isFinite(time) || time < startSeconds || time >= endSeconds || (index > 0 && time <= timestamps[index - 1]!))) throw new Error('Extracted frames have invalid presentation timestamps.');
    signal?.throwIfAborted();
    await rm(join(directory, 'timings.txt'));
    return { sourcePath, fps, startSeconds, endSeconds, frames: files.map((file, index) => ({ path: join(directory, file), sourceSeconds: timestamps[index]!, windowSeconds: timestamps[index]! - startSeconds })) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
