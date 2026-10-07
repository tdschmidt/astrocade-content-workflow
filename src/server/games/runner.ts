import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright';
import { createGameCapture, type CaptureArtifact, type CaptureOptions, type GameCapture } from '../media/recorder.js';
import { isAllowedGameUrl } from './discovery.js';
import { gameBounds, gameHasPointerLock, InputExecutor, locate, withAbort, type GameBounds } from './input.js';
import { controlDecisionSchema, gameProfileSchema, type GameProfile, type InputAction, type UiStep } from './schema.js';

export type CaptureFailure = 'unreachable' | 'offline' | 'authentication_required' | 'unverified_profile' | 'missing_controls' | 'controller_unavailable' | 'canceled' | 'capture_failed';
export class GameCaptureError extends Error {
  constructor(readonly code: CaptureFailure, message: string, options?: ErrorOptions) { super(message, options); this.name = 'GameCaptureError'; }
}

export type GameplayObservation = {
  observationId: string;
  image: Buffer;
  mimeType: 'image/jpeg';
  text: string;
  /** Current browser input mode, read independently of game state. */
  pointerLocked: boolean;
  gameName: string;
  objective: string;
  elapsedMs: number;
  remainingMs: number;
  previousActions: InputAction[];
  previousImage?: Buffer;
  previousReason?: string;
  /** The last model call evaluates the preceding inputs without starting another batch. */
  isFinal: boolean;
  signal: AbortSignal;
};
export type CaptureProgress = { stage: 'loading' | 'ready' | 'recording' | 'deciding' | 'finalizing'; message: string };
export type ActionProgress = { phase: 'setup' | 'start' | 'focus' | 'control'; status: 'started' | 'completed'; action: UiStep; recordingElapsedMs: number | null };
export type CaptureAttemptResult = {
  attemptId: string;
  gameUrl: string;
  profileId: string;
  profileVerification: GameProfile['verification'];
  artifact: CaptureArtifact;
  surfaceBounds: GameBounds;
  actionsExecuted: number;
  decisions: { observationId: string; elapsedMs: number; reason: string }[];
  stopReason: 'actions_complete' | 'model_stop' | 'decision_limit' | 'duration_limit' | 'controller_error';
  controllerError?: string;
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
  onAction?: (action: ActionProgress) => void;
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
  const perform = async (phase: ActionProgress['phase'], action: UiStep, execute: () => Promise<void>) => {
    const emit = (status: ActionProgress['status']) => options.onAction?.({ phase, status, action, recordingElapsedMs: recordingStarted ? Math.round(performance.now() - recordingStarted) : null });
    emit('started'); await execute(); emit('completed');
  };
  let stopReason: CaptureAttemptResult['stopReason'] = 'actions_complete';
  let controllerError: string | undefined;
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
      for (const step of profile.setup) await perform('setup', step, () => executor.step(step));
      await withAbort(locate(page, profile.ready).waitFor({ state: 'visible', timeout: 10000 }), options.signal);
      await withAbort(locate(page, profile.surface).waitFor({ state: 'attached', timeout: 10000 }), options.signal);
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0]!.slice(0, 500) : 'Unknown control error.';
      throw new GameCaptureError('missing_controls', `Game setup could not reach its ready controls: ${detail}`, { cause: error });
    }
    options.onProgress?.({ stage: 'ready', message: 'Game surface is visible; starting recording before gameplay.' });
    await session.start();
    recordingStarted = performance.now();
    timer = setTimeout(() => budget.abort(new Error('Capture duration budget reached.')), profile.maxDurationMs);
    executor = new InputExecutor(page, profile.surface, controlSignal);
    options.onProgress?.({ stage: 'recording', message: 'Recording real gameplay.' });
    try {
      for (const step of profile.start) await perform('start', step, () => executor.step(step));
      // Some games reveal the canvas only after their DOM Start button is clicked.
      await withAbort(locate(page, profile.surface).waitFor({ state: 'visible', timeout: 10000 }), controlSignal);
      lastBounds = await gameBounds(page, profile.surface);
      if (profile.focus === 'click') {
        const click = { type: 'click' as const, target: profile.surface };
        await perform('focus', click, () => executor.step(click));
      }
      else await withAbort(locate(page, profile.surface).focus(), controlSignal);
      if (profile.controller.type === 'timed') {
        for (let iteration = 0; iteration < profile.controller.repetitions; iteration++) {
          for (const action of profile.controller.actions) await perform('control', action, () => executor.execute(action));
        }
      } else {
        stopReason = 'decision_limit';
        let previousActions: InputAction[] = [];
        let previousImage: Buffer | undefined;
        let previousReason: string | undefined;
        for (let index = 0; index < profile.controller.maxDecisions; index++) {
          controlSignal.throwIfAborted();
          if (profile.maxDurationMs - (performance.now() - recordingStarted) < 2000) { stopReason = 'duration_limit'; break; }
          const observationId = `${attemptId}:${index}`;
          const clip = await withAbort(gameBounds(page, profile.surface), controlSignal);
          const image = await withAbort(page.screenshot({ clip, type: 'jpeg', quality: 70, timeout: 5000 }), controlSignal);
          const surface = locate(page, profile.surface);
          const textSurface = await withAbort(surface.evaluate(element => element.tagName === 'IFRAME'), controlSignal)
            ? surface.contentFrame().locator('body') : surface;
          const text = await withAbort(textSurface.evaluate(element => element.ownerDocument.body.innerText.slice(0, 6000)), controlSignal);
          const pointerLocked = await withAbort(gameHasPointerLock(page, profile.surface), controlSignal);
          const elapsedMs = Math.round(performance.now() - recordingStarted);
          const remainingMs = Math.max(0, profile.maxDurationMs - elapsedMs);
          if (remainingMs < 2000) { stopReason = 'duration_limit'; break; }
          const isFinal = index === profile.controller.maxDecisions - 1;
          const decisionSignal = AbortSignal.any([controlSignal, AbortSignal.timeout(Math.min(30000, remainingMs))]);
          options.onProgress?.({ stage: 'deciding', message: `Visual decision ${index + 1} of ${profile.controller.maxDecisions}.` });
          let decision;
          try {
            decision = controlDecisionSchema.parse(await withAbort(options.decide!({ observationId, image, mimeType: 'image/jpeg', text, pointerLocked, gameName: profile.name, objective: profile.objective, elapsedMs, remainingMs, previousActions, previousImage, previousReason, isFinal, signal: decisionSignal }), decisionSignal));
            if (!decision.stop && !isFinal && !decision.actions.length) throw new GameCaptureError('missing_controls', 'The controller supplied neither an action nor a stop decision.');
          } catch (error) {
            if (controlSignal.aborted || !previousActions.length) throw error;
            // Preserve footage already played when a later inference fails.
            controllerError = error instanceof Error ? error.message.slice(0, 1000) : 'The gameplay controller failed.';
            stopReason = 'controller_error';
            break;
          }
          controlSignal.throwIfAborted();
          decisions.push({ observationId, elapsedMs, reason: decision.reason });
          if (decision.stop) { stopReason = 'model_stop'; break; }
          if (isFinal) break;
          previousActions = decision.actions;
          previousImage = image;
          previousReason = decision.reason;
          for (const action of decision.actions) await perform('control', action, () => executor.execute(action));
          // Rejected puzzle pieces can animate back for longer than one frame.
          // Observe their resting positions before a slow model chooses coordinates.
          await delay(1000, undefined, { signal: controlSignal });
        }
      }
    } catch (error) {
      if (budget.signal.aborted && !options.signal?.aborted) stopReason = 'duration_limit';
      else throw error;
    } finally { clearTimeout(timer); await executor.releaseAll(); }
    options.signal?.throwIfAborted();
    const surfaceBounds = await gameBounds(page, profile.surface).catch(() => lastBounds);
    if (!surfaceBounds) throw new GameCaptureError('missing_controls', 'The game never exposed a visible capture surface.');
    options.onProgress?.({ stage: 'finalizing', message: 'Flushing and validating the source recording.' });
    const artifact = await session.finish();
    return { attemptId, gameUrl: profile.gameUrl, profileId: profile.id, profileVerification: profile.verification, artifact, surfaceBounds, actionsExecuted: executor.executed, decisions, stopReason, ...(controllerError ? { controllerError } : {}), startedAt, finishedAt: new Date().toISOString() };
  } catch (error) {
    await session.cancel().catch(() => {});
    if (options.signal?.aborted) throw new GameCaptureError('canceled', 'Gameplay capture was canceled.');
    if (error instanceof GameCaptureError) throw error;
    throw new GameCaptureError('capture_failed', error instanceof Error ? error.message : 'Gameplay capture failed.', { cause: error });
  } finally { clearTimeout(timer); await executor.releaseAll(); await session.close(); }
}
