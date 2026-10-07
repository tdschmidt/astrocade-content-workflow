import { setTimeout as delay } from 'node:timers/promises';
import type { FrameLocator, Locator, Page } from 'playwright';
import { inputActionSchema, type InputAction, type SurfaceLocator, type UiStep } from './schema.js';

export type GameBounds = { x: number; y: number; width: number; height: number };
class ControlNotReadyError extends Error {}

export function locate(page: Page, target: SurfaceLocator): Locator {
  let scope: Page | FrameLocator = page;
  for (const selector of target.frames) scope = scope.frameLocator(selector);
  return scope.locator(target.selector);
}

async function elementGeometry(locator: Locator) {
  return locator.evaluate(element => {
    // getBoundingClientRect includes scale within this document. Chromium's cross-frame
    // boundingBox can omit the iframe's transform, so compose document boundaries ourselves.
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const transform = getComputedStyle(ancestor).transform;
      if (transform === 'none') continue;
      const matrix = new DOMMatrixReadOnly(transform);
      if (!matrix.is2D || matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.b) > 0.00001 || Math.abs(matrix.c) > 0.00001) throw new Error('Rotated, mirrored, or perspective game surfaces are unsupported.');
    }
    const rect = element.getBoundingClientRect();
    const html = element as HTMLElement;
    return {
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      layout: { width: html.offsetWidth, height: html.offsetHeight, borderLeft: element.clientLeft, borderTop: element.clientTop },
    };
  });
}

function assertInside(bounds: GameBounds, viewport: { width: number; height: number }) {
  if (bounds.width < 1 || bounds.height < 1) throw new Error('Game surface is missing or has no visible area.');
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > viewport.width + 0.5 || bounds.y + bounds.height > viewport.height + 0.5) throw new Error('Game surface is clipped or outside the viewport. Adjust the profile viewport before capture.');
}

async function assertHit(locator: Locator, bounds: GameBounds) {
  const result = await locator.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return { visible: hit !== null && (hit === element || element.contains(hit)), blocker: hit?.getAttribute('aria-label') || hit?.tagName || 'outside the document' };
  }, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  if (!result.visible) throw new ControlNotReadyError(`The requested game control is covered by ${result.blocker.slice(0, 100)}.`);
}

async function composedBounds(page: Page, target: SurfaceLocator, checkHit = false): Promise<GameBounds> {
  let scope: Page | FrameLocator = page;
  const frames: Locator[] = [];
  for (const selector of target.frames) {
    frames.push(scope.locator(selector));
    scope = scope.frameLocator(selector);
  }
  const locator = scope.locator(target.selector);
  const geometry = await elementGeometry(locator);
  let bounds = geometry.bounds;
  assertInside(bounds, geometry.viewport);
  if (checkHit) await assertHit(locator, bounds);
  for (const frame of frames.reverse()) {
    const parent = await elementGeometry(frame);
    const scaleX = parent.bounds.width / parent.layout.width;
    const scaleY = parent.bounds.height / parent.layout.height;
    bounds = {
      x: parent.bounds.x + (parent.layout.borderLeft + bounds.x) * scaleX,
      y: parent.bounds.y + (parent.layout.borderTop + bounds.y) * scaleY,
      width: bounds.width * scaleX, height: bounds.height * scaleY,
    };
    assertInside(bounds, parent.viewport);
    if (checkHit) await assertHit(frame, bounds);
  }
  return bounds;
}

export async function gameBounds(page: Page, target: SurfaceLocator): Promise<GameBounds> {
  return composedBounds(page, target);
}

export async function gameHasPointerLock(page: Page, surface: SurfaceLocator): Promise<boolean> {
  const target = locate(page, surface);
  // Read the browser's input mode, never game state. New profiles use the whole
  // iframe; older profiles locate a canvas inside its document.
  const documentRoot = await target.evaluate(element => element.tagName === 'IFRAME')
    ? target.contentFrame().locator(':root') : target;
  return documentRoot.evaluate(element => element.ownerDocument.pointerLockElement !== null);
}

// Setup and gameplay use separate executors on the same page. Retain only our
// own native cursor position; a relative look must never guess its origin.
const nativeMousePositions = new WeakMap<Page, { x: number; y: number }>();

export function withinGame(bounds: GameBounds, point: { x: number; y: number }): { x: number; y: number } {
  // Composed bounds include every iframe's displayed scale and border offset.
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
  private heldPointerButton: 'left' | 'right' | undefined;
  executed = 0;

  constructor(readonly page: Page, readonly surface: SurfaceLocator, readonly signal?: AbortSignal) {}

  private async moveMouse(x: number, y: number): Promise<void> {
    try {
      await this.page.mouse.move(x, y);
      nativeMousePositions.set(this.page, { x, y });
    } catch (error) { nativeMousePositions.delete(this.page); throw error; }
  }

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
        // In mouse-look mode, repositioning before a click changes the aim.
        // The native button must act on the current crosshair instead.
        if (!await gameHasPointerLock(this.page, this.surface)) await this.moveMouse(point.x, point.y);
        this.heldPointerButton = action.button ?? 'left';
        await this.page.mouse.down({ button: this.heldPointerButton });
      }
      if (action.type === 'look') {
        const origin = nativeMousePositions.get(this.page);
        if (!await gameHasPointerLock(this.page, this.surface)) throw new Error('Relative look requires active pointer lock in the game.');
        if (!origin) throw new Error('Relative look requires a native mouse position established by this executor.');
        const started = performance.now();
        const steps = Math.ceil(action.durationMs / 40);
        for (let index = 1; index <= steps; index++) {
          this.signal?.throwIfAborted();
          const wait = started + action.durationMs * index / steps - performance.now();
          if (wait > 0) await delay(wait, undefined, { signal: this.signal });
          // Lock can be lost while a menu opens or the user presses Escape.
          if (!await gameHasPointerLock(this.page, this.surface)) throw new Error('Pointer lock was lost during relative look.');
          this.signal?.throwIfAborted();
          await this.moveMouse(origin.x + action.dx * index / steps, origin.y + action.dy * index / steps);
        }
      }
      if (action.type === 'drag' || action.type === 'path') {
        const bounds = await gameBounds(this.page, this.surface);
        const points = (action.type === 'drag' ? [action.from, action.to] : action.points).map(point => withinGame(bounds, point));
        const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
        const totalLength = lengths.reduce((sum, length) => sum + length, 0);
        await this.moveMouse(points[0]!.x, points[0]!.y);
        this.heldPointerButton = action.button ?? 'left';
        await this.page.mouse.down({ button: this.heldPointerButton });
        const started = performance.now();
        let elapsed = 0;
        for (let segment = 0; segment < lengths.length; segment++) {
          const from = points[segment]!, to = points[segment + 1]!;
          // Proportional timing keeps speed steady and visits every waypoint.
          // A stationary path retains its bounded hold without dividing by zero.
          const duration = action.durationMs * (totalLength ? lengths[segment]! / totalLength : 1 / lengths.length);
          const steps = Math.max(1, Math.ceil(duration / 40));
          for (let index = 1; index <= steps; index++) {
            this.signal?.throwIfAborted();
            const wait = started + elapsed + duration * index / steps - performance.now();
            if (wait > 0) await delay(wait, undefined, { signal: this.signal });
            await this.moveMouse(from.x + (to.x - from.x) * index / steps, from.y + (to.y - from.y) * index / steps);
          }
          elapsed += duration;
        }
      }
      this.executed++;
    } finally { await this.releaseAll(); }
  }

  async step(step: UiStep): Promise<void> {
    this.signal?.throwIfAborted();
    if (step.type === 'click') {
      const target = locate(this.page, step.target);
      await withAbort(target.waitFor({ state: 'visible', timeout: 5000 }), this.signal);
      const deadline = performance.now() + 5000;
      let bounds: GameBounds;
      for (;;) {
        this.signal?.throwIfAborted();
        try {
          if (!await target.isEnabled()) throw new ControlNotReadyError('The requested game control is disabled.');
          bounds = await withAbort(composedBounds(this.page, step.target, true), this.signal);
          break;
        } catch (error) {
          if (!(error instanceof ControlNotReadyError)) throw error;
          if (performance.now() >= deadline) throw new Error(`Control ${step.target.selector} did not become actionable within 5 seconds: ${error.message}`, { cause: error });
          await delay(100, undefined, { signal: this.signal });
        }
      }
      this.signal?.throwIfAborted();
      // Only readiness is retried. Once input is dispatched, never replay the click.
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      try {
        await this.page.mouse.click(point.x, point.y);
        nativeMousePositions.set(this.page, point);
      } catch (error) { nativeMousePositions.delete(this.page); throw error; }
    }
    else if (step.type === 'waitFor') await withAbort(locate(this.page, step.target).waitFor({ state: 'visible', timeout: 5000 }), this.signal);
    else await this.execute(step);
  }

  async releaseAll(): Promise<void> {
    for (const key of this.keys) await this.page.keyboard.up(key).catch(() => {});
    this.keys.clear();
    if (this.heldPointerButton) await this.page.mouse.up({ button: this.heldPointerButton }).catch(() => {});
    this.heldPointerButton = undefined;
  }
}
