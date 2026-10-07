import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../src/server/media/process.js';
import { ensureNewOutput, mediaExecutables, preflightMediaTools, probeMedia, promoteMedia, validateVideo, type MediaTools } from '../../src/server/media/probe.js';
import { StoryPlanSchema, groupWords, validateStoryPlan, type StoryPlan, type WindowMapping, type Word } from './schema.js';

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const number = (value: number) => Number(value.toFixed(6)).toString();
const WIDTH = 720, HEIGHT = 1280;

export function storyTools(): MediaTools {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return {
    ffmpegPath: process.env.FFMPEG_PATH ?? (existsSync(full) ? full : 'ffmpeg'),
    ffprobePath: process.env.FFPROBE_PATH,
    fontPath: resolve(process.env.FONT_PATH ?? join(experimentRoot, '../../assets/fonts/NotoSans-Regular.ttf')),
    fontFamily: process.env.FONT_FAMILY ?? 'Noto Sans',
  };
}

function time(seconds: number): string {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, '0')}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}

function literal(value: string): string {
  return value.replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝').replace(/\s+/gu, ' ').trim();
}

function width(text: string, fontSize = 48): number {
  return [...text].reduce((sum, char) => sum + fontSize * (/[MW@%]/u.test(char) ? 0.95 : /[I1.,:'!| ]/u.test(char) ? 0.35 : 0.7), 0);
}

/** Keep the same line breaks for every active-word event to avoid caption jumps. */
function captionLineLayout(words: readonly Word[]): number[][] {
  const lines: number[][] = [];
  for (const [index, word] of words.entries()) {
    const current = lines.at(-1);
    const candidate = [...(current ?? []), index].map(i => literal(words[i]!.text).toUpperCase()).join(' ');
    if (current && width(candidate) <= 610) current.push(index);
    else lines.push([index]);
  }
  return lines;
}

function phraseText(words: readonly Word[], highlighted = -1, casing:'upper'|'sentence'='upper'): string {
  const layout = captionLineLayout(words);
  return layout.map(line => line.map(index => `${index === highlighted ? '{\\c&H0028EFFF&}' : '{\\c&H00FFFFFF&}'}${casing==='upper'?literal(words[index]!.text).toUpperCase():literal(words[index]!.text)}`).join(' ')).join('\\N');
}

export function makeStoryCaptions(plan: StoryPlan, duration: number, fontFamily = 'Noto Sans'): string {
  if (/[\r\n,]/u.test(fontFamily)) throw new Error('Invalid caption font family');
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${WIDTH}\nPlayResY: ${HEIGHT}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Phrase,${fontFamily},48,&H00FFFFFF,&H00FFFFFF,&H00111111,&H80000000,-1,0,0,0,100,100,0,0,1,5,1,5,55,55,100,1\nStyle: Credit,${fontFamily},19,&H00FFFFFF,&H00FFFFFF,&H00111111,&H80000000,0,0,0,0,100,100,0,0,1,2,1,8,55,55,100,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const events: string[] = [];
  const y = plan.caption.position === 'upper-middle' ? 320 : plan.caption.position==='lower-middle'?960:590;
  for (const phrase of groupWords(plan.narration.words, plan.caption.wordsPerGroup)) {
    const layout = captionLineLayout(phrase.words);
    if (layout.length > 3 || layout.some(line => width(line.map(index => literal(phrase.words[index]!.text).toUpperCase()).join(' ')) > 610)) throw new Error('Caption phrase is too wide; split unusually long words in the spoken script before recording');
    const position = `{\\an5\\pos(360,${y})}`;
    events.push(`Dialogue: 0,${time(phrase.start)},${time(Math.min(phrase.end, duration))},Phrase,,0,0,0,,${position}${phraseText(phrase.words,-1,plan.caption.casing)}`);
    if (plan.caption.mode === 'highlight') phrase.words.forEach((word, index) => {
      if (Math.round(word.end * 100) > Math.round(word.start * 100)) events.push(`Dialogue: 1,${time(word.start)},${time(word.end)},Phrase,,0,0,0,,${position}${phraseText(phrase.words, index,plan.caption.casing)}`);
    });
  }
  // Credits belong in the manifest/gallery. User preference: no author or game-name watermark.
  return header + events.join('\n') + '\n';
}

export function validateSourceCrop(crop:StoryPlan['source']['crop'], width:number,height:number):void {
  if(crop && (crop.x+crop.width>width || crop.y+crop.height>height))throw new Error('Source crop exceeds the measured video dimensions');
}

export function sourceWindowFilter(window: WindowMapping, crop?:StoryPlan['source']['crop']): string {
  const duration = window.outputEnd - window.outputStart;
  const cropFilter=crop?`,crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`:'';
  return `[0:v]trim=duration=${number(window.sourceEnd - window.sourceStart)},setpts=(PTS-STARTPTS)/${number(window.speed)},fps=30,trim=duration=${number(duration)},setsar=1${cropFilter},split[background][foreground];[background]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},gblur=sigma=22,eq=brightness=-0.18:saturation=0.6[blur];[foreground]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease[sharp];[blur][sharp]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[video]`;
}

interface Loudness { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string; [key: string]: string }
async function measureAudio(ffmpeg: string, path: string, signal?:AbortSignal): Promise<Loudness> {
  const result = await runProcess(ffmpeg, ['-hide_banner', '-nostdin', '-i', path, '-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-2:LRA=9:print_format=json', '-f', 'null', '-'], { timeoutMs: 180_000,signal });
  const json = result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/u)?.[0];
  if (!json) throw new Error('FFmpeg returned no audio loudness measurement');
  const measurement = JSON.parse(json) as Loudness;
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) if (!Number.isFinite(Number(measurement[key]))) throw new Error('Narration is silent or has unusable loudness');
  return measurement;
}

function audioFilter(measured: Loudness, duration: number): string {
  return `[1:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-2:LRA=9:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,alimiter=limit=0.794:level=false,apad,atrim=duration=${number(duration)},aresample=48000[audio]`;
}

export async function renderStory(options: { planPath: string; outputPath: string; tools?: MediaTools;signal?:AbortSignal }): Promise<Record<string, unknown>> {
  const {signal}=options; signal?.throwIfAborted();
  const outputPath = resolve(options.outputPath), manifestPath = outputPath.replace(/\.mp4$/u, '.manifest.json');
  if (!outputPath.endsWith('.mp4')) throw new Error('Output must end in .mp4');
  await ensureNewOutput(outputPath);
  await ensureNewOutput(manifestPath);
  const tools = options.tools ?? storyTools();
  const preflight = await preflightMediaTools(tools);
  const input = StoryPlanSchema.parse(JSON.parse(await readFile(options.planPath, 'utf8')));
  if (!isAbsolute(input.source.path) || !isAbsolute(input.narration.path)) throw new Error('Source and narration paths must be absolute local files');
  const [source, narration] = await Promise.all([probeMedia(input.source.path, tools,signal), probeMedia(input.narration.path, tools,signal)]);
  if (!source.video || !narration.audio) throw new Error('The source needs video and the narration needs audio');
  validateSourceCrop(input.source.crop,source.video.width,source.video.height);
  const { plan, timeline, duration, availableDuration } = validateStoryPlan(input, source.durationSeconds, narration.durationSeconds);
  const captions = makeStoryCaptions(plan, duration, tools.fontFamily);
  const ffmpeg = mediaExecutables(tools).ffmpeg;
  const narrationLoudness = await measureAudio(ffmpeg, plan.narration.path,signal);
  await mkdir(dirname(outputPath), { recursive: true });
  const work = await mkdtemp(join(dirname(outputPath), '.story-render-'));
  try {
    await mkdir(join(work, 'fonts'));
    await copyFile(preflight.fontPath!, join(work, 'fonts', `caption${extname(preflight.fontPath!)}`));
    await writeFile(join(work, 'captions.ass'), captions);
    for (const [index, window] of timeline.entries()) {
      await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-ss', number(window.sourceStart), '-reinit_filter', '0', '-i', plan.source.path,
        '-filter_complex_threads', '1', '-filter_complex', sourceWindowFilter(window,plan.source.crop), '-map', '[video]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr', '-t', number(window.outputEnd - window.outputStart), join(work, `window-${index}.mp4`)], { cwd: work, timeoutMs: 240_000,signal });
    }
    await writeFile(join(work, 'windows.txt'), timeline.map((window, index) => `file 'window-${index}.mp4'\nduration ${number(window.outputEnd - window.outputStart)}`).join('\n'));
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', 'windows.txt', '-c', 'copy', 'base.mp4'], { cwd: work, timeoutMs: 60_000,signal });
    const partial = join(work, 'render.mp4');
    const filter = `[0:v]subtitles=captions.ass:fontsdir=fonts,fade=t=out:st=${number(duration - 0.3)}:d=0.3,format=yuv420p[video];${audioFilter(narrationLoudness, duration)}`;
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', 'base.mp4', '-i', plan.narration.path,
      '-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[video]', '-map', '[audio]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-r', '30', '-fps_mode', 'cfr', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', number(duration), '-movflags', '+faststart', partial], { cwd: work, timeoutMs: 480_000,signal });
    const output = await validateVideo(partial, tools,signal);
    if (output.video?.width !== WIDTH || output.video.height !== HEIGHT || output.video.frameRate !== 30 || output.video.codec !== 'h264' || output.video.pixelFormat !== 'yuv420p' || Math.abs(output.durationSeconds - duration) > 0.1) throw new Error('Rendered story failed video format or duration validation');
    if (output.audio?.codec !== 'aac' || output.audio.sampleRate !== 48000 || output.audio.channels !== 2) throw new Error('Rendered story failed audio format validation');
    const outputLoudness = await measureAudio(ffmpeg, partial,signal);
    if (Number(outputLoudness.input_tp) > -1) throw new Error('Encoded narration exceeds the −1 dBTP true-peak limit');
    const manifest = { version: 1, renderer: 'story-background-experiment/1', createdAt: new Date().toISOString(), outputPath, planPath: resolve(options.planPath),
      plan, story: plan.story, primarySourcePermalink: plan.story.permalink ?? null, script: plan.narration.script,
      source: { path: plan.source.path, ...source }, narration: { path: plan.narration.path, ...narration, voiceLabel: plan.narration.voiceLabel, alignmentMethod: plan.narration.alignmentMethod },
      timeline, availableDuration, intendedDuration: duration, tailSeconds: duration - narration.durationSeconds, output,
      captions: { mode: plan.caption.mode, position: plan.caption.position, groups: groupWords(plan.narration.words, plan.caption.wordsPerGroup), timestampSource: 'supplied narration word alignment; no estimated interpolation' },
      audio: { gameplayMuted: true, targetLUFS: -16, targetTruePeakDBTP: -2, inputMeasurement: narrationLoudness, encodedMeasurement: outputLoudness }, tooling: preflight,
      review: { decodedWithoutErrors: true, timingValidated: true, gameplayLooped: false, semanticRelationshipBetweenStoryAndGameplay: plan.story.kind==='game-overview', attributionBurnedIn:false, visualReviewRequired: true, listeningReviewRequired: true },
    };
    const partialManifest = join(work, 'manifest.json');
    await writeFile(partialManifest, JSON.stringify(manifest, null, 2) + '\n');
    await promoteMedia(partial, outputPath);
    try { await promoteMedia(partialManifest, manifestPath); } catch (error) { await rm(outputPath, { force: true }); throw error; }
    return manifest;
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planPath, outputPath] = process.argv.slice(2);
  if (!planPath || !outputPath) throw new Error('Usage: node --import tsx experiments/story-background/render.ts PLAN.json OUTPUT.mp4');
  const manifest = await renderStory({ planPath: resolve(planPath), outputPath: resolve(outputPath) });
  console.log(JSON.stringify({ outputPath: manifest.outputPath, duration: manifest.intendedDuration, audio: manifest.audio }, null, 2));
}
