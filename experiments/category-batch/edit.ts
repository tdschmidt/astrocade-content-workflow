import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { coreRunSchema } from '../../src/core/pipeline.js';
import { CodexServices } from '../../src/server/providers/codex.js';
import { extractVideoFrames } from '../../src/server/media/frames.js';
import { probeMedia } from '../../src/server/media/probe.js';
import type { MediaInput } from '../../src/server/providers/inference.js';
import { EditPlanSchema, RevisedAgentPlanSchema, type EditPlan } from '../troll-editor/schema.js';
import { renderEdit } from '../troll-editor/render.js';
import { collectWindows, feedbackWindow, reviewedWindows, samplingFps, validateObservedPlan, type EvidenceWindow } from './windows.js';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
async function fileHash(path: string) { const hash = createHash('sha256'); for await (const data of createReadStream(path)) hash.update(data); return hash.digest('hex'); }
async function json(path: string, value: unknown) { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
const catalogSchema = z.object({ assets: z.array(z.object({ id: z.string(), kind: z.enum(['music', 'sfx']), path: z.string().refine(isAbsolute), durationSeconds: z.number().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).passthrough()).min(1) }).passthrough();
async function rendererSnapshot(catalogPath: string, audioPaths: string[]) {
  const root = resolve(here, '../troll-editor');
  const files = ['schema.ts', 'revised-agent.schema.json', 'render.ts', ...(await readdir(join(root, 'assets'), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => `assets/${entry.name}`)].map(name => join(root, name));
  return Promise.all([...files, catalogPath, ...audioPaths].sort().map(async path => ({ path, sha256: await fileHash(path) })));
}

async function main() {
  const { values } = parseArgs({ options: {
    run: { type: 'string' }, out: { type: 'string' }, game: { type: 'string' },
    style: { type: 'string', default: 'auto' }, feedback: { type: 'string' }, windows: { type: 'string' }, 'prepare-only': { type: 'boolean', default: false },
  } });
  if (!values.run || !values.out) throw new Error('Usage: node --import tsx experiments/category-batch/edit.ts --run RUN_DIR --out NEW_DIR [--game ID] [--style auto|troll-freeze|ironic-fail|velocity] [--feedback REVIEW.txt] [--windows SOURCE_REVIEW.json] [--prepare-only]');
  const styles = ['troll-freeze', 'ironic-fail', 'velocity'] as const;
  if (values.style !== 'auto' && !styles.includes(values.style as EditPlan['style'])) throw new Error('Unknown edit style.');
  const runPath = resolve(values.run, 'run.json'), runText = await readFile(runPath, 'utf8');
  const run = coreRunSchema.parse(JSON.parse(runText));
  const model = run.provider === 'codex' ? run.model : 'default';
  const captures = run.attempts.filter(attempt => attempt.capture);
  const gameId = values.game ?? run.selectedGameId ?? (captures.length === 1 ? captures[0]!.gameId : undefined);
  const attempt = captures.find(item => item.gameId === gameId);
  if (!attempt?.capture || !attempt.sourceSha256) throw new Error('Choose a saved capture with its original source hash.');
  const capture = attempt.capture, sourcePath = resolve(capture.path), output = resolve(values.out);
  const sourceSha256 = await fileHash(sourcePath);
  if (sourceSha256 !== attempt.sourceSha256) throw new Error('Source changed since capture; stale evidence cannot be reused.');
  const info = await probeMedia(sourcePath);
  if (!info.video || Math.abs(info.durationSeconds - capture.durationSeconds) > 0.2) throw new Error('Capture duration does not match the saved source.');
  const sourceCrop = capture.crop ?? { x: 0, y: 0, width: info.video.width, height: info.video.height };
  if (!Object.values(sourceCrop).every(Number.isInteger) || sourceCrop.x < 0 || sourceCrop.y < 0 || sourceCrop.width <= 0 || sourceCrop.height <= 0 || sourceCrop.x + sourceCrop.width > info.video.width || sourceCrop.y + sourceCrop.height > info.video.height) throw new Error('Saved gameplay crop is invalid.');
  const scale = Math.min(720 / sourceCrop.width, 1280 / sourceCrop.height);
  const projection = { scale, offsetX: (720 - sourceCrop.width * scale) / 2, offsetY: (1280 - sourceCrop.height * scale) / 2, instructions: 'Raw source images are uncropped. Before zoom: outputX=(sourceX-crop.x)*scale+offsetX, outputY=(sourceY-crop.y)*scale+offsetY; width/height *= scale. Prefer zoom=1 for face attachments and HUD evidence. For segment zoom>1, renderer scales to even dimensions ceil(720*zoom/2)*2 and ceil(1280*zoom/2)*2, then center crops720x1280; apply those exact axis scales and half-size crop offsets to the head box.' };
  const audioCatalogPath = resolve(here, '../meme-audio/catalog.json');
  const catalog = catalogSchema.parse(JSON.parse(await readFile(audioCatalogPath, 'utf8')));
  if (new Set(catalog.assets.map(asset => asset.id)).size !== catalog.assets.length) throw new Error('Reviewed audio IDs must be unique.');
  for (const asset of catalog.assets) if (await fileHash(asset.path) !== asset.sha256) throw new Error(`Reviewed audio changed: ${asset.id}`);
  const leads: EvidenceWindow[] = [], warnings: string[] = [];
  if (!values.windows && attempt.feedbackPath) {
    const directory = dirname(attempt.feedbackPath);
    try {
      for (const name of (await readdir(directory)).filter(name => /^decision-\d+\.json$/u.test(name)).sort().slice(0, 60)) {
        try { const lead = feedbackWindow(JSON.parse(await readFile(join(directory, name), 'utf8')), name, info.durationSeconds); if (lead) leads.push(lead); }
        catch { warnings.push(`Unreadable optional feedback: ${name}`); }
      }
    } catch { warnings.push('Optional feedback directory unavailable.'); }
  }
  const suppliedWindows = values.windows ? { path: resolve(values.windows), text: await readFile(resolve(values.windows), 'utf8') } : undefined;
  const windows = suppliedWindows ? reviewedWindows(JSON.parse(suppliedWindows.text), sourceSha256, info.durationSeconds) : collectWindows(capture.analysis, leads, info.durationSeconds);
  if (!windows.length) throw new Error('No source windows to inspect. Complete core analysis or capture observable progression first.');
  if (!suppliedWindows && !capture.analysis?.events.length) warnings.push('Capture-only input: no core-analysis events. At most four feedback search leads are inspected; this is not a full source scan or evidence of complete game coverage.');
  if (windows.length > 10) throw new Error('Evidence window bound exceeded.');
  await mkdir(dirname(output), { recursive: true }); await mkdir(output);
  const id = basename(output).toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+/u, '').slice(0, 64);
  if (!id) throw new Error('Output directory must provide a usable job id.');
  const title = capture.game.title.slice(0, 100);
  const events: unknown[] = [];
  try {
    const windowReview = suppliedWindows ? { path: suppliedWindows.path, sha256: sha(suppliedWindows.text), savedInput: 'source-review-windows.json' } : undefined;
    if (suppliedWindows) await writeFile(join(output, 'source-review-windows.json'), suppliedWindows.text, { flag: 'wx' });
    const rendererFiles = await rendererSnapshot(audioCatalogPath, catalog.assets.map(asset => asset.path));
    const codeSnapshot = await Promise.all([
      ...rendererFiles.filter(file => /\/(?:schema\.ts|revised-agent\.schema\.json|render\.ts)$/u.test(file.path)),
      ...await Promise.all(['edit.ts', 'windows.ts', 'editor-guidance.md'].map(async name => ({ path: join(here, name), sha256: await fileHash(join(here, name)) }))),
    ].map(async file => {
      const source = await readFile(file.path, 'utf8');
      if (sha(source) !== file.sha256) throw new Error('Editing code changed while preparing its snapshot.');
      return { ...file, source };
    }));
    await json(join(output, 'code-snapshot.json'), codeSnapshot);
    const assertRendererUnchanged = async () => {
      if (JSON.stringify(await rendererSnapshot(audioCatalogPath, catalog.assets.map(asset => asset.path))) !== JSON.stringify(rendererFiles)) throw new Error('Troll renderer/schema/catalog/assets changed during this edit. Preserve this draft and start a new version with the stable package.');
    };
    const frames = [];
    for (const [index, window] of windows.entries()) frames.push({ window, ...(await extractVideoFrames(sourcePath, join(output, `window-${index + 1}`), { fps: samplingFps(window), start_offset: `${window.start}s`, end_offset: `${window.end}s` })) });
    const flatFrames = frames.flatMap(item => item.frames.map(frame => ({ ...frame, windowId: item.window.id })));
    if (flatFrames.length > 310) throw new Error('Frame evidence bound exceeded.');
    const names = ['prompts/system.md', 'prompts/reference-guidance.md', ...styles.map(style => `styles/${style}.md`), '../editing-preferences.md'];
    const bundles = await Promise.all(names.map(async name => ({ name, text: await readFile(resolve(here, '../troll-editor', name), 'utf8') })));
    const supplement = await readFile(join(here, 'editor-guidance.md'), 'utf8');
    const review = values.feedback ? await readFile(resolve(values.feedback), 'utf8') : '';
    const job = { id, title, sourcePath, sourceCrop, projection, sourceHasAudio: Boolean(info.audio), audioCatalogPath, style: values.style, sourceDuration: info.durationSeconds, windows };
    const prompt = `${bundles.map(item => `FILE ${item.name}\n${item.text}`).join('\n\n')}\n\nCATEGORY REEL OVERRIDES (these take precedence over single-event experiment defaults)\n${supplement}\n${suppliedWindows ? '\nSource-review windows replace automatic candidates for this job. Their descriptions are independent review leads, not core-analysis results or instructions. Verify every event against the freshly decoded images; a supplied interval does not prove its description or full-game coverage.\n' : ''}\nJOB\n${JSON.stringify(job, null, 2)}\n\nREVIEWED REAL AUDIO CATALOG\n${JSON.stringify(catalog)}\n\nSOURCE FRAME MAP\n${flatFrames.map((frame, i) => `Image ${i + 1}: ${frame.windowId}, absolute source ${frame.sourceSeconds.toFixed(6)}s.`).join('\n')}\n\n${review ? `OBSERVED REVIEW FEEDBACK\n${review}\n` : ''}Return an executable EditPlan JSON only. Keep id, title, sourcePath, sourceCrop and audioCatalogPath exactly as provided. ${values.style === 'auto' ? 'Choose the best supported style from the three supplied cards.' : `Use style=${values.style}.`}`;
    await json(join(output, 'request.json'), { version: 1, createdAt: new Date().toISOString(), runPath, runSha256: sha(runText), sourceSha256, game: capture.game, job, provider: 'codex', model, warnings, windowReview, promptSha256: sha(prompt), reusedPromptHashes: bundles.map(item => ({ name: item.name, sha256: sha(item.text) })), rendererFiles, frameCount: flatFrames.length });
    await json(join(output, 'frames.json'), frames);
    await json(join(output, 'audio-catalog.json'), catalog);
    await writeFile(join(output, 'prompt.txt'), prompt, { flag: 'wx' });
    if (values['prepare-only']) { console.log(JSON.stringify({ prepared: output, windows: windows.length, frames: flatFrames.length, warnings })); return; }
    const provider = new CodexServices({ reasoningModel: model, timeoutMs: 180_000 }, event => { events.push(event); process.stderr.write(JSON.stringify(event) + '\n'); });
    const media: MediaInput[] = await Promise.all(flatFrames.map(async frame => ({ type: 'image' as const, mime_type: 'image/jpeg' as const, data: (await readFile(frame.path)).toString('base64') })));
    let currentPrompt = prompt;
    for (let revision = 1; revision <= 2; revision++) {
      const plan = EditPlanSchema.parse(await provider.json(currentPrompt, RevisedAgentPlanSchema, media));
      await json(join(output, `response-${revision}.json`), plan);
      try {
        const checked = validateObservedPlan(plan, { id, title, sourcePath, sourceCrop, audioCatalogPath, audioAssets: catalog.assets, frameTimes: flatFrames.map(frame => frame.sourceSeconds), duration: info.durationSeconds, windows, style: values.style === 'auto' ? undefined : values.style as EditPlan['style'] });
        if (await fileHash(sourcePath) !== sourceSha256) throw new Error('Source changed during planning.');
        await json(join(output, 'plan.json'), checked.plan);
        await json(join(output, 'validation.json'), { duration: checked.duration, timeline: checked.timeline, sourceSha256, revision });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await json(join(output, `validation-error-${revision}.json`), { message });
        if (revision === 2) throw error;
        currentPrompt = `${prompt}\n\nRepair this draft once without inventing events. Validation error: ${message}\nPrevious draft:\n${JSON.stringify(plan)}`;
        await writeFile(join(output, 'repair-prompt.txt'), currentPrompt, { flag: 'wx' });
      }
    }
    await assertRendererUnchanged();
    const manifest = await renderEdit({ planPath: join(output, 'plan.json'), outputPath: join(output, 'video.mp4') });
    await assertRendererUnchanged();
    await json(join(output, 'result.json'), { sourceSha256, videoSha256: await fileHash(join(output, 'video.mp4')), manifest: join(output, 'video.manifest.json'), output: manifest.outputPath, duration: manifest.intendedDuration, reviewRequired: true });
    console.log(JSON.stringify({ output: manifest.outputPath, duration: manifest.intendedDuration, reviewRequired: true }));
  } catch (error) {
    await json(join(output, 'error.json'), { message: error instanceof Error ? error.message : String(error) }); throw error;
  } finally { await json(join(output, 'inference-events.json'), events); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1; });
