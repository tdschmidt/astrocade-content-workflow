import { access, link, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { runProcess } from './process.js';

export interface MediaTools {
  ffmpegPath?: string;
  ffprobePath?: string;
  fontPath?: string;
  fontFamily?: string;
}

export interface MediaInfo {
  durationSeconds: number;
  sizeBytes: number;
  video?: { width: number; height: number; codec: string; pixelFormat?: string; frameRate?: number };
  audio?: { codec: string; sampleRate: number; channels: number };
}

export function mediaExecutables(tools: MediaTools = {}): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = tools.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffprobe = tools.ffprobePath ?? process.env.FFPROBE_PATH ?? (isAbsolute(ffmpeg) ? join(dirname(ffmpeg), 'ffprobe') : 'ffprobe');
  return { ffmpeg, ffprobe };
}

export async function requireLocalFile(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error(`Media paths must be absolute: ${path}`);
  if (!(await stat(path)).isFile()) throw new Error(`Not a media file: ${path}`);
}

export async function preflightMediaTools(tools: MediaTools = {}, requireCaptions = true): Promise<{ ffmpegVersion: string; ffprobeVersion: string; fontPath?: string }> {
  const { ffmpeg, ffprobe } = mediaExecutables(tools);
  const [version, probeVersion, filters] = await Promise.all([
    runProcess(ffmpeg, ['-version'], { timeoutMs: 10_000 }),
    runProcess(ffprobe, ['-version'], { timeoutMs: 10_000 }),
    runProcess(ffmpeg, ['-hide_banner', '-filters'], { timeoutMs: 10_000 }),
  ]);
  const fontPath = tools.fontPath ?? process.env.FONT_PATH;
  if (requireCaptions) {
    if (!/\bsubtitles\s+V->V\b/u.test(filters.stdout)) throw new Error('FFmpeg needs the subtitles/libass filter. Configure FFMPEG_PATH to a build with libass.');
    if (!fontPath) throw new Error('Configure FONT_PATH to the bundled caption font.');
    await requireLocalFile(fontPath);
  }
  return { ffmpegVersion: version.stdout.split('\n')[0]!, ffprobeVersion: probeVersion.stdout.split('\n')[0]!, fontPath };
}

interface ProbeResult {
  format?: { duration?: string; size?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; avg_frame_rate?: string; sample_rate?: string; channels?: number; duration?: string }>;
}

export async function probeMedia(path: string, tools: MediaTools = {}, signal?: AbortSignal): Promise<MediaInfo> {
  await requireLocalFile(path);
  const { ffprobe } = mediaExecutables(tools);
  const result = await runProcess(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { signal, timeoutMs: 20_000 });
  const data = JSON.parse(result.stdout) as ProbeResult;
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  const audio = data.streams?.find(stream => stream.codec_type === 'audio');
  let durationSeconds = Number(data.format?.duration ?? video?.duration ?? audio?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    // MediaRecorder WebM often omits duration. Derive it from presentation times.
    const packets = await runProcess(ffprobe, ['-v', 'error', '-select_streams', video ? 'v:0' : 'a:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', path], { signal, timeoutMs: 20_000 });
    const values = (JSON.parse(packets.stdout) as { packets?: Array<{ pts_time?: string; duration_time?: string }> }).packets ?? [];
    const times = values.map(packet => ({ pts: Number(packet.pts_time), duration: Number(packet.duration_time) })).filter(packet => Number.isFinite(packet.pts)).sort((a, b) => a.pts - b.pts);
    const last = times.at(-1);
    if (last) {
      const tail = times.slice(-11);
      const intervals = tail.slice(1).map((packet, index) => packet.pts - tail[index]!.pts).filter(value => value > 0).sort((a, b) => a - b);
      const finalDuration = last.duration > 0 ? last.duration : (intervals[Math.floor(intervals.length / 2)] ?? 0);
      durationSeconds = last.pts + finalDuration - Math.min(0, times[0]!.pts);
    }
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || (!video && !audio)) throw new Error('Media has no usable duration or streams');
  const [numerator, denominator] = video?.avg_frame_rate?.split('/').map(Number) ?? [];
  const frameRate = numerator && denominator ? numerator / denominator : undefined;
  return {
    durationSeconds,
    sizeBytes: Number(data.format?.size) || (await stat(path)).size,
    ...(video ? { video: { width: video.width ?? 0, height: video.height ?? 0, codec: video.codec_name ?? 'unknown', pixelFormat: video.pix_fmt, frameRate } } : {}),
    ...(audio ? { audio: { codec: audio.codec_name ?? 'unknown', sampleRate: Number(audio.sample_rate), channels: audio.channels ?? 0 } } : {}),
  };
}

export async function validateVideo(path: string, tools: MediaTools = {}, signal?: AbortSignal): Promise<MediaInfo> {
  const info = await probeMedia(path, tools, signal);
  if (!info.video || info.video.width <= 0 || info.video.height <= 0) throw new Error('Capture contains no usable video');
  await runProcess(mediaExecutables(tools).ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-i', path, '-map', '0:v:0', '-f', 'null', '-'], { signal, timeoutMs: 120_000 });
  return info;
}

export async function ensureNewOutput(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('Output path must be absolute');
  try { await access(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Output already exists: ${path}`);
}

export async function promoteMedia(partial: string, output: string): Promise<void> {
  // Hard-link creation is atomic and refuses to overwrite an immutable revision.
  await link(partial, output);
  await unlink(partial);
}
