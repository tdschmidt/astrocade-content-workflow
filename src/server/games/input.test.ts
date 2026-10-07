import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { InputExecutor, withinGame, withAbort } from './input.js';
import { gameProfileSchema } from './schema.js';
import { GameCaptureError, runCaptureAttempt } from './runner.js';

test('canceling a held native key releases it before the action rejects', async () => {
  const events: string[] = [];
  const controller = new AbortController();
  const page = { keyboard: { down: async (key: string) => { events.push(`down:${key}`); controller.abort(); }, up: async (key: string) => { events.push(`up:${key}`); } } } as unknown as Page;
  const executor = new InputExecutor(page, { selector: 'canvas', frames: [] }, controller.signal);
  await assert.rejects(executor.execute({ type: 'key', key: 'ArrowRight', durationMs: 2000 }));
  assert.deepEqual(events, ['down:ArrowRight', 'up:ArrowRight']);
  await executor.releaseAll();
  assert.equal(events.length, 2);
});

test('normalized coordinates include the frame offset exactly once and stay inside the surface', () => {
  assert.deepEqual(withinGame({ x: 120, y: 110, width: 600, height: 400 }, { x: 0.5, y: 0.5 }), { x: 420, y: 310 });
  assert.deepEqual(withinGame({ x: 120, y: 110, width: 600, height: 400 }, { x: 1, y: 1 }), { x: 719, y: 509 });
});

test('an aborted model wait cannot deliver a late decision to its caller', async () => {
  const controller = new AbortController();
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  const result = withAbort(pending, controller.signal);
  controller.abort(new Error('attempt superseded'));
  await assert.rejects(result, /attempt superseded/);
  resolve('move');
});

test('unverified profiles are blocked before creating a browser or capture file', async () => {
  const profile = gameProfileSchema.parse({ id: 'unverified', name: 'Unverified', gameUrl: 'https://www.astrocade.com/games/unverified/abc', viewport: { width: 800, height: 600 }, ready: { selector: 'canvas' }, surface: { selector: 'canvas' }, objective: 'A test', controller: { type: 'timed', actions: [{ type: 'wait', durationMs: 100 }] } });
  let created = false;
  await assert.rejects(runCaptureAttempt({ profile, outputPath: '/tmp/should-not-exist.webm', createCapture: async () => { created = true; throw new Error('unexpected'); } }), (error: unknown) => error instanceof GameCaptureError && error.code === 'unverified_profile');
  assert.equal(created, false);
});
