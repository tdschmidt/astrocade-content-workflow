import { setTimeout as delay } from 'node:timers/promises';
import type { FrameLocator, Locator, Page } from 'playwright';
import { inputActionSchema, type InputAction, type SurfaceLocator, type UiStep } from './schema.js';

export type GameBounds = { x: number; y: number; width: number; height: number };

export function locate(page: Page, target: SurfaceLocator): Locator {
  let scope: Page | FrameLocator = page;
  for (const selector of target.frames) scope = scope.frameLocator(selector);
  return scope.locator(target.selector);
}

export async function gameBounds(page: Page, target: SurfaceLocator): Promise<GameBounds> {
  const bounds = await locate(page, target).boundingBox();
  if (!bounds || bounds.width < 1 || bounds.height < 1) throw new Error('Game surface is missing or has no visible area.');
  return bounds;
}

export function withinGame(bounds: GameBounds, point: { x: number; y: number }): { x: number; y: number } {
  // boundingBox already includes iframe offsets and uses CSS pixels.
  return { x: bounds.x + Math.min(bounds.width - 1, point.x * bounds.width), y: bounds.y + Math.min(bounds.height - 1, point.y * bounds.height) };
}

export async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const onAbort = () => rejectAbort?.(signal.reason ?? new DOMException('Canceled', 'AbortError'));
  const canceled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  try { return await Promise.race([promise, canceled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** A single owner executes native inputs; no action leaves a held input behind. */
export class InputExecutor {
  private readonly keys = new Set<string>();
  private pointerDown = false;
  executed = 0;

  constructor(readonly page: Page, readonly surface: SurfaceLocator, readonly signal?: AbortSignal) {}

  async execute(value: InputAction): Promise<void> {
    const action = inputActionSchema.parse(value);
    this.signal?.throwIfAborted();
    try {
      if (action.type === 'wait') await delay(action.durationMs, undefined, { signal: this.signal });
      if (action.type === 'key') {
        this.keys.add(action.key);
        await this.page.keyboard.down(action.key);
        await delay(action.durationMs, undefined, { signal: this.signal });
      }
      if (action.type === 'tap') {
        const point = withinGame(await gameBounds(this.page, this.surface), action.point);
        await this.page.mouse.move(point.x, point.y);
        this.pointerDown = true;
        await this.page.mouse.down();
      }
      if (action.type === 'drag') {
        const bounds = await gameBounds(this.page, this.surface);
        const from = withinGame(bounds, action.from);
        const to = withinGame(bounds, action.to);
        await this.page.mouse.move(from.x, from.y);
        this.pointerDown = true;
        await this.page.mouse.down();
        const steps = Math.max(2, Math.ceil(action.durationMs / 40));
        const started = performance.now();
        for (let index = 1; index <= steps; index++) {
          this.signal?.throwIfAborted();
          const wait = started + action.durationMs * index / steps - performance.now();
          if (wait > 0) await delay(wait, undefined, { signal: this.signal });
          await this.page.mouse.move(from.x + (to.x - from.x) * index / steps, from.y + (to.y - from.y) * index / steps);
        }
      }
      this.executed++;
    } finally { await this.releaseAll(); }
  }

  async step(step: UiStep): Promise<void> {
    this.signal?.throwIfAborted();
    if (step.type === 'click') await withAbort(locate(this.page, step.target).click({ timeout: 5000 }), this.signal);
    else if (step.type === 'waitFor') await withAbort(locate(this.page, step.target).waitFor({ state: 'visible', timeout: 5000 }), this.signal);
    else await this.execute(step);
  }

  async releaseAll(): Promise<void> {
    for (const key of this.keys) await this.page.keyboard.up(key).catch(() => {});
    this.keys.clear();
    if (this.pointerDown) await this.page.mouse.up().catch(() => {});
    this.pointerDown = false;
  }
}
