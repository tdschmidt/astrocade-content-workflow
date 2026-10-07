import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { analysisSchema, captureSchema, scriptSchema, type Capture, type FootageAnalysis } from '../shared/domain.js';
import { contentBriefSchema, contentScore, defaultContentBrief, type ContentBrief } from '../shared/content.js';
import type { Configuration } from '../server/config.js';
import { NeedsAttention } from '../server/jobs.js';
import { canonicalGameUrl, discoverGames } from '../server/games/discovery.js';
import { inspectGame, learnGameProfile } from '../server/games/learning.js';
import { createFeedbackController, learnFeedbackProfile } from '../server/games/feedback.js';
import { verifiedProfiles } from '../server/games/profiles.js';
import { runCaptureAttempt } from '../server/games/runner.js';
import { gameCandidateSchema, gameProfileSchema } from '../server/games/schema.js';
import { validateVideo } from '../server/media/probe.js';
import { presenterVideoDuration, renderPortrait } from '../server/media/render.js';
import { analyzeFootage, draftScript } from '../server/providers/editorial.js';
import { GoogleServices } from '../server/providers/google.js';
import { CodexServices } from '../server/providers/codex.js';
import type { Inference, InferenceProgressEvent } from '../server/providers/inference.js';
import { JsonStore } from '../server/store.js';
import { nominateGames, nominationSchema } from './selection.js';
import { Trace } from './trace.js';

const attemptSchema = z.object({
  gameId: z.string(), profile: gameProfileSchema.optional(),
  inspectionPath: z.string().optional(), evidence: z.array(z.string()).default([]), limitations: z.array(z.string()).default([]),
  feedbackPath: z.string().optional(), controllerError: z.string().optional(),
  capture: captureSchema.optional(), sourceSha256: z.string().optional(),
  analysisModel: z.string().optional(), analysisProvider: z.enum(['gemini', 'codex']).optional(),
  unsupported: z.boolean().default(false), error: z.string().optional(),
});
export const coreRunSchema = z.object({
  version: z.literal(1), id: z.string(), createdAt: z.string(), model: z.string(), provider: z.enum(['gemini', 'codex']).default('gemini'),
  status: z.enum(['running', 'paused', 'failed', 'complete']),
  playMode: z.enum(['timed', 'feedback']).default('timed'),
  contentBrief: contentBriefSchema.default(defaultContentBrief),
  provenance: z.object({ sourceRunId: z.string(), sourceRunPath: z.string(), discoveryPath: z.string() }).optional(),
  presenterPath: z.string().optional(), presenterSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  candidates: z.array(gameCandidateSchema).default([]),
  shortlist: z.array(nominationSchema).default([]), attempts: z.array(attemptSchema).default([]),
  selectedGameId: z.string().optional(), script: scriptSchema.optional(),
  scriptModel: z.string().optional(), scriptProvider: z.enum(['gemini', 'codex']).optional(),
  videoPath: z.string().optional(), videoSha256: z.string().optional(), error: z.string().optional(),
});
export type CoreRun = z.infer<typeof coreRunSchema>;
export type CoreStage = 'discover' | 'capture' | 'edit' | 'all';

const defaults = { discoverGames, nominateGames, inspectGame, learnGameProfile, learnFeedbackProfile, createFeedbackController, runCaptureAttempt, analyzeFootage, draftScript, renderPortrait, presenterVideoDuration, validateVideo };
export type CoreServices = typeof defaults;

async function hashFile(path: string) { return createHash('sha256').update(await readFile(path)).digest('hex'); }

/** Reuse source evidence by reference, without altering the original run or copying media. */
async function editFromRun(sourceDirectory: string, directory: string, model: string, provider: 'gemini' | 'codex', brief?: ContentBrief): Promise<CoreRun> {
  const sourceRunPath = resolve(sourceDirectory);
  if (sourceRunPath === directory) throw new Error('--from-run needs a new output directory; use --resume to continue an existing run.');
  try {
    await readFile(join(directory, 'run.json'));
    throw new Error('--from-run cannot replace an existing run. Choose a new output directory.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const source = coreRunSchema.parse(JSON.parse(await readFile(join(sourceRunPath, 'run.json'), 'utf8')));
  if (!source.attempts.some(attempt => attempt.capture)) throw new Error('--from-run needs at least one saved recording.');
  for (const attempt of source.attempts) {
    if (attempt.capture && await hashFile(attempt.capture.path) !== attempt.sourceSha256) throw new Error(`Saved source changed for ${attempt.capture.game.title}. Start a new run instead of reusing stale edit decisions.`);
  }
  const ids = new Set(source.candidates.map(candidate => candidate.id));
  if (!source.shortlist.length || source.shortlist.some(choice => !ids.has(choice.gameId) || !source.attempts.some(attempt => attempt.gameId === choice.gameId))) throw new Error('The source run has incomplete candidate or shortlist evidence.');
  return coreRunSchema.parse({
    version: 1, id: basename(directory), createdAt: new Date().toISOString(), model, provider, status: 'running',
    playMode: source.playMode, contentBrief: brief ?? source.contentBrief, candidates: source.candidates, shortlist: source.shortlist,
    attempts: source.attempts.map(attempt => {
      if (attempt.inspectionPath) attempt.inspectionPath = resolve(attempt.inspectionPath);
      if (attempt.feedbackPath) attempt.feedbackPath = resolve(attempt.feedbackPath);
      if (attempt.capture) attempt.capture.path = resolve(attempt.capture.path);
      return attempt;
    }),
    provenance: { sourceRunId: source.id, sourceRunPath, discoveryPath: source.provenance?.discoveryPath ?? join(sourceRunPath, 'discovery.json') },
  });
}
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
    '# Astrocade run', '', `Status: **${run.status}** · Current provider/model: \`${run.provider}/${run.model}\` · Started: ${run.createdAt}`, '',
    'This is an evidence trace: observable inputs, actions, results, and concise decision summaries. It does not contain private internal model reasoning.', '',
    '- [Full event trace](trace.jsonl)', '- [Run data](run.json)', '- [Editorial brief](content-brief.json)', `- [Discovery evidence](${run.provenance ? link(run.provenance.discoveryPath) : 'discovery.json'})`, '',
    ...(run.provenance ? [`Re-edit of [${run.provenance.sourceRunId}](${link(join(run.provenance.sourceRunPath, 'report.md'))}). Saved recordings and observations are referenced; the original run is unchanged.`, ''] : []),
    ...(run.presenterPath ? [`Fictional AI commentator: [generated asset supplied](${link(run.presenterPath)}). This is not a recording of a real person playing. Publishing is manual.`, ''] : []),
    '## Candidate decisions', '',
    'Content scores are editorial heuristics out of 30, not probabilities of audience performance. Zero clarity, payoff, or readability rejects a candidate regardless of visual appeal.', '',
  ];
  for (const choice of run.shortlist) {
    const game = run.candidates.find(candidate => candidate.id === choice.gameId)!;
    const attempt = run.attempts.find(item => item.gameId === choice.gameId);
    lines.push(`### ${game.title}`, '', `[Game](${game.url})`, '', `Hypothesis: ${choice.hypothesis}`, '', `Viewer question: ${choice.viewerQuestion}`, '', `Control risk: ${choice.controlRisk}`, '');
    if (choice.angle) lines.push(`Proposed angle: ${choice.angle}`, '');
    if (choice.captureGoal) lines.push(`Capture goal: ${choice.captureGoal}`, '');
    if (choice.rejectIf) lines.push(`Reject if: ${choice.rejectIf}`, '');
    if (attempt?.inspectionPath) lines.push(`[Inspection](${link(attempt.inspectionPath)})`, '');
    if (attempt?.feedbackPath) lines.push(`[Gameplay feedback and screenshots](${link(attempt.feedbackPath)})`, '');
    if (attempt?.controllerError) lines.push(`Controller stopped early: ${attempt.controllerError}. Partial footage is preserved.`, '');
    for (const evidence of attempt?.evidence ?? []) lines.push(`- ${evidence}`);
    for (const limitation of attempt?.limitations ?? []) lines.push(`- Limitation: ${limitation}`);
    if (attempt?.capture) {
      lines.push('', `[Source recording](${link(attempt.capture.path)}) (${attempt.capture.durationSeconds.toFixed(2)} seconds)`, '');
      if (attempt.capture.analysis) lines.push(`Observed (${attempt.analysisProvider ?? 'gemini'}/${attempt.analysisModel}): ${attempt.capture.analysis.reason}`, '', ...attempt.capture.analysis.events.map(event => `- ${event.startSeconds.toFixed(2)}–${event.endSeconds.toFixed(2)}s: ${event.event}. Evidence: ${event.evidence}. Result: ${event.outcome}.`), '');
      const content = attempt.capture.analysis?.content;
      if (content) {
        const score = contentScore(content);
        lines.push(`Content: ${score < 0 ? 'rejected by clarity/payoff/readability gate' : `${score}/30`} · Angle: ${content.angle}`, '',
          `Clarity ${content.clarity}/3 · Participation ${content.participation}/3 · Payoff ${content.payoff}/3 · Readability ${content.readability}/3 · Distinctiveness ${content.distinctiveness}/3`, '',
          `Evidence: ${content.evidence}`, '', `Text placement: ${content.textPlacement}. ${content.placementReason}`, '');
      }
    }
    if (attempt?.error) lines.push(`Attempt stopped: ${attempt.error}`, '');
  }
  if (run.script) lines.push('## Edit', '', `Provider/model: ${run.scriptProvider ?? 'gemini'}/${run.scriptModel}`, '', `Hook: ${run.script.hook}`, '', `Decision: ${run.script.rationale}`, '', `Cuts: ${run.script.cuts.map(cut => `${cut.startSeconds}–${cut.endSeconds}s`).join(', ')}`, '', 'Caption:', '', run.script.caption, '');
  if (run.script?.editorial) {
    const editorial = run.script.editorial;
    lines.push('### Editorial alternatives', '');
    editorial.alternatives.forEach((concept, index) => lines.push(
      `${index + 1}. ${index === editorial.selectedIndex ? '**Selected:** ' : ''}${concept.hook} (${concept.angle})`, '',
      `Evidence: ${concept.evidence}`, '', `Tradeoff: ${concept.tradeoff}`, '',
    ));
    lines.push(`Duration: ${editorial.durationReason}`, '', `Review: ${editorial.review}`, '');
  }
  if (run.videoPath) lines.push(`[Play final video](${link(run.videoPath)})`, '', 'Publishing is manual. Review the video and caption before posting.', '');
  if (run.error) lines.push('## Stopped', '', run.error, '', `Resume: npm run pipeline -- --resume ${directory}`, '');
  await writeFile(join(directory, 'report.md'), lines.join('\n'), { mode: 0o600 });
}

export async function runPipeline(options: {
  directory: string; model: string; provider?: 'gemini' | 'codex'; stage?: CoreStage; shortlistSize?: number; game?: string; playMode?: 'timed' | 'feedback'; contentBrief?: ContentBrief; fromRun?: string; presenterPath?: string; signal?: AbortSignal; quiet?: boolean;
}, config: Configuration, overrides: Partial<CoreServices> = {}): Promise<CoreRun> {
  const directory = resolve(options.directory);
  if (options.fromRun && resolve(options.fromRun) === directory) throw new Error('--from-run needs a new output directory; use --resume to continue an existing run.');
  const services = { ...defaults, ...overrides };
  if (options.fromRun && options.stage && !['edit', 'all'].includes(options.stage)) throw new Error('--from-run only supports the edit stage.');
  const stage = options.fromRun ? 'edit' : options.stage ?? 'all';
  const limit = options.shortlistSize ?? 3;
  const providerName = options.provider ?? 'gemini';
  const requestedBrief = options.contentBrief ? contentBriefSchema.parse(options.contentBrief) : undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Shortlist size must be 1–5.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await lockRun(directory);
  const trace = new Trace(directory, options.quiet);
  const settings = { ...config.get(), reasoningModel: options.model };
  let store: JsonStore<CoreRun> | undefined;
  try {
    const initial = options.fromRun
      ? await editFromRun(options.fromRun, directory, options.model, providerName, requestedBrief)
      : coreRunSchema.parse({ version: 1, id: basename(directory), createdAt: new Date().toISOString(), model: options.model, status: 'running', contentBrief: requestedBrief ?? defaultContentBrief });
    if (options.presenterPath) { initial.presenterPath = resolve(options.presenterPath); initial.presenterSha256 = await hashFile(initial.presenterPath); }
    const opened = await JsonStore.open(join(directory, 'run.json'), coreRunSchema, initial);
    if (requestedBrief && JSON.stringify(requestedBrief) !== JSON.stringify(opened.read().contentBrief)) throw new Error('A saved editorial brief cannot be changed while resuming. Start a new run for a different brief.');
    if (options.presenterPath && resolve(options.presenterPath) !== opened.read().presenterPath) throw new Error('A saved presenter cannot be changed while resuming. Use --from-run to make a new edit.');
    const verifyPresenter = async () => {
      const saved = opened.read();
      if (saved.presenterPath && await hashFile(saved.presenterPath) !== saved.presenterSha256) throw new Error('The saved presenter asset changed. Use --from-run to make a new edit.');
    };
    await verifyPresenter();
    store = opened;
    if (options.playMode && options.playMode !== store.read().playMode && store.read().attempts.length) throw new Error('Start a new run to change the gameplay mode.');
    if (options.playMode) await store.update(run => { run.playMode = options.playMode!; });
    await store.update(run => { run.model = options.model; run.provider = providerName; run.status = 'running'; delete run.error; });
    trace.artifact('content-brief.json', store.read().contentBrief);
    let provider: Inference | undefined;
    const onProviderEvent = (event: InferenceProgressEvent) => trace.event(`provider.${event.stage}`, event.status, event.message ?? `${event.model ?? providerName} attempt ${event.attempt}`, { provider: providerName, ...event });
    const getProvider = () => provider ??= providerName === 'codex'
      ? new CodexServices({ reasoningModel: options.model, mediaTools: config.mediaTools }, onProviderEvent)
      : new GoogleServices(settings, onProviderEvent);
    const save = async (change: (run: CoreRun) => void) => { await store!.update(change); await report(directory, store!.read()); };
    const updateAttempt = async (gameId: string, change: (attempt: CoreRun['attempts'][number]) => void) => save(run => change(run.attempts.find(item => item.gameId === gameId)!));
    const verifySource = async (attempt: CoreRun['attempts'][number]) => {
      if (attempt.capture && await hashFile(attempt.capture.path) !== attempt.sourceSha256) throw new Error(`Saved source changed for ${attempt.capture.game.title}. Start a new run instead of reusing stale edit decisions.`);
    };
    const finish = async () => {
      // Reconstruct derived posting copy even if the previous process stopped after saving videoPath.
      await writeFile(join(directory, 'caption.txt'), `${store!.read().script!.caption}\n`, { mode: 0o600 });
      await save(run => { run.status = 'complete'; });
      trace.event('run', 'completed', `Video and evidence: ${directory}`);
      return store!.read();
    };
    trace.event('run', 'started', `Target stage: ${stage}. Completed artifacts will be reused.`, { provider: providerName, model: options.model });
    const saved = store.read();
    if (saved.shortlist.length && options.game && !saved.shortlist.some(choice => {
      const game = saved.candidates.find(candidate => candidate.id === choice.gameId)!;
      return game.id === options.game || canonicalGameUrl(game.url) === canonicalGameUrl(options.game!) || new URL(game.url).pathname.split('/').at(-2) === options.game;
    })) throw new Error('A saved shortlist cannot be changed while resuming. Start a new run for a different game.');
    if (saved.videoPath) {
      if (!saved.script || !saved.attempts.some(attempt => attempt.gameId === saved.selectedGameId && attempt.capture)) throw new Error('The saved video is missing its source or edit decisions. Start a new run.');
      for (const attempt of saved.attempts) await verifySource(attempt);
      if (await hashFile(saved.videoPath) !== saved.videoSha256) throw new Error('The finished video was modified outside the workflow. Start a new run.');
      await services.validateVideo(saved.videoPath, config.mediaTools, options.signal);
      trace.event('render', 'reused', 'The completed video passed validation. No candidate work is repeated.');
      return await finish();
    }
    if (stage === 'edit' && !store.read().attempts.some(attempt => attempt.capture)) throw new Error('Editing needs a saved recording. Use --resume with a run that completed capture.');

    if (!store.read().candidates.length) {
      trace.event('discover', 'started', 'Reading current public Astrocade pages.');
      const directUrl = options.game && canonicalGameUrl(options.game);
      // An explicit public game URL need not remain on today's front page. Its
      // URL-derived title is provisional; live inspection still gates capture.
      const result = directUrl ? {
        candidates: [gameCandidateSchema.parse({ id: new URL(directUrl).pathname.split('/').at(-1), url: directUrl,
          title: decodeURIComponent(new URL(directUrl).pathname.split('/').at(-2)!).replaceAll('-', ' '), titleSource: 'url_slug', metrics: [], observations: [] })],
        sources: [], source: 'explicit_game_url',
      } : await services.discoverGames({ signal: options.signal });
      trace.artifact('discovery.json', result);
      if (!result.candidates.length) throw new Error('Astrocade returned no live game candidates. Check connectivity, then resume.');
      await save(run => { run.candidates = result.candidates; });
      trace.event('discover', 'completed', directUrl ? 'Explicit game URL saved for live inspection; title is derived from its URL.' : `Found ${result.candidates.length} games. Unlabeled popularity counters remain unknown.`, { sources: result.sources });
    }
    if (!store.read().shortlist.length) {
      const candidates = store.read().candidates;
      let shortlist;
      if (options.game) {
        const game = candidates.find(candidate => candidate.id === options.game || canonicalGameUrl(candidate.url) === canonicalGameUrl(options.game!) || new URL(candidate.url).pathname.split('/').at(-2) === options.game);
        if (!game) throw new Error('The requested game is not in this run’s discovered catalog. Use an exact ID, slug, or URL from discovery.json.');
        shortlist = [{ gameId: game.id, hypothesis: 'Operator-selected candidate; suitability still requires actual play.', viewerQuestion: 'What visible decision and consequence does this game offer?', controlRisk: 'Inspect the actual controls before capturing.', captureGoal: 'Capture an understandable setup, meaningful action, and visible consequence; determine the angle from actual play.', rejectIf: 'No attainable, readable consequence or interesting viewer decision is observed.' }];
      } else shortlist = await services.nominateGames(candidates, verifiedProfiles, getProvider(), limit, options.signal, store.read().playMode, store.read().contentBrief);
      await save(run => { run.shortlist = shortlist; run.attempts = shortlist.map(item => attemptSchema.parse({ gameId: item.gameId })); });
      trace.artifact('shortlist.json', shortlist);
      trace.event('shortlist', 'completed', 'Provisional choices saved. Actual recordings will determine the edit.', shortlist);
    }
    if (stage === 'discover') { await save(run => { run.status = 'paused'; }); return store.read(); }

    for (const choice of store.read().shortlist) {
      options.signal?.throwIfAborted();
      const game = store.read().candidates.find(candidate => candidate.id === choice.gameId)!;
      let attempt = store.read().attempts.find(item => item.gameId === game.id)!;
      if (attempt.unsupported) continue;
      if (attempt.capture) {
        await verifySource(attempt);
        trace.event('capture', 'reused', `Reusing ${game.title}'s completed recording.`); continue;
      }
      if (stage === 'edit' || store.read().script) continue;
      const gameDir = join(directory, `game-${game.id.replace(/[^a-zA-Z0-9-]/g, '')}`);
      await mkdir(gameDir, { recursive: true });
      try {
        if (!attempt.profile) {
          trace.event('inspect', 'started', `Inspecting ${game.title}'s visible controls.`);
          const inspectionDir = join(gameDir, `inspection-${randomUUID().slice(0, 8)}`);
          const feedback = store.read().playMode === 'feedback';
          const inspection = await services.inspectGame(game, inspectionDir, options.signal, feedback ? getProvider() : undefined);
          await updateAttempt(game.id, item => { item.inspectionPath = join(inspectionDir, 'inspection.json'); });
          const preset = !feedback && verifiedProfiles.find(profile => canonicalGameUrl(profile.gameUrl) === canonicalGameUrl(game.url));
          const learned = feedback ? await services.learnFeedbackProfile(inspection, game, getProvider(), options.signal)
            : preset ? { profile: preset, evidence: [preset.verificationNotes ?? 'Previously tested native controls.'], limitations: ['A tested control sequence does not guarantee a win or a useful event in this attempt.'] } : await services.learnGameProfile(inspection, game, getProvider(), options.signal);
          await updateAttempt(game.id, item => { item.profile = learned.profile; item.evidence = learned.evidence; item.limitations = learned.limitations; item.unsupported = !learned.profile; delete item.error; });
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
          decide: profile.controller.type === 'sparse' ? services.createFeedbackController(profile, getProvider(), join(gameDir, `feedback-${id}`), decision => trace.event('feedback', 'observed', 'Current state, outcome and next action saved.', decision)) : undefined,
        });
        const bounds = result.surfaceBounds;
        const crop = { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.floor(bounds.width), height: Math.floor(bounds.height) };
        const capture: Capture = { id, runId: store.read().id, profileId: profile.id, game, ...result.artifact, crop, createdAt: result.finishedAt };
        const sourceSha256 = await hashFile(capture.path);
        trace.artifact(`capture-${game.id}.json`, result);
        await updateAttempt(game.id, item => {
          item.capture = capture; item.sourceSha256 = sourceSha256; delete item.error;
          if (profile.controller.type === 'sparse') item.feedbackPath = join(gameDir, `feedback-${id}`, 'report.md');
          if (result.controllerError) item.controllerError = message(result.controllerError, settings.geminiApiKey);
        });
        trace.event('capture', 'completed', `${game.title}: ${capture.durationSeconds.toFixed(2)} seconds saved.`, { actionsExecuted: result.actionsExecuted, stopReason: result.stopReason, sourceSha256, artifact: capture.path });
      } catch (error) {
        options.signal?.throwIfAborted();
        // A provider outage is not evidence that a game is unsuitable.
        if (error && typeof error === 'object' && [400, 401, 403, 429, 503].includes(Reflect.get(error, 'status') ?? Reflect.get(error, 'statusCode'))) throw error;
        const detail = message(error, settings.geminiApiKey);
        await updateAttempt(game.id, item => { item.error = detail; });
        trace.event('capture', 'failed', `${game.title}: ${detail}`);
      }
    }
    if (!store.read().attempts.some(attempt => attempt.capture)) throw new Error('No candidate produced a recording. Inspect report.md and the saved control evidence; resume to retry failed attempts.');
    if (stage === 'capture') { await save(run => { run.status = 'paused'; }); return store.read(); }

    for (const attempt of store.read().script ? [] : store.read().attempts) {
      if (!attempt.capture || attempt.capture.analysis?.content) continue;
      trace.event('analyze', 'started', `Finding a visible decision and consequence in ${attempt.capture.game.title}.`);
      const provider = getProvider(); // Missing credentials are a run-level setup failure, not bad footage.
      let analysis: FootageAnalysis;
      try {
        analysis = analysisSchema.required({ content: true }).parse(await services.analyzeFootage(attempt.capture, provider, options.signal));
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!(error instanceof z.ZodError || error instanceof NeedsAttention)) throw error;
        const detail = message(error, settings.geminiApiKey);
        await updateAttempt(attempt.gameId, item => { item.error = detail; });
        trace.event('analyze', 'failed', `${attempt.capture.game.title}: ${detail}`, { gameId: attempt.gameId });
        continue;
      }
      await updateAttempt(attempt.gameId, item => { item.capture!.analysis = analysis; item.analysisModel = options.model; item.analysisProvider = providerName; delete item.error; });
      trace.artifact(`analysis-${attempt.gameId}.json`, analysis);
      trace.event('analyze', analysis.usable && contentScore(analysis.content!) >= 0 ? 'completed' : 'rejected', analysis.reason, analysis);
    }
    if (!store.read().script) {
      const usable = store.read().attempts.filter(item => {
        const analysis = item.capture?.analysis;
        return analysis?.usable && analysis.events.length && analysis.content && contentScore(analysis.content) >= 0;
      }).sort((a, b) => contentScore(b.capture!.analysis!.content!) - contentScore(a.capture!.analysis!.content!));
      if (!usable.length) throw new Error('No recording contains a supported short-form moment. The rejected footage and reasons are saved; choose another game in a new run.');
      const selected = usable[0]!;
      await save(run => { run.selectedGameId = selected.gameId; });
      trace.event('select', 'completed', `Selected ${selected.capture!.game.title} from verified action windows and editorial evidence. Scores are heuristics out of 30, not audience probabilities.`, usable.map(item => ({ game: item.capture!.game.title, score: contentScore(item.capture!.analysis!.content!), content: item.capture!.analysis!.content, reason: item.capture!.analysis!.reason })));
      const presenterPath = store.read().presenterPath;
      const maxDurationSeconds = presenterPath ? Math.min(40, await services.presenterVideoDuration(presenterPath, config.mediaTools, options.signal)) : undefined;
      if (maxDurationSeconds !== undefined) trace.event('edit', 'observed', `Presenter footage limits the edit to ${maxDurationSeconds.toFixed(2)} seconds.`, { maxDurationSeconds });
      const script = await services.draftScript({ capture: selected.capture!, format: 'highlight', topic: '', brief: store.read().contentBrief, presenter: Boolean(presenterPath), maxDurationSeconds }, getProvider(), options.signal);
      await save(run => { run.script = script; run.scriptModel = options.model; run.scriptProvider = providerName; });
      trace.artifact('edit.json', script);
      trace.event('edit', 'completed', script.rationale, { hook: script.hook, cuts: script.cuts, editorial: script.editorial, overlays: script.overlays });
    }
    const run = store.read();
    const selected = run.attempts.find(item => item.gameId === run.selectedGameId)?.capture;
    if (!selected) throw new Error('The saved edit is missing its source recording. Start a new run.');
    // A crash between rendering and saving the manifest cannot block a later render.
    const outputPath = join(directory, `highlight-${randomUUID().slice(0, 8)}.mp4`);
    trace.event('render', 'started', 'Rendering a portrait highlight from the verified cuts.');
    await verifyPresenter();
    const artifact = await services.renderPortrait({ outputPath, cuts: run.script!.cuts.map(cut => ({ ...cut, path: selected.path, crop: selected.crop })), hook: run.script!.hook, overlays: run.script!.overlays, presenter: run.presenterPath ? { path: run.presenterPath } : undefined, attribution: `${selected.game.title} · ${selected.game.creator ?? 'Astrocade'}`, ffmpeg: config.mediaTools, signal: options.signal });
    const videoSha256 = await hashFile(artifact.path);
    await save(state => { state.videoPath = artifact.path; state.videoSha256 = videoSha256; });
    trace.event('render', 'completed', `${artifact.durationSeconds.toFixed(2)}-second video ready. Publishing is manual.`, artifact);
    return await finish();
  } catch (error) {
    const detail = message(error, settings.geminiApiKey);
    trace.event('run', 'failed', detail);
    if (store) { await store.update(run => { run.status = options.signal?.aborted ? 'paused' : 'failed'; run.error = detail; }); await report(directory, store.read()); }
    throw error;
  } finally { await release(); }
}
