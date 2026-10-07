import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { abortError, runProcess } from './process.js';
import { ensureNewOutput, mediaExecutables, preflightMediaTools, probeMedia, promoteMedia, validateVideo, type MediaInfo, type MediaTools } from './probe.js';

export interface VideoCut {
  path: string;
  startSeconds: number;
  endSeconds: number;
  crop?: { x: number; y: number; width: number; height: number };
}

export interface CaptionCue { startSeconds: number; endSeconds: number; text: string; position?: 'upper' | 'lower' }

export interface PortraitRender {
  outputPath: string;
  cuts: VideoCut[];
  hook: string;
  attribution?: string;
  subtitles?: CaptionCue[];
  overlays?: CaptionCue[];
  narrationPath?: string;
  ffmpeg?: MediaTools;
  signal?: AbortSignal;
}

export interface RenderArtifact { path: string; durationSeconds: number; width: 1080; height: 1920; hasAudio: boolean }

export class NarrationOverrunError extends Error {
  constructor(readonly narrationSeconds: number, readonly availableSeconds: number) {
    super(`Narration is ${narrationSeconds.toFixed(2)}s, but selected footage is only ${availableSeconds.toFixed(2)}s. Shorten and regenerate the narration.`);
    this.name = 'NarrationOverrunError';
  }
}

export function validateTimeline(cuts: readonly VideoCut[], media: ReadonlyMap<string, MediaInfo>, subtitles: readonly CaptionCue[] = [], narrationSeconds?: number): number {
  if (!cuts.length) throw new Error('Select at least one source cut');
  let duration = 0;
  for (const cut of cuts) {
    const source = media.get(cut.path);
    if (!source?.video) throw new Error(`Cut source has no video: ${cut.path}`);
    if (![cut.startSeconds, cut.endSeconds].every(Number.isFinite) || cut.startSeconds < 0 || cut.endSeconds <= cut.startSeconds || cut.endSeconds > source.durationSeconds) throw new Error('Cut lies outside its source footage');
    if (cut.endSeconds - cut.startSeconds < 1 / 30) throw new Error('A cut must contain at least one output frame');
    if (cut.crop) {
      const { x, y, width, height } = cut.crop;
      if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > source.video.width || y + height > source.video.height) throw new Error('Crop lies outside its source footage');
    }
    duration += cut.endSeconds - cut.startSeconds;
  }
  if (narrationSeconds !== undefined && (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0)) throw new Error('Narration has no usable duration');
  if (narrationSeconds !== undefined && narrationSeconds > duration) throw new NarrationOverrunError(narrationSeconds, duration);
  validateOverlayCues(subtitles, duration);
  return duration;
}

function assTime(seconds: number): string {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, '0')}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}

function literalText(text: string): string {
  // ASS braces/backslashes introduce styling commands; keep user text literal.
  return text.replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝').trim().replace(/\s+/gu, ' ');
}

function textWidth(text: string, size: number): number {
  // Conservative Noto Sans width budget; explicit line breaks prevent libass
  // from reflowing an otherwise valid short phrase into an extra line.
  return [...text].reduce((width, character) => width + size * (
    /[MWmw@%]/u.test(character) ? 1.06 : /[ilI1.,:'!| ]/u.test(character) ? 0.4 :
      /[A-Z]/u.test(character) ? 0.82 : /[a-z0-9]/u.test(character) ? 0.69 : 1.1
  ), 0);
}

function captionLines(text: string): string[] {
  const words = literalText(text).split(' ');
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last && textWidth(`${last} ${word}`, 64) <= 760) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

export function validateOverlayCues(cues: readonly CaptionCue[], duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Caption timeline needs a positive duration');
  let previousEnd = 0;
  for (const cue of cues) {
    if (![cue.startSeconds, cue.endSeconds].every(Number.isFinite) || cue.startSeconds < previousEnd || cue.endSeconds - cue.startSeconds < 0.8 - 1e-9 || cue.endSeconds > duration || !cue.text.trim()) throw new Error('Caption timing is invalid, overlapping, outside the video, or shorter than 0.8 seconds');
    if (cue.position !== undefined && !['upper', 'lower'].includes(cue.position)) throw new Error('Caption position must be upper or lower');
    const words = cue.text.trim().split(/\s+/u);
    const lines = captionLines(cue.text);
    if (cue.text.length > 84 || words.length > 12 || words.some(word => word.length > 22) || lines.length > 3 || lines.some(line => textWidth(line, 64) > 760)) throw new Error('Shorten caption text: at most 12 words, 84 characters, and three short lines; no word over 22 characters');
    previousEnd = cue.endSeconds;
  }
}

export function makeSubtitles(hook: string, attribution: string | undefined, cues: readonly CaptionCue[], duration: number, fontFamily: string, overlays?: readonly CaptionCue[]): string {
  if (/[\r\n,]/u.test(fontFamily) || !fontFamily.trim()) throw new Error('Invalid caption font family');
  const legacyHook: CaptionCue = { startSeconds: 0, endSeconds: Math.min(4, duration), text: hook, position: 'upper' };
  validateOverlayCues(overlays ?? [legacyHook], duration);
  if (overlays === undefined) validateOverlayCues(cues, duration);
  const schedule = overlays ?? [legacyHook, ...cues];
  // The source fills its entire fitted canvas. These are text anchors only,
  // not reserved bands. The planner chooses a position away from live HUDs.
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Overlay,${fontFamily},64,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,8,120,180,240,1\nStyle: Credit,${fontFamily},26,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,1,1,80,180,240,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const lines = schedule.map(cue => `Dialogue: 1,${assTime(cue.startSeconds)},${assTime(cue.endSeconds)},Overlay,,0,0,0,,{\\an${cue.position === 'upper' ? 8 : 2}\\pos(510,${cue.position === 'upper' ? 240 : 1536})}${captionLines(cue.text).join('\\N')}`);
  if (attribution?.trim()) {
    let credit = literalText(attribution);
    if (textWidth(credit, 26) > 820) {
      while (textWidth(`${credit}…`, 26) > 820) credit = credit.slice(0, -1);
      credit = `${credit.trimEnd()}…`;
    }
    lines.push(`Dialogue: 0,0:00:00.00,${assTime(duration)},Credit,,0,0,0,,{\\an1\\pos(80,1680)}${credit}`);
  }
  return `${header}${lines.join('\n')}\n`;
}

function makeFilter(cuts: readonly VideoCut[], narration: boolean, duration: number): string {
  const filters = cuts.map((cut, index) => {
    const crop = cut.crop ? `,crop=${cut.crop.width}:${cut.crop.height}:${cut.crop.x}:${cut.crop.y}` : '';
    return `[${index}:v]trim=start=${cut.startSeconds}:end=${cut.endSeconds},setpts=PTS-STARTPTS${crop},setsar=1,fps=30,split[bg${index}][fg${index}];\n[bg${index}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=24,eq=brightness=-0.16:saturation=0.65[blur${index}];\n[fg${index}]scale=1080:1920:force_original_aspect_ratio=decrease[sharp${index}];\n[blur${index}][sharp${index}]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1[cut${index}]`;
  });
  filters.push(`${cuts.map((_, index) => `[cut${index}]`).join('')}concat=n=${cuts.length}:v=1:a=0,subtitles=captions.ass:fontsdir=fonts,format=yuv420p[video]`);
  if (narration) filters.push(`[${cuts.length}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${duration}[audio]`);
  return filters.join(';\n');
}

export async function renderPortrait(options: PortraitRender): Promise<RenderArtifact> {
  if (options.signal?.aborted) throw abortError();
  if (!options.outputPath.endsWith('.mp4')) throw new Error('Portrait renders must use a .mp4 output path');
  await ensureNewOutput(options.outputPath);
  const tools = options.ffmpeg ?? {};
  const preflight = await preflightMediaTools(tools);
  const sources = new Map<string, MediaInfo>();
  for (const cut of options.cuts) if (!sources.has(cut.path)) sources.set(cut.path, await probeMedia(cut.path, tools, options.signal));
  const narration = options.narrationPath ? await probeMedia(options.narrationPath, tools, options.signal) : undefined;
  if (narration && !narration.audio) throw new Error('Narration file contains no audio');
  const duration = validateTimeline(options.cuts, sources, options.overlays ?? options.subtitles, narration?.durationSeconds);
  await mkdir(dirname(options.outputPath), { recursive: true });
  const directory = await mkdtemp(join(dirname(options.outputPath), '.render-'));
  const partial = join(directory, 'render.mp4');
  try {
    await mkdir(join(directory, 'fonts'));
    await copyFile(preflight.fontPath!, join(directory, 'fonts', `caption${extname(preflight.fontPath!)}`));
    await writeFile(join(directory, 'captions.ass'), makeSubtitles(options.hook, options.attribution, options.subtitles ?? [], duration, tools.fontFamily ?? process.env.FONT_FAMILY ?? 'Noto Sans', options.overlays));
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n'];
    for (const cut of options.cuts) args.push('-i', cut.path);
    if (options.narrationPath) args.push('-i', options.narrationPath);
    args.push('-filter_complex_threads', '1', '-filter_complex', makeFilter(options.cuts, !!narration, duration), '-map', '[video]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr');
    if (narration) args.push('-map', '[audio]', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
    else args.push('-an');
    args.push('-t', String(duration), '-movflags', '+faststart', partial);
    await runProcess(mediaExecutables(tools).ffmpeg, args, { cwd: directory, signal: options.signal, timeoutMs: 300_000 });
    const info = await validateVideo(partial, tools, options.signal);
    if (info.video?.width !== 1080 || info.video.height !== 1920 || info.video.codec !== 'h264' || info.video.pixelFormat !== 'yuv420p' || info.video.frameRate !== 30 || Math.abs(info.durationSeconds - duration) > 0.15) throw new Error('Rendered video failed format or duration validation');
    if (narration && (!info.audio || info.audio.codec !== 'aac' || info.audio.sampleRate !== 48000 || info.audio.channels !== 2)) throw new Error('Rendered narration failed audio validation');
    if (options.signal?.aborted) throw abortError();
    await promoteMedia(partial, options.outputPath);
    if (options.signal?.aborted) { await rm(options.outputPath, { force: true }); throw abortError(); }
    return { path: options.outputPath, durationSeconds: info.durationSeconds, width: 1080, height: 1920, hasAudio: !!narration };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
