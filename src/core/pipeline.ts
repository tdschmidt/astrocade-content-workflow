import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { captureSchema, scriptSchema, type Capture } from '../shared/domain.js';
import type { Configuration } from '../server/config.js';
import { canonicalGameUrl, discoverGames } from '../server/games/discovery.js';
import { inspectGame, learnGameProfile } from '../server/games/learning.js';
import { verifiedProfiles } from '../server/games/profiles.js';
import { runCaptureAttempt } from '../server/games/runner.js';
import { gameCandidateSchema, gameProfileSchema } from '../server/games/schema.js';
import { validateVideo } from '../server/media/probe.js';
import { renderPortrait } from '../server/media/render.js';
import { analyzeFootage, draftScript } from '../server/providers/editorial.js';
import { GoogleServices } from '../server/providers/google.js';
import { JsonStore } from '../server/store.js';
import { nominateGames, nominationSchema } from './selection.js';
import { Trace } from './trace.js';

const attemptSchema = z.object({
  gameId: z.string(), profile: gameProfileSchema.optional(),
  inspectionPath: z.string().optional(), evidence: z.array(z.string()).default([]), limitations: z.array(z.string()).default([]),
  capture: captureSchema.optional(), sourceSha256: z.string().optional(),
  analysisModel: z.string().optional(),
  unsupported: z.boolean().default(false), error: z.string().optional(),
});
export const coreRunSchema = z.object({
  version: z.literal(1), id: z.string(), createdAt: z.string(), model: z.string(),
  status: z.enum(['running', 'paused', 'failed', 'complete']),
  candidates: z.array(gameCandidateSchema).default([]),
  shortlist: z.array(nominationSchema).default([]), attempts: z.array(attemptSchema).default([]),
  selectedGameId: z.string().optional(), script: scriptSchema.optional(),
  scriptModel: z.string().optional(),
  videoPath: z.string().optional(), videoSha256: z.string().optional(), error: z.string().optional(),
});
export type CoreRun = z.infer<typeof coreRunSchema>;
export type CoreStage = 'discover' | 'capture' | 'edit' | 'all';

const defaults = { discoverGames, nominateGames, inspectGame, learnGameProfile, runCaptureAttempt, analyzeFootage, draftScript, renderPortrait, validateVideo };
export type CoreServices = typeof defaults;

async function hashFile(path: string) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
function message(error: unknown, secret: string) {
  const text = error instanceof Error ? error.message : String(error);
  return (secret ? text.replaceAll(secret, '[redacted]') : text).slice(0, 1500);
}

/** Each run has its own files; a lock prevents two CLI invocations from resuming it together. */
async function lockRun(directory: string) {
  const path = join(directory, '.lock');
  try {
    const pid = Number(await readFile(path, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid run lock: ${path}`);
    try { process.kill(pid, 0); throw new Error(`This run is already open in process ${pid}.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    await rm(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const handle = await open(path, 'wx', 0o600);
  await handle.writeFile(String(process.pid)); await handle.close();
  return () => rm(path, { force: true });
}

async function report(directory: string, run: CoreRun) {
  const link = (path: string) => relative(directory, path).split('/').map(encodeURIComponent).join('/');
  const lines = [
    '# Astrocade run', '', `Status: **${run.status}** · Current model: \`${run.model}\` · Started: ${run.createdAt}`, '',
    'This is an evidence trace: observable inputs, actions, results, and concise decision summaries. It does not contain private internal model reasoning.', '',
    '- [Full event trace](trace.jsonl)', '- [Run data](run.json)', '- [Discovery evidence](discovery.json)', '', '## Candidate decisions', '',
  ];
  for (const choice of run.shortlist) {
    const game = run.candidates.find(candidate => candidate.id === choice.gameId)!;
    const attempt = run.attempts.find(item => item.gameId === choice.gameId);
    lines.push(`### ${game.title}`, '', `[Game](${game.url})`, '', `Hypothesis: ${choice.hypothesis}`, '', `Viewer question: ${choice.viewerQuestion}`, '', `Control risk: ${choice.controlRisk}`, '');
    if (attempt?.inspectionPath) lines.push(`[Inspection](${link(attempt.inspectionPath)})`, '');
    for (const evidence of attempt?.evidence ?? []) lines.push(`- ${evidence}`);
    for (const limitation of attempt?.limitations ?? []) lines.push(`- Limitation: ${limitation}`);
    if (attempt?.capture) {
      lines.push('', `[Source recording](${link(attempt.capture.path)}) (${attempt.capture.durationSeconds.toFixed(2)} seconds)`, '');
      if (attempt.capture.analysis) lines.push(`Observed (${attempt.analysisModel}): ${attempt.capture.analysis.reason}`, '', ...attempt.capture.analysis.events.map(event => `- ${event.startSeconds.toFixed(2)}–${event.endSeconds.toFixed(2)}s: ${event.event}. Evidence: ${event.evidence}. Result: ${event.outcome}.`), '');
    }
    if (attempt?.error) lines.push(`Attempt stopped: ${attempt.error}`, '');
  }
  if (run.script) lines.push('## Edit', '', `Model: ${run.scriptModel}`, '', `Hook: ${run.script.hook}`, '', `Decision: ${run.script.rationale}`, '', `Cuts: ${run.script.cuts.map(cut => `${cut.startSeconds}–${cut.endSeconds}s`).join(', ')}`, '', 'Caption:', '', run.script.caption, '');
  if (run.videoPath) lines.push(`[Play final video](${link(run.videoPath)})`, '', 'Publishing is manual. Review the video and caption before posting.', '');
  if (run.error) lines.push('## Stopped', '', run.error, '', `Resume: npm run pipeline -- --resume ${directory}`, '');
  await writeFile(join(directory, 'report.md'), lines.join('\n'), { mode: 0o600 });
}

export async function runPipeline(options: {
  directory: string; model: string; stage?: CoreStage; shortlistSize?: number; game?: string; signal?: AbortSignal; quiet?: boolean;
}, config: Configuration, overrides: Partial<CoreServices> = {}): Promise<CoreRun> {
  const directory = resolve(options.directory);
  const services = { ...defaults, ...overrides };
  const stage = options.stage ?? 'all';
  const limit = options.shortlistSize ?? 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Shortlist size must be 1–5.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await lockRun(directory);
  const trace = new Trace(directory, options.quiet);
  const settings = { ...config.get(), reasoningModel: options.model };
  let store: JsonStore<CoreRun> | undefined;
  try {
    store = await JsonStore.open(join(directory, 'run.json'), coreRunSchema, coreRunSchema.parse({ version: 1, id: basename(directory), createdAt: new Date().toISOString(), model: options.model, status: 'running' }));
    await store.update(run => { run.model = options.model; run.status = 'running'; delete run.error; });
    const google = new GoogleServices(settings, event => trace.event(`provider.${event.stage}`, event.status, event.message ?? `${event.model ?? 'Files API'} attempt ${event.attempt}`, event));
    const save = async (change: (run: CoreRun) => void) => { await store!.update(change); await report(directory, store!.read()); };
    const updateAttempt = async (gameId: string, change: (attempt: CoreRun['attempts'][number]) => void) => save(run => change(run.attempts.find(item => item.gameId === gameId)!));
    trace.event('run', 'started', `Target stage: ${stage}. Completed artifacts will be reused.`, { model: options.model });
    if (stage === 'edit' && !store.read().attempts.some(attempt => attempt.capture)) throw new Error('Editing needs a saved recording. Use --resume with a run that completed capture.');

    if (!store.read().candidates.length) {
      trace.event('discover', 'started', 'Reading current public Astrocade pages.');
      const result = await services.discoverGames({ signal: options.signal });
      trace.artifact('discovery.json', result);
      if (!result.candidates.length) throw new Error('Astrocade returned no live game candidates. Check connectivity, then resume.');
      await save(run => { run.candidates = result.candidates; });
      trace.event('discover', 'completed', `Found ${result.candidates.length} games. Unlabeled popularity counters remain unknown.`, { sources: result.sources });
    }
    if (!store.read().shortlist.length) {
      const candidates = store.read().candidates;
      let shortlist;
      if (options.game) {
        const game = candidates.find(candidate => candidate.id === options.game || canonicalGameUrl(candidate.url) === canonicalGameUrl(options.game!) || new URL(candidate.url).pathname.split('/').at(-2) === options.game);
        if (!game) throw new Error('The requested game is not in this run’s discovered catalog. Use an exact ID, slug, or URL from discovery.json.');
        shortlist = [{ gameId: game.id, hypothesis: 'Operator-selected candidate; suitability still requires actual play.', viewerQuestion: 'What visible decision and consequence does this game offer?', controlRisk: 'Inspect the actual controls before capturing.' }];
      } else shortlist = await services.nominateGames(candidates, verifiedProfiles, google, limit, options.signal);
      await save(run => { run.shortlist = shortlist; run.attempts = shortlist.map(item => attemptSchema.parse({ gameId: item.gameId })); });
      trace.artifact('shortlist.json', shortlist);
      trace.event('shortlist', 'completed', 'Provisional choices saved. Actual recordings will determine the edit.', shortlist);
    } else if (options.game && !store.read().shortlist.some(choice => {
      const game = store!.read().candidates.find(candidate => candidate.id === choice.gameId)!;
      return game.id === options.game || game.url === options.game || new URL(game.url).pathname.split('/').at(-2) === options.game;
    })) throw new Error('A saved shortlist cannot be changed while resuming. Start a new run for a different game.');
    if (stage === 'discover') { await save(run => { run.status = 'paused'; }); return store.read(); }

    for (const choice of store.read().shortlist) {
      options.signal?.throwIfAborted();
      const game = store.read().candidates.find(candidate => candidate.id === choice.gameId)!;
      let attempt = store.read().attempts.find(item => item.gameId === game.id)!;
      if (attempt.unsupported) continue;
      if (attempt.capture) {
        if (await hashFile(attempt.capture.path) !== attempt.sourceSha256) throw new Error(`Saved source changed for ${game.title}. Start a new run instead of reusing stale edit decisions.`);
        trace.event('capture', 'reused', `Reusing ${game.title}'s completed recording.`); continue;
      }
      if (stage === 'edit') continue;
      const gameDir = join(directory, `game-${game.id.replace(/[^a-zA-Z0-9-]/g, '')}`);
      await mkdir(gameDir, { recursive: true });
      try {
        if (!attempt.profile) {
          trace.event('inspect', 'started', `Inspecting ${game.title}'s visible controls.`);
          const inspectionDir = join(gameDir, `inspection-${randomUUID().slice(0, 8)}`);
          const inspection = await services.inspectGame(game, inspectionDir, options.signal);
          await updateAttempt(game.id, item => { item.inspectionPath = join(inspectionDir, 'inspection.json'); });
          const preset = verifiedProfiles.find(profile => canonicalGameUrl(profile.gameUrl) === canonicalGameUrl(game.url));
          const learned = preset ? { profile: preset, evidence: [preset.verificationNotes ?? 'Previously tested native controls.'], limitations: ['A tested control sequence does not guarantee a win or a useful event in this attempt.'] } : await services.learnGameProfile(inspection, game, google, options.signal);
          await updateAttempt(game.id, item => { item.profile = learned.profile; item.evidence = learned.evidence; item.limitations = learned.limitations; item.unsupported = !learned.profile; });
          trace.artifact(`controls-${game.id}.json`, learned);
          trace.event('learn', learned.profile ? 'completed' : 'unsupported', `${game.title}: ${learned.profile ? 'bounded controls prepared' : 'no supported control plan'}.`, learned);
          if (!learned.profile) continue;
          attempt = store.read().attempts.find(item => item.gameId === game.id)!;
        }
        const profile = attempt.profile!;
        const id = randomUUID();
        trace.event('capture', 'started', `Recording ${game.title} with native input.`, { profile });
        const result = await services.runCaptureAttempt({
          profile, outputPath: join(gameDir, `${id}.webm`), allowUnverified: true, signal: options.signal,
          recorderOptions: { ffmpeg: config.mediaTools },
          onProgress: progress => trace.event('capture', progress.stage, progress.message),
          onAction: event => trace.event('input', event.status, `${event.phase}: ${event.action.type}`, event),
        });
        const bounds = result.surfaceBounds;
        const crop = { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.floor(bounds.width), height: Math.floor(bounds.height) };
        const capture: Capture = { id, runId: store.read().id, profileId: profile.id, game, ...result.artifact, crop, createdAt: result.finishedAt };
        const sourceSha256 = await hashFile(capture.path);
        trace.artifact(`capture-${game.id}.json`, result);
        await updateAttempt(game.id, item => { item.capture = capture; item.sourceSha256 = sourceSha256; delete item.error; });
        trace.event('capture', 'completed', `${game.title}: ${capture.durationSeconds.toFixed(2)} seconds saved.`, { actionsExecuted: result.actionsExecuted, stopReason: result.stopReason, sourceSha256, artifact: capture.path });
      } catch (error) {
        options.signal?.throwIfAborted();
        // A provider outage is not evidence that a game is unsuitable.
        if (error && typeof error === 'object' && [429, 503].includes(Reflect.get(error, 'status') ?? Reflect.get(error, 'statusCode'))) throw error;
        const detail = message(error, settings.geminiApiKey);
        await updateAttempt(game.id, item => { item.error = detail; });
        trace.event('capture', 'failed', `${game.title}: ${detail}`);
      }
    }
    if (!store.read().attempts.some(attempt => attempt.capture)) throw new Error('No candidate produced a recording. Inspect report.md and the saved control evidence; resume to retry failed attempts.');
    if (stage === 'capture') { await save(run => { run.status = 'paused'; }); return store.read(); }

    for (const attempt of store.read().attempts) {
      if (!attempt.capture || attempt.capture.analysis) continue;
      trace.event('analyze', 'started', `Finding a visible decision and consequence in ${attempt.capture.game.title}.`);
      const analysis = await services.analyzeFootage(attempt.capture, google, options.signal);
      await updateAttempt(attempt.gameId, item => { item.capture!.analysis = analysis; item.analysisModel = options.model; });
      trace.artifact(`analysis-${attempt.gameId}.json`, analysis);
      trace.event('analyze', analysis.usable ? 'completed' : 'rejected', analysis.reason, analysis);
    }
    const usable = store.read().attempts.filter(item => item.capture?.analysis?.usable && item.capture.analysis.events.length).sort((a, b) => b.capture!.analysis!.visualScore - a.capture!.analysis!.visualScore);
    if (!usable.length) throw new Error('No recording contains a supported short-form moment. The rejected footage and reasons are saved; choose another game in a new run.');
    if (!store.read().script) {
      const selected = usable[0]!;
      await save(run => { run.selectedGameId = selected.gameId; });
      trace.event('select', 'completed', `Selected ${selected.capture!.game.title} from observed footage, using visual score and verified action windows.`, usable.map(item => ({ game: item.capture!.game.title, score: item.capture!.analysis!.visualScore, reason: item.capture!.analysis!.reason })));
      const script = await services.draftScript({ capture: selected.capture!, format: 'highlight', topic: '' }, google, options.signal);
      await save(run => { run.script = script; run.scriptModel = options.model; });
      trace.artifact('edit.json', script);
      trace.event('edit', 'completed', script.rationale, { hook: script.hook, cuts: script.cuts });
    }
    const run = store.read();
    const selected = run.attempts.find(item => item.gameId === run.selectedGameId)!.capture!;
    if (run.videoPath) {
      if (await hashFile(run.videoPath) !== run.videoSha256) throw new Error('The finished video was modified outside the workflow. Start a new run.');
      await services.validateVideo(run.videoPath, config.mediaTools, options.signal);
      trace.event('render', 'reused', 'The completed video passed validation.');
    } else {
      // A crash between rendering and saving the manifest cannot block a later render.
      const outputPath = join(directory, `highlight-${randomUUID().slice(0, 8)}.mp4`);
      trace.event('render', 'started', 'Rendering a portrait highlight from the verified cuts.');
      const artifact = await services.renderPortrait({ outputPath, cuts: run.script!.cuts.map(cut => ({ ...cut, path: selected.path, crop: selected.crop })), hook: run.script!.hook, attribution: `${selected.game.title} · ${selected.game.creator ?? 'Astrocade'}`, ffmpeg: config.mediaTools, signal: options.signal });
      const videoSha256 = await hashFile(artifact.path);
      await save(state => { state.videoPath = artifact.path; state.videoSha256 = videoSha256; });
      await writeFile(join(directory, 'caption.txt'), `${run.script!.caption}\n`, { mode: 0o600 });
      trace.event('render', 'completed', `${artifact.durationSeconds.toFixed(2)}-second video ready. Publishing is manual.`, artifact);
    }
    await save(run => { run.status = 'complete'; });
    trace.event('run', 'completed', `Video and evidence: ${directory}`);
    return store.read();
  } catch (error) {
    const detail = message(error, settings.geminiApiKey);
    trace.event('run', 'failed', detail);
    if (store) { await store.update(run => { run.status = options.signal?.aborted ? 'paused' : 'failed'; run.error = detail; }); await report(directory, store.read()); }
    throw error;
  } finally { await release(); }
}
