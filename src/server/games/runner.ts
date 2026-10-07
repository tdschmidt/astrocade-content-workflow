import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { createGameCapture, type CaptureArtifact, type CaptureOptions, type GameCapture } from '../media/recorder.js';
import { isAllowedGameUrl } from './discovery.js';
import { gameBounds, InputExecutor, locate, withAbort, type GameBounds } from './input.js';
import { controlDecisionSchema, gameProfileSchema, type GameProfile, type InputAction } from './schema.js';

export type CaptureFailure = 'unreachable' | 'offline' | 'authentication_required' | 'unverified_profile' | 'missing_controls' | 'controller_unavailable' | 'canceled' | 'capture_failed';
export class GameCaptureError extends Error {
  constructor(readonly code: CaptureFailure, message: string, options?: ErrorOptions) { super(message, options); this.name = 'GameCaptureError'; }
}

export type GameplayObservation = {
  observationId: string;
  image: Buffer;
  mimeType: 'image/jpeg';
  gameName: string;
  objective: string;
  elapsedMs: number;
  remainingMs: number;
  previousActions: InputAction[];
  signal: AbortSignal;
};
export type CaptureProgress = { stage: 'loading' | 'ready' | 'recording' | 'deciding' | 'finalizing'; message: string };
export type CaptureAttemptResult = {
  attemptId: string;
  gameUrl: string;
  profileId: string;
  profileVerification: GameProfile['verification'];
  artifact: CaptureArtifact;
  surfaceBounds: GameBounds;
  actionsExecuted: number;
  decisions: { observationId: string; elapsedMs: number; reason: string }[];
  stopReason: 'actions_complete' | 'model_stop' | 'decision_limit' | 'duration_limit';
  startedAt: string;
  finishedAt: string;
};

export async function resetGame(page: Page, profile: GameProfile, signal?: AbortSignal): Promise<void> {
  const executor = new InputExecutor(page, profile.surface, signal);
  try {
    if (profile.reset.length) for (const step of profile.reset) await executor.step(step);
    else await withAbort(page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }), signal);
    await withAbort(locate(page, profile.ready).waitFor({ state: 'visible', timeout: 10000 }), signal);
  } finally { await executor.releaseAll(); }
}

export async function runCaptureAttempt(options: {
  profile: GameProfile;
  outputPath: string;
  signal?: AbortSignal;
  onProgress?: (progress: CaptureProgress) => void;
  decide?: (observation: GameplayObservation) => Promise<unknown>;
  allowUnverified?: boolean;
  allowLocalGame?: boolean;
  recorderOptions?: Pick<CaptureOptions, 'headless' | 'ffmpeg'>;
  /** Test seam; production uses the native recorder. */
  createCapture?: (options: CaptureOptions) => Promise<GameCapture>;
}): Promise<CaptureAttemptResult> {
  const profile = gameProfileSchema.parse(options.profile);
  if (profile.verification !== 'verified' && !options.allowUnverified) throw new GameCaptureError('unverified_profile', 'This game profile has not been verified. Inspect its controls before explicitly testing it.');
  if (!isAllowedGameUrl(profile.gameUrl, options.allowLocalGame)) throw new GameCaptureError('unreachable', 'Capture requires an Astrocade game URL. Local fixture URLs require an explicit test option.');
  if (profile.controller.type === 'sparse' && !options.decide) throw new GameCaptureError('controller_unavailable', 'This profile requires the configured visual decision provider.');
  options.signal?.throwIfAborted();
  const attemptId = randomUUID();
  const startedAt = new Date().toISOString();
  const session = await (options.createCapture ?? createGameCapture)({
    outputPath: options.outputPath, viewport: profile.viewport, maxDurationMs: profile.maxDurationMs + 5000,
    signal: options.signal, ...options.recorderOptions,
  });
  const page = session.page;
  page.setDefaultTimeout(5000);
  let executor = new InputExecutor(page, profile.surface, options.signal);
  const budget = new AbortController();
  const controlSignal = options.signal ? AbortSignal.any([options.signal, budget.signal]) : budget.signal;
  let timer: NodeJS.Timeout | undefined;
  let recordingStarted = 0;
  let stopReason: CaptureAttemptResult['stopReason'] = 'actions_complete';
  const decisions: CaptureAttemptResult['decisions'] = [];
  let lastBounds: GameBounds | undefined;
  try {
    options.onProgress?.({ stage: 'loading', message: `Opening ${profile.name}.` });
    let response;
    try { response = await withAbort(page.goto(profile.gameUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }), options.signal); }
    catch (error) { throw new GameCaptureError('unreachable', 'The live game page could not be reached.', { cause: error }); }
    if (response && response.status() >= 400) throw new GameCaptureError('unreachable', `Game page returned HTTP ${response.status()}.`);
    const body = (await page.locator('body').innerText()).slice(0, 5000);
    if (/you(?:'|’)re offline|you are offline|check your internet connection/i.test(body)) throw new GameCaptureError('offline', 'Astrocade displayed its offline page. No gameplay was captured.');
    if (/\/login(?:\/|\?|$)/.test(page.url())) throw new GameCaptureError('authentication_required', 'The game requires sign-in; this profile does not supply an Astrocade session.');
    try {
      for (const step of profile.setup) await executor.step(step);
      await withAbort(locate(page, profile.ready).waitFor({ state: 'visible', timeout: 10000 }), options.signal);
      await withAbort(locate(page, profile.surface).waitFor({ state: 'visible', timeout: 10000 }), options.signal);
    } catch (error) { throw new GameCaptureError('missing_controls', 'The configured game surface or ready/start controls were not found.', { cause: error }); }
    options.onProgress?.({ stage: 'ready', message: 'Game surface is visible; starting recording before gameplay.' });
    lastBounds = await gameBounds(page, profile.surface);
    await session.start();
    recordingStarted = performance.now();
    timer = setTimeout(() => budget.abort(new Error('Capture duration budget reached.')), profile.maxDurationMs);
    executor = new InputExecutor(page, profile.surface, controlSignal);
    options.onProgress?.({ stage: 'recording', message: 'Recording real gameplay.' });
    try {
      for (const step of profile.start) await executor.step(step);
      lastBounds = await gameBounds(page, profile.surface).catch(() => lastBounds!);
      if (profile.focus === 'click') await executor.step({ type: 'click', target: profile.surface });
      else await withAbort(locate(page, profile.surface).focus(), controlSignal);
      if (profile.controller.type === 'timed') {
        for (let iteration = 0; iteration < profile.controller.repetitions; iteration++) {
          for (const action of profile.controller.actions) await executor.execute(action);
        }
      } else {
        stopReason = 'decision_limit';
        let previousActions: InputAction[] = [];
        for (let index = 0; index < profile.controller.maxDecisions; index++) {
          controlSignal.throwIfAborted();
          const observationId = `${attemptId}:${index}`;
          const elapsedMs = Math.round(performance.now() - recordingStarted);
          const clip = await withAbort(gameBounds(page, profile.surface), controlSignal);
          const image = await withAbort(page.screenshot({ clip, type: 'jpeg', quality: 70, timeout: 5000 }), controlSignal);
          options.onProgress?.({ stage: 'deciding', message: `Visual decision ${index + 1} of ${profile.controller.maxDecisions}.` });
          const decision = controlDecisionSchema.parse(await withAbort(options.decide!({ observationId, image, mimeType: 'image/jpeg', gameName: profile.name, objective: profile.objective, elapsedMs, remainingMs: Math.max(0, profile.maxDurationMs - elapsedMs), previousActions, signal: controlSignal }), controlSignal));
          controlSignal.throwIfAborted();
          decisions.push({ observationId, elapsedMs, reason: decision.reason });
          if (decision.stop) { stopReason = 'model_stop'; break; }
          if (!decision.actions.length) throw new GameCaptureError('missing_controls', 'The controller supplied neither an action nor a stop decision.');
          previousActions = decision.actions;
          for (const action of decision.actions) await executor.execute(action);
        }
      }
    } catch (error) {
      if (budget.signal.aborted && !options.signal?.aborted) stopReason = 'duration_limit';
      else throw error;
    } finally { clearTimeout(timer); await executor.releaseAll(); }
    options.signal?.throwIfAborted();
    const surfaceBounds = await gameBounds(page, profile.surface).catch(() => lastBounds!);
    options.onProgress?.({ stage: 'finalizing', message: 'Flushing and validating the source recording.' });
    const artifact = await session.finish();
    return { attemptId, gameUrl: profile.gameUrl, profileId: profile.id, profileVerification: profile.verification, artifact, surfaceBounds, actionsExecuted: executor.executed, decisions, stopReason, startedAt, finishedAt: new Date().toISOString() };
  } catch (error) {
    await session.cancel().catch(() => {});
    if (options.signal?.aborted) throw new GameCaptureError('canceled', 'Gameplay capture was canceled.');
    if (error instanceof GameCaptureError) throw error;
    throw new GameCaptureError('capture_failed', error instanceof Error ? error.message : 'Gameplay capture failed.', { cause: error });
  } finally { clearTimeout(timer); await executor.releaseAll(); await session.close(); }
}
