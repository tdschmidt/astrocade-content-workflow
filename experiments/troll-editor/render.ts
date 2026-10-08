import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runProcess } from '../../src/server/media/process.js';
import { ensureNewOutput, mediaExecutables, preflightMediaTools, probeMedia, promoteMedia, requireLocalFile, validateVideo, type MediaInfo, type MediaTools } from '../../src/server/media/probe.js';
import { buildTimeline, musicWindow, validateEditPlan, type EditPlan, type Segment, type SegmentMapping } from './schema.js';
import { enforceEncodedAudioPeak } from './audio-peak.js';
import { sourceFreezeVideoFilter, sourceSeekArgs, sourceWindowVideoFilter } from '../../src/server/media/source-window.js';

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const num = (value: number) => Number(value.toFixed(6)).toString();
const FPS = 30, WIDTH = 720, HEIGHT = 1280;

export function experimentTools(): MediaTools {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return {
    ffmpegPath: process.env.FFMPEG_PATH ?? (existsSync(full) ? full : 'ffmpeg'),
    ffprobePath: process.env.FFPROBE_PATH,
    fontPath: resolve(process.env.FONT_PATH ?? join(experimentRoot, '../../assets/fonts/NotoSans-Regular.ttf')),
    fontFamily: process.env.FONT_FAMILY ?? 'Noto Sans',
  };
}

function assTime(seconds: number): string {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, '0')}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}

function captionText(value: string): string {
  const words = value.replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝').trim().split(/\s+/u);
  const lines: string[] = [];
  for (const word of words) {
    if (lines.length && lines.at(-1)!.length + word.length + 1 <= 25) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines.join('\\N');
}

export function makeCaptions(plan: EditPlan, fontFamily = 'Noto Sans'): string {
  if (/[\r\n,]/u.test(fontFamily)) throw new Error('Invalid font family');
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${WIDTH}\nPlayResY: ${HEIGHT}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,${fontFamily},44,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,8,55,55,100,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const events = plan.captions.map(cue => `Dialogue: 1,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,{\\an${cue.position === 'top' ? 8 : 2}\\pos(360,${cue.position === 'top' ? 225 : 1085})${cue.emphasis ? '\\c&H0036EFFF&\\fs48' : ''}\\fad(60,80)}${captionText(cue.text)}`);
  return header + events.join('\n') + '\n';
}

function tempo(speed: number): string {
  // WSOLA can move transients even at 1×; unchanged playback needs no resampling.
  if (speed === 1) return 'anull';
  return speed > 2 ? `atempo=2,atempo=${num(speed / 2)}` : `atempo=${num(speed)}`;
}

/** Rebuild timestamps after inserted silence: some FFmpeg adelay builds emit
 * NOPTS on those frames, which downstream atrim otherwise drops. */
export function delayedAudioFilter(outputSeconds: number): string {
  return `adelay=${Math.round(outputSeconds * 1000)}:all=1,asetpts=N/SR/TB`;
}

function visualFilter(segment: Segment): string {
  if (segment.visual === 'bw') return ',hue=s=0,eq=contrast=1.12:brightness=-0.02';
  if (segment.visual === 'deepfry') return ',eq=contrast=1.95:saturation=2.9:brightness=0.025,unsharp=5:5:1.7:5:5:0.8,noise=alls=7:allf=t+u:all_seed=41';
  return '';
}

export function segmentFilter(segment: Segment, mapping: SegmentMapping, sourceHasAudio: boolean, sourceCrop?: EditPlan['sourceCrop'], sourceSize?: { width: number; height: number }): string {
  const duration = mapping.outputEnd - mapping.outputStart;
  const trim = segment.kind === 'clip'
    ? sourceWindowVideoFilter(segment.end - segment.start, segment.speed)
    : sourceFreezeVideoFilter(duration);
  const enlargedW = Math.ceil(WIDTH * segment.zoom / 2) * 2, enlargedH = Math.ceil(HEIGHT * segment.zoom / 2) * 2;
  const zoom = segment.zoom > 1 ? `,scale=${enlargedW}:${enlargedH},crop=${WIDTH}:${HEIGHT}` : '';
  const crop = sourceCrop ? `,crop=${sourceCrop.width}:${sourceCrop.height}:${sourceCrop.x}:${sourceCrop.y}` : '';
  // Old browser recordings can briefly change decoded dimensions. Keep the
  // source clock, then restore the probed surface before applying its crop.
  const geometry = sourceSize ? `,scale=${sourceSize.width}:${sourceSize.height}:force_original_aspect_ratio=decrease,pad=${sourceSize.width}:${sourceSize.height}:(ow-iw)/2:(oh-ih)/2,setsar=1` : '';
  const video = `[0:v]${trim}${geometry}${crop},fps=${FPS},tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${num(duration)},setsar=1,split[background][foreground];[background]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},gblur=sigma=22,eq=brightness=-0.18:saturation=0.6[blur];[foreground]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease[sharp];[blur][sharp]overlay=(W-w)/2:(H-h)/2:shortest=1${zoom}${visualFilter(segment)},format=yuv420p[video]`;
  const audio = sourceHasAudio && segment.kind === 'clip'
    ? `[0:a]atrim=start=0:end=${num(segment.end - segment.start)},aresample=48000:async=1:first_pts=0,asetpts=N/SR/TB,${tempo(segment.speed)},aformat=channel_layouts=stereo,volume=-15dB,apad,atrim=duration=${num(duration)}[audio]`
    : `anullsrc=r=48000:cl=stereo,atrim=duration=${num(duration)}[audio]`;
  return `${video};${audio}`;
}

export function finalFilter(plan: EditPlan, duration: number, stickerInput: number | undefined, musicInput: number, cueInputs: number[]): string {
  const filters: string[] = [];
  let video = '0:v';
  const totalFaces = plan.faceAttachments.length + plan.stickers.length;
  if (stickerInput !== undefined && totalFaces) filters.push(`[${stickerInput}:v]split=${totalFaces}${Array.from({length:totalFaces},(_,index)=>`[rawface${index}]`).join('')}`);
  const timeline = buildTimeline(plan);
  plan.faceAttachments.forEach((attachment, index) => {
    const segment = timeline[attachment.segmentIndex]!;
    const { x, y, width, height } = attachment.headBox;
    const faceWidth = Math.round(width * attachment.scale / 2) * 2, faceHeight = Math.round(height * attachment.scale / 2) * 2;
    const radians = attachment.rotationDegrees * Math.PI / 180;
    filters.push(`[rawface${index}]scale=${faceWidth}:${faceHeight},format=rgba,rotate=${num(radians)}:ow=rotw(${num(radians)}):oh=roth(${num(radians)}):c=none[attachedface${index}]`);
    filters.push(`[${video}][attachedface${index}]overlay=x='${num(x+width/2)}-w/2':y='${num(y+height/2)}-h/2':enable='gte(t,${num(segment.outputStart)})*lt(t,${num(segment.outputEnd)})':shortest=1[attached${index}]`);
    video = `attached${index}`;
  });
  if (plan.punches.length) {
    const active = plan.punches.map(punch => `between(t,${num(punch.at)},${num(punch.at + punch.duration)})*${num(punch.strength)}`).join('+');
    filters.push(`[${video}]split[shakebg][shakefg];[shakebg]gblur=sigma=12[shakeblur];[shakeblur][shakefg]overlay=x='12*sin(t*77)*(${active})':y='18*cos(t*67)*(${active})':eval=frame:shortest=1[shaken]`);
    video = 'shaken';
  }
  if (stickerInput !== undefined) {
    plan.stickers.forEach((cue, index) => {
      const size = Math.round(cue.size * WIDTH / 2) * 2;
      filters.push(`[rawface${index + plan.faceAttachments.length}]scale=${size}:${size},format=rgba[face${index}]`);
      filters.push(`[${video}][face${index}]overlay=x=${Math.round(cue.x * WIDTH - size / 2)}:y=${Math.round(cue.y * HEIGHT - size / 2)}:enable='gte(t,${num(cue.start)})*lt(t,${num(cue.end)})':shortest=1[stamped${index}]`);
      video = `stamped${index}`;
    });
  }
  filters.push(`[${video}]subtitles=captions.ass:fontsdir=fonts,format=yuv420p[video]`);
  const audioLabels = ['[game]', '[music]'];
  // Keep the decoded native track on the same continuous sample clock as the
  // independently timed music and sound cues.
  filters.push(`[0:a]aresample=48000:async=1:first_pts=0,atrim=duration=${num(duration)},asetpts=N/SR/TB[game]`);
  const selectedMusic=musicWindow(plan,duration);
  const musicStartOutput = selectedMusic.outputStart;
  const musicDuration = selectedMusic.duration;
  const duckEnvelopes = plan.soundCues.map(cue => {
    const start=cue.at-musicStartOutput,end=start+(cue.duration??0.7);
    return `max(0,min(1,min((t-${num(start-0.04)})/0.04,(${num(end+0.14)}-t)/0.14)))`;
  });
  const duck=plan.audioCatalogPath&&duckEnvelopes.length?`,volume='1-0.72*min(1,${duckEnvelopes.join('+')})':eval=frame`:'';
  const musicGain=plan.music.leadInSeconds>0?`volume='if(lt(t,${num(plan.music.leadInSeconds)}),${num(10**(plan.music.leadInGainDb/20))},${num(10**(plan.music.gainDb/20))})':eval=frame`:`volume=${num(plan.music.gainDb)}dB`;
  filters.push(`[${musicInput}:a]atrim=start=${num(selectedMusic.sourceStart)}:duration=${num(musicDuration)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,${musicGain}${duck},afade=t=out:st=${num(Math.max(0, musicDuration - 0.3))}:d=0.3,${delayedAudioFilter(musicStartOutput)},apad,atrim=duration=${num(duration)}[music]`);
  if (plan.music.dropAt > 0.05 && !plan.audioCatalogPath) {
    const lead = plan.music.dropAt, riseDuration = Math.min(0.75, lead), riseStart = lead - riseDuration;
    filters.push(`sine=frequency=110:sample_rate=48000:duration=${num(lead)},aformat=channel_layouts=stereo,volume='0.3*(0.25+0.75*pow(sin(t*7.5),2))':eval=frame,afade=t=in:d=0.25,afade=t=out:st=${num(Math.max(0, lead - 0.1))}:d=0.1,apad,atrim=duration=${num(duration)}[anticipation]`);
    filters.push(`anoisesrc=color=pink:amplitude=0.08:sample_rate=48000:duration=${num(riseDuration)}:seed=1701,highpass=f=1300,afade=t=in:d=${num(riseDuration)},afade=t=out:st=${num(Math.max(0, riseDuration - 0.07))}:d=0.07,aformat=channel_layouts=stereo,${delayedAudioFilter(riseStart)},apad,atrim=duration=${num(duration)}[riser]`);
    audioLabels.push('[anticipation]', '[riser]');
  }
  plan.soundCues.forEach((cue, index) => {
    filters.push(`[${cueInputs[index]}:a]atrim=start=${num(cue.sourceStart)}${cue.duration?`:duration=${num(cue.duration)}`:''},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${num(cue.gainDb)}dB,${delayedAudioFilter(cue.at)},apad,atrim=duration=${num(duration)}[cue${index}]`);
    audioLabels.push(`[cue${index}]`);
  });
  // Leave AAC/intersample headroom on abrupt real meme transients. The encoded
  // file is still measured below; a sample limiter alone cannot prove true peak.
  filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,atrim=duration=${num(duration)},loudnorm=I=-14:TP=-2.5:LRA=9,alimiter=limit=0.7:level=false:latency=true,aresample=48000,asetpts=N/SR/TB,apad,atrim=duration=${num(duration)}[audio]`);
  return filters.join(';\n');
}

export interface RenderOptions { planPath: string; outputPath: string; assetsPath?: string; tools?: MediaTools; signal?: AbortSignal }

export async function renderEdit(options: RenderOptions): Promise<Record<string, unknown>> {
  options.signal?.throwIfAborted();
  const outputPath = resolve(options.outputPath), manifestPath = outputPath.replace(/\.mp4$/u, '.manifest.json');
  if (!outputPath.endsWith('.mp4')) throw new Error('Output must end in .mp4');
  await ensureNewOutput(outputPath);
  await ensureNewOutput(manifestPath);
  const tools = options.tools ?? experimentTools();
  const preflight = await preflightMediaTools(tools);
  const rawPlan = JSON.parse(await readFile(options.planPath, 'utf8')) as unknown;
  if (typeof rawPlan !== 'object' || rawPlan === null || !('sourcePath' in rawPlan) || typeof rawPlan.sourcePath !== 'string' || !isAbsolute(rawPlan.sourcePath)) throw new Error('sourcePath must be an absolute local path');
  const source = await probeMedia(rawPlan.sourcePath, tools, options.signal);
  if (!source.video) throw new Error('Edit source has no video stream');
  const { plan, timeline, duration } = validateEditPlan(rawPlan, source.durationSeconds);
  if (plan.sourceCrop && (plan.sourceCrop.x + plan.sourceCrop.width > source.video.width || plan.sourceCrop.y + plan.sourceCrop.height > source.video.height)) throw new Error('Source crop extends outside the recording');
  const assets = resolve(options.assetsPath ?? join(experimentRoot, 'assets'));
  let catalog: { assets: Array<{ id: string; path: string; [key: string]: unknown }> } | undefined;
  if (plan.audioCatalogPath) {
    if (!isAbsolute(plan.audioCatalogPath)) throw new Error('Audio catalog path must be absolute');
    catalog = JSON.parse(await readFile(plan.audioCatalogPath, 'utf8'));
    if (!catalog || !Array.isArray(catalog.assets) || catalog.assets.some(asset => typeof asset.id !== 'string' || typeof asset.path !== 'string' || !isAbsolute(asset.path))) throw new Error('Audio catalog needs asset IDs and absolute local paths');
  }
  const assetPath = (id: string | undefined, fallback: string): string => {
    if (!catalog) return fallback;
    const asset = catalog.assets.find(asset => asset.id === id);
    if (!asset) throw new Error(`Audio asset ID absent from reviewed catalog: ${id}`);
    return asset.path;
  };
  const musicPath = assetPath(plan.music.assetId, join(assets, `${plan.music.asset}.wav`));
  await requireLocalFile(musicPath);
  const music = await probeMedia(musicPath, tools, options.signal);
  if (!music.audio) throw new Error('Music asset has no audio stream');
  if (catalog && plan.music.sourceStart + duration - plan.music.dropAt > music.durationSeconds) throw new Error('Selected real music excerpt is too short; no silent looping');
  const cuePaths = plan.soundCues.map(cue => assetPath(cue.assetId, join(assets, `${cue.kind}.wav`)));
  const effectiveSoundCues = plan.soundCues.map(cue => {
    const asset = catalog?.assets.find(asset => asset.id === cue.assetId);
    const trim = asset?.trim as {startSeconds?:number;endSeconds?:number}|undefined;
    const sourceStart = cue.sourceStart || trim?.startSeconds || 0;
    const duration = cue.duration ?? (trim?.endSeconds !== undefined ? trim.endSeconds - sourceStart : undefined);
    return { ...cue, sourceStart, duration };
  });
  for (const [index, cue] of effectiveSoundCues.entries()) {
    await requireLocalFile(cuePaths[index]!);
    const info = await probeMedia(cuePaths[index]!, tools, options.signal);
    if (!info.audio || cue.sourceStart >= info.durationSeconds || (cue.duration && cue.sourceStart + cue.duration > info.durationSeconds + 0.03)) throw new Error('Sound cue exceeds its actual asset bounds');
  }
  for (const id of new Set([plan.music.assetId,...plan.soundCues.map(cue=>cue.assetId)])) {
    const asset=catalog?.assets.find(asset=>asset.id===id);
    if(asset&&typeof asset.sha256==='string'&&createHash('sha256').update(await readFile(asset.path)).digest('hex')!==asset.sha256)throw new Error('Audio asset changed since catalog review');
  }
  if (plan.stickers.length + plan.faceAttachments.length) await requireLocalFile(join(assets, 'reaction.png'));
  await mkdir(dirname(outputPath), { recursive: true });
  const work = await mkdtemp(join(dirname(outputPath), '.troll-render-'));
  const ffmpeg = mediaExecutables(tools).ffmpeg;
  try {
    await mkdir(join(work, 'fonts'));
    await copyFile(preflight.fontPath!, join(work, 'fonts', `caption${extname(preflight.fontPath!)}`));
    await writeFile(join(work, 'captions.ass'), makeCaptions(plan, tools.fontFamily));
    for (const [index, segment] of plan.segments.entries()) {
      const mapping = timeline[index]!;
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...sourceSeekArgs(mapping.sourceStart), '-reinit_filter', '0', '-i', plan.sourcePath,
        '-filter_complex_threads', '1', '-filter_complex', segmentFilter(segment, mapping, !!source.audio, plan.sourceCrop, source.video),
        '-map', '[video]', '-map', '[audio]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-fps_mode', 'cfr',
        // AAC priming/padding accumulates when independently encoded segments
        // are stream-copy concatenated. Encode audio only once, in the final MP4.
        '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2', '-t', num(mapping.outputEnd - mapping.outputStart), join(work, `segment-${index}.mov`)];
      await runProcess(ffmpeg, args, { signal: options.signal, cwd: work, timeoutMs: 180_000 });
    }
    await writeFile(join(work, 'segments.txt'), plan.segments.map((_, index) => `file 'segment-${index}.mov'\nduration ${num(timeline[index]!.outputEnd - timeline[index]!.outputStart)}`).join('\n'));
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', 'segments.txt', '-c', 'copy', '-movflags', '+faststart', 'base.mov'], { signal: options.signal, cwd: work, timeoutMs: 60_000 });
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', 'base.mov'];
    let input = 1;
    const stickerInput = plan.stickers.length + plan.faceAttachments.length ? input++ : undefined;
    if (stickerInput !== undefined) args.push('-loop', '1', '-framerate', '30', '-i', join(assets, 'reaction.png'));
    const musicInput = input++;
    if (!catalog) args.push('-stream_loop', '-1');
    args.push('-i', musicPath);
    const cueInputs = cuePaths.map(path => { args.push('-i', path); return input++; });
    const filter = finalFilter({ ...plan, soundCues: effectiveSoundCues }, duration, stickerInput, musicInput, cueInputs);
    await writeFile(join(work, 'final-filter.txt'), filter);
    const partial = join(work, 'render.mp4');
    args.push('-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[video]', '-map', '[audio]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', num(duration), '-movflags', '+faststart', partial);
    await runProcess(ffmpeg, args, { signal: options.signal, cwd: work, timeoutMs: 300_000 });
    const audio = await enforceEncodedAudioPeak({ ffmpeg, path: partial, outputDirectory: work, signal: options.signal });
    const result = await validateVideo(audio.path, tools, options.signal);
    validateOutput(result, duration);
    const manifest = { version: 1, renderer: 'troll-editor-experiment/1', planPath: resolve(options.planPath), outputPath,
      createdAt: new Date().toISOString(), source: { path: plan.sourcePath, ...source }, plan, timeline,
      intendedDuration: duration, output: result, music: { assetPath: musicPath, excerptStartOutputSeconds: plan.music.dropAt-plan.music.leadInSeconds, excerptSourceStartSeconds: plan.music.sourceStart-plan.music.leadInSeconds, intendedDropOutputSeconds:plan.music.dropAt, intendedDropSourceSeconds:plan.music.sourceStart, leadInSeconds:plan.music.leadInSeconds, beatAlignmentBasis: catalog ? 'Catalog machine-measured energy-rise candidate; no listening claim' : 'Procedural first beat', leadIn: catalog ? 'Real catalog waveform; no procedural audio' : 'quiet pulsing tone plus short noise riser' },
      effectiveSoundCues,
      musicDucking: catalog ? {gainDuringCue:0.28,attackSeconds:0.04,releaseSeconds:0.14} : null,
      audioCatalog: catalog ?? null, faceAttachments: plan.faceAttachments.map(attachment => ({ ...attachment, sourceTimestamp: timeline[attachment.segmentIndex]!.sourceStart, outputStart: timeline[attachment.segmentIndex]!.outputStart, outputEnd: timeline[attachment.segmentIndex]!.outputEnd, compositedBeforeCameraShake: true })),
      audioMeasurement: audio.measurement, audioPeakCorrections: audio.attempts, tooling: preflight,
      review: { decodedWithoutErrors: true, timingValidated: true, visualReviewRequired: true, listeningReviewRequired: true },
    };
    const partialManifest = join(work, 'manifest.json');
    await writeFile(partialManifest, JSON.stringify(manifest, null, 2) + '\n');
    options.signal?.throwIfAborted();
    await promoteMedia(audio.path, outputPath);
    try { await promoteMedia(partialManifest, manifestPath); } catch (error) { await rm(outputPath, { force: true }); throw error; }
    return manifest;
  } finally { await rm(work, { recursive: true, force: true }); }
}

function validateOutput(info: MediaInfo, duration: number): void {
  if (info.video?.width !== WIDTH || info.video.height !== HEIGHT || info.video.codec !== 'h264' || info.video.pixelFormat !== 'yuv420p' || info.video.frameRate !== FPS || Math.abs(info.durationSeconds - duration) > 0.15) throw new Error('Rendered video failed format/duration validation');
  if (info.audio?.codec !== 'aac' || info.audio.sampleRate !== 48000 || info.audio.channels !== 2) throw new Error('Rendered audio failed format validation');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planPath, outputPath, assetsPath] = process.argv.slice(2);
  if (!planPath || !outputPath) throw new Error('Usage: node --import tsx experiments/troll-editor/render.ts PLAN.json OUTPUT.mp4 [ASSETS_DIRECTORY]');
  const manifest = await renderEdit({ planPath: resolve(planPath), outputPath: resolve(outputPath), assetsPath });
  console.log(JSON.stringify({ outputPath: manifest.outputPath, duration: manifest.intendedDuration, audioMeasurement: manifest.audioMeasurement }, null, 2));
}
