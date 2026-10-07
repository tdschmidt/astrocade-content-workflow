import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chromium, type Page } from 'playwright';
import { InputExecutor, withinGame, withAbort } from './input.js';
import { gameProfileSchema, inputActionSchema, plannedInputActionSchema } from './schema.js';
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

test('simultaneous keys are unique, bounded and compatible with old single-key actions', () => {
  const action = { type: 'keys', keys: ['KeyW', 'Space'], durationMs: 6000 };
  assert.deepEqual(inputActionSchema.parse(action), action);
  assert.deepEqual(plannedInputActionSchema.parse({ ...action, keys: ['KeyW', 'Space', 'KeyX'] }), { ...action, keys: ['KeyW', 'Space', 'KeyX'] });
  assert.ok(inputActionSchema.safeParse({ type: 'key', key: 'KeyW', durationMs: 6000 }).success);
  assert.ok(inputActionSchema.safeParse({ type: 'key', key: 'KeyW', durationMs: 100 }).success);
  for (const invalid of [
    { ...action, keys: ['KeyW'] }, { ...action, keys: ['KeyW', 'KeyW'] },
    { ...action, keys: ['KeyW', 'Space', 'KeyX', 'KeyC'] }, { ...action, keys: ['KeyW', 'Shift'] },
    { ...action, durationMs: 19 }, { ...action, durationMs: 6001 }, { ...action, durationMs: 20.5 },
    { ...action, button: 'left' }, { ...action, key: 'KeyW' },
  ]) {
    assert.equal(inputActionSchema.safeParse(invalid).success, false);
    assert.equal(plannedInputActionSchema.safeParse(invalid).success, false);
  }
});

for (const failure of ['abort', 'input error'] as const) test(`${failure} while pressing simultaneous keys releases every attempted key`, async () => {
  const events: string[] = [];
  const abort = new AbortController();
  const page = { keyboard: {
    down: async (key: string) => {
      events.push(`down:${key}`);
      if (key === 'Space') {
        if (failure === 'abort') abort.abort(new Error('Stop the chord'));
        else throw new Error('Native input failed');
      }
    },
    up: async (key: string) => { events.push(`up:${key}`); },
  } } as unknown as Page;
  const executor = new InputExecutor(page, { selector: 'canvas', frames: [] }, abort.signal);
  await assert.rejects(executor.execute({ type: 'keys', keys: ['KeyW', 'Space', 'KeyX'], durationMs: 6000 }));
  assert.deepEqual(events, ['down:KeyW', 'down:Space', 'up:KeyW', 'up:Space']);
  assert.equal(executor.executed, 0);
  await executor.releaseAll();
  assert.equal(events.length, 4);
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

test('pointer paths have bounded normalized points and duration', () => {
  const valid = { type: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], durationMs: 50 };
  assert.deepEqual(inputActionSchema.parse(valid), valid);
  assert.ok(inputActionSchema.safeParse({ ...valid, points: Array.from({ length: 32 }, (_, index) => ({ x: index / 31, y: 0.5 })), durationMs: 2000 }).success);
  for (const invalid of [
    { ...valid, points: [] }, { ...valid, points: [{ x: 0, y: 0 }] },
    { ...valid, points: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 })) },
    { ...valid, points: [{ x: -0.1, y: 0 }, { x: 1, y: 1 }] },
    { ...valid, points: [{ x: 0, y: 0 }, { x: 1, y: 1.1 }] },
    { ...valid, points: [{ x: Number.NaN, y: 0 }, { x: 1, y: 1 }] },
    { ...valid, durationMs: 49 }, { ...valid, durationMs: 2001 }, { ...valid, durationMs: 100.5 },
  ]) assert.equal(inputActionSchema.safeParse(invalid).success, false);
});

test('pointer actions accept one optional left or right button without changing older profiles', () => {
  const actions = [
    { type: 'tap', point: { x: 0.2, y: 0.2 } },
    { type: 'drag', from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.2 }, durationMs: 100 },
    { type: 'path', points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }], durationMs: 100 },
  ];
  for (const action of actions) {
    assert.deepEqual(inputActionSchema.parse(action), action);
    for (const button of ['left', 'right']) assert.deepEqual(inputActionSchema.parse({ ...action, button }), { ...action, button });
    for (const button of ['middle', ['left', 'right'], null]) assert.equal(inputActionSchema.safeParse({ ...action, button }).success, false);
  }
});

test('relative look has bounded signed CSS-pixel deltas and no button or absolute point', () => {
  const action = { type: 'look', dx: -200, dy: 200, durationMs: 50 };
  assert.deepEqual(inputActionSchema.parse(action), action);
  assert.deepEqual(plannedInputActionSchema.parse({ ...action, dx: 0, dy: -0.5, durationMs: 2000 }), { ...action, dx: 0, dy: -0.5, durationMs: 2000 });
  for (const invalid of [
    { ...action, dx: -201 }, { ...action, dy: 201 }, { ...action, dx: Number.NaN }, { ...action, dy: Infinity },
    { ...action, durationMs: 49 }, { ...action, durationMs: 2001 }, { ...action, durationMs: 50.5 },
    { ...action, button: 'left' }, { ...action, point: { x: 0.5, y: 0.5 } },
    { type: 'look', dx: 20, dy: 0 },
  ]) {
    assert.equal(inputActionSchema.safeParse(invalid).success, false);
    assert.equal(plannedInputActionSchema.safeParse(invalid).success, false);
  }
  const legacy = gameProfileSchema.parse({ id: 'legacy-look', name: 'Legacy', gameUrl: 'https://www.astrocade.com/games/fixture/abc', viewport: { width: 800, height: 600 }, ready: { selector: 'canvas' }, surface: { selector: 'canvas' }, objective: 'Use visible controls.', controller: { type: 'sparse', allowPointer: true } });
  assert.equal(legacy.controller.type === 'sparse' && legacy.controller.allowLook, undefined, 'old profiles do not acquire look permission');
});

type PointerEventRecord = { type: string; x: number; y: number; button: number; buttons: number; trusted: boolean };
async function pathFixture(t: TestContext) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.setContent('<style>body{margin:0}iframe{position:absolute;left:40px;top:60px;width:400px;height:400px;border:4px solid black;transform:scale(.75);transform-origin:top left}</style><iframe id="game"></iframe>');
  const frame = page.frames()[1]!;
  await frame.setContent(`<style>body{margin:0}canvas{display:block;background:#234}</style><canvas width="400" height="400"></canvas><script>
    const canvas=document.querySelector('canvas'),events=[];
    for(const type of ['pointerdown','pointermove','pointerup','contextmenu']) canvas.addEventListener(type,event=>{
      if(event.type==='contextmenu') event.preventDefault();
      events.push({type:event.type,x:event.offsetX,y:event.offsetY,button:event.button,buttons:event.buttons,trusted:event.isTrusted});
      document.body.dataset.events=JSON.stringify(events);
      if(event.type==='pointermove'&&event.buttons&&window.abortPath) void window.abortPath();
    });
  </script>`);
  const events = async (): Promise<PointerEventRecord[]> => JSON.parse(await frame.locator('body').getAttribute('data-events') ?? '[]');
  return { page, frame, events, surface: { selector: 'canvas', frames: ['#game'] } };
}

test('a native pointer path visits every corner through a scaled iframe with one press and release', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const { page, events, surface } = await pathFixture(t);
  const points = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.5 }, { x: 0.2, y: 0.5 }, { x: 0.2, y: 0.2 }];
  const executor = new InputExecutor(page, surface);
  await executor.execute({ type: 'path', points, durationMs: 600 });
  const observed = await events();
  assert.equal(observed.filter(event => event.type === 'pointerdown').length, 1);
  assert.equal(observed.filter(event => event.type === 'pointerup').length, 1);
  assert.ok(observed.every(event => event.trusted));
  const held = observed.slice(observed.findIndex(event => event.type === 'pointerdown') + 1, -1);
  assert.ok(held.length >= points.length - 1);
  assert.ok(held.every(event => event.type === 'pointermove' && event.buttons === 1), 'the pointer must remain down between corners');
  let last = -1;
  for (const point of points.slice(1)) {
    const next = held.findIndex((event, index) => index > last && Math.abs(event.x - point.x * 400) < 1 && Math.abs(event.y - point.y * 400) < 1);
    assert.ok(next > last, `missing ordered waypoint ${JSON.stringify(point)}`);
    last = next;
  }
  assert.equal(observed.at(-1)!.buttons, 0);
  assert.equal(executor.executed, 1);
  await executor.releaseAll();
  assert.deepEqual(await events(), observed, 'cleanup must not release a second time');
});

for (const button of ['left', 'right'] as const) test(`canceling a native ${button} pointer path releases that button and prevents later segments`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const { page, events, surface } = await pathFixture(t);
  const abort = new AbortController();
  await page.exposeFunction('abortPath', () => abort.abort(new Error('Stop the path')));
  const executor = new InputExecutor(page, surface, abort.signal);
  await assert.rejects(executor.execute({ type: 'path', button, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }], durationMs: 1500 }), /Stop the path|aborted/i);
  const observed = await events();
  assert.equal(observed.filter(event => event.type === 'pointerdown').length, 1);
  assert.equal(observed.filter(event => event.type === 'pointerup').length, 1);
  assert.ok(observed.every(event => event.trusted));
  assert.equal(observed.at(-1)!.type, 'pointerup');
  assert.equal(observed.at(-1)!.button, button === 'left' ? 0 : 2);
  assert.equal(observed.at(-1)!.buttons, 0);
  assert.ok(observed.filter(event => event.type === 'pointermove' && event.buttons).every(event => event.buttons === (button === 'left' ? 1 : 2)));
  assert.ok(observed.every(event => event.y < 100), 'cancellation must stop before the second segment');
  assert.equal(executor.executed, 0);
  await executor.releaseAll();
  assert.deepEqual(await events(), observed, 'cleanup must not release a second time');
});

test('native right taps, drags and paths send trusted secondary-button input and release before a left tap', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const { page, events, surface } = await pathFixture(t);
  const executor = new InputExecutor(page, surface);
  const actions = [
    { type: 'tap' as const, point: { x: 0.2, y: 0.2 } },
    { type: 'drag' as const, from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.2 }, durationMs: 150 },
    { type: 'path' as const, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }], durationMs: 300 },
  ];
  let count = 0;
  for (const action of actions) {
    await executor.execute({ ...action, button: 'right' });
    const all = await events(), observed = all.slice(count);
    count = all.length;
    assert.ok(observed.every(event => event.trusted));
    const presses = observed.filter(event => event.type === 'pointerdown');
    const releases = observed.filter(event => event.type === 'pointerup');
    assert.equal(presses.length, 1);
    assert.equal(presses[0]!.button, 2);
    assert.equal(presses[0]!.buttons, 2);
    assert.equal(releases.length, 1);
    assert.equal(releases[0]!.button, 2);
    assert.equal(releases[0]!.buttons, 0);
    assert.equal(observed.filter(event => event.type === 'contextmenu' && event.button === 2).length, 1);
    const held = observed.filter(event => event.type === 'pointermove' && event.buttons);
    if (action.type !== 'tap') assert.ok(held.length > 1);
    assert.ok(held.every(event => event.buttons === 2));
  }
  await executor.execute({ type: 'tap', point: { x: 0.5, y: 0.5 } });
  const last = (await events()).slice(count);
  assert.equal(last.find(event => event.type === 'pointerdown')!.buttons, 1, 'right must be released before the default left action');
  assert.equal(last.at(-1)!.button, 0);
  assert.equal(last.at(-1)!.buttons, 0);
  assert.equal(executor.executed, 4);
});

for (const wholeFrame of [false, true]) test(`a locked ${wholeFrame ? 'iframe' : 'canvas'} click preserves current aim and unlocked clicks still target coordinates`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const gameHtml = `<style>body{margin:0}canvas{display:block;background:#234}</style><canvas width="400" height="400"></canvas><script>
    const canvas=document.querySelector('canvas');
    document.body.dataset.moves='0';
    canvas.addEventListener('click',()=>{if(!document.pointerLockElement) void canvas.requestPointerLock().catch(error=>{document.body.dataset.lockError=error.message})});
    document.addEventListener('keydown',event=>{if(event.key==='Escape') document.exitPointerLock()});
    canvas.addEventListener('mousemove',event=>{
      document.body.dataset.moves=String(Number(document.body.dataset.moves)+Math.abs(event.movementX)+Math.abs(event.movementY));
    });
    canvas.addEventListener('mousedown',event=>{
      document.body.dataset.down=JSON.stringify({button:event.button,x:event.offsetX,y:event.offsetY,trusted:event.isTrusted,locked:!!document.pointerLockElement});
    });
    canvas.addEventListener('contextmenu',event=>event.preventDefault());
  </script>`;
  // Pointer Lock requires an active navigated document, not an about:blank
  // frame replaced by document.write/setContent.
  await page.route('https://pointer-lock.test/**', route => route.fulfill({ contentType: 'text/html', body:
    new URL(route.request().url()).pathname === '/game' ? gameHtml :
      '<style>body{margin:0}iframe{width:400px;height:400px;border:0}</style><iframe id="game" src="/game"></iframe>',
  }));
  await page.goto('https://pointer-lock.test/');
  const frame = page.frames()[1]!;
  const surface = wholeFrame ? { selector: '#game', frames: [] } : { selector: 'canvas', frames: ['#game'] };
  const executor = new InputExecutor(page, surface);
  await executor.execute({ type: 'tap', point: { x: 0.2, y: 0.2 } });
  await frame.waitForFunction(() => document.pointerLockElement !== null, undefined, { timeout: 3000 }).catch(async error => {
    assert.fail(`Lock was not acquired: ${error.message}; ${JSON.stringify(await frame.locator('body').evaluate(element => ({ ...((element as HTMLElement).dataset) })))}`);
  });
  // Move the native mouse to model a changed aim. A subsequent target move
  // used to undo that camera adjustment before dispatching the right button.
  await page.mouse.move(250, 300);
  const before = Number(await frame.locator('body').getAttribute('data-moves'));
  await executor.execute({ type: 'tap', point: { x: 0.5, y: 0.5 }, button: 'right' });
  assert.equal(Number(await frame.locator('body').getAttribute('data-moves')), before, 'button input must not move the locked camera');
  const locked = JSON.parse(await frame.locator('body').getAttribute('data-down') ?? '{}');
  assert.equal(locked.button, 2);
  assert.equal(locked.trusted, true);
  assert.equal(locked.locked, true);
  await page.keyboard.press('Escape');
  await frame.waitForFunction(() => document.pointerLockElement === null, undefined, { timeout: 3000 });
  await executor.execute({ type: 'tap', point: { x: 0.8, y: 0.7 }, button: 'right' });
  const unlocked = JSON.parse(await frame.locator('body').getAttribute('data-down') ?? '{}');
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.button, 2);
  assert.equal(unlocked.trusted, true);
  assert.ok(Math.abs(unlocked.x - 320) < 1 && Math.abs(unlocked.y - 280) < 1, 'normal clicks still use their observed target');
});

type LookEvent = { type: string; dx: number; dy: number; buttons: number; trusted: boolean; locked: boolean };
async function lookFixture(t: TestContext) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.route('https://**.look.test/**', route => route.fulfill({ contentType: 'text/html', body:
    new URL(route.request().url()).hostname === 'game.look.test' ? `<style>body{margin:0}canvas{display:block;background:#345}</style><canvas width="400" height="400"></canvas><script>
      const canvas=document.querySelector('canvas'); window.lookEvents=[];
      canvas.onclick=()=>{if(!document.pointerLockElement) void canvas.requestPointerLock()};
      canvas.oncontextmenu=event=>event.preventDefault();
      for(const type of ['mousemove','mousedown','mouseup'])canvas.addEventListener(type,event=>{
        window.lookEvents.push({type,dx:event.movementX,dy:event.movementY,buttons:event.buttons,trusted:event.isTrusted,locked:!!document.pointerLockElement});
        if(type==='mousemove'&&document.pointerLockElement){
          if(window.releaseOnMove) document.exitPointerLock();
          if(window.abortLook) void window.abortLook();
        }
      });
    </script>` : '<style>body{margin:0}iframe{position:absolute;left:40px;top:60px;width:400px;height:400px;border:0}</style><iframe id="game" src="https://game.look.test/"></iframe>',
  }));
  await page.goto('https://outer.look.test/');
  const frame = page.frameLocator('#game');
  const events = (): Promise<LookEvent[]> => frame.locator('body').evaluate(() => (window as unknown as { lookEvents: LookEvent[] }).lookEvents);
  const surface = { selector: '#game', frames: [] };
  const waitForLock = (locked = true) => page.frame({ url: 'https://game.look.test/' })!.waitForFunction(expected => (document.pointerLockElement !== null) === expected, locked, { timeout: 3000 });
  return { page, frame, events, surface, waitForLock };
}

test('native look preserves setup cursor origin across executors and moves without buttons in a cross-origin game', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const { page, frame, events, surface, waitForLock } = await lookFixture(t);
  const setup = new InputExecutor(page, surface);
  await setup.step({ type: 'click', target: { selector: 'canvas', frames: ['#game'] } });
  await waitForLock();
  const baseline = (await events()).length;
  const executor = new InputExecutor(page, surface);
  await executor.execute({ type: 'look', dx: 80, dy: -40, durationMs: 200 });
  await new InputExecutor(page, surface).execute({ type: 'look', dx: -30, dy: 20, durationMs: 200 });
  const motion = (await events()).slice(baseline);
  assert.ok(motion.length >= 2);
  assert.ok(motion.every(event => event.type === 'mousemove' && event.buttons === 0 && event.trusted && event.locked));
  assert.equal(motion.reduce((sum, event) => sum + event.dx, 0), 50, 'look must not first jump to a guessed mouse origin');
  assert.equal(motion.reduce((sum, event) => sum + event.dy, 0), -20);
  await executor.execute({ type: 'tap', point: { x: 0.1, y: 0.1 }, button: 'right' });
  const clicked = (await events()).slice(baseline + motion.length);
  assert.deepEqual(clicked.map(event => [event.type, event.buttons]), [['mousedown', 2], ['mouseup', 0]], 'right placement must preserve the new aim');
  await frame.locator('body').evaluate(() => document.exitPointerLock());
  await waitForLock(false);
  const beforeRejected = await events();
  await assert.rejects(executor.execute({ type: 'look', dx: 10, dy: 0, durationMs: 100 }), /active pointer lock/);
  assert.deepEqual(await events(), beforeRejected, 'unlocked look must emit no native input');
});

test('a locked look rejects an unknown native origin without guessing or moving', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const { page, frame, events, surface, waitForLock } = await lookFixture(t);
  // The fixture deliberately acquires lock outside the executor's ownership.
  await page.mouse.click(240, 260);
  await waitForLock();
  const before = await events();
  await assert.rejects(new InputExecutor(page, surface).execute({ type: 'look', dx: 80, dy: 0, durationMs: 200 }), /native mouse position/);
  assert.deepEqual(await events(), before);
});

for (const interruption of ['cancel', 'unlock'] as const) test(`native look stops on ${interruption} without button input or later movement`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const { page, frame, events, surface, waitForLock } = await lookFixture(t);
  await new InputExecutor(page, surface).execute({ type: 'tap', point: { x: 0.5, y: 0.5 } });
  await waitForLock();
  const abort = new AbortController();
  if (interruption === 'cancel') await page.exposeFunction('abortLook', () => abort.abort(new Error('Stop looking')));
  else await frame.locator('body').evaluate(() => { (window as unknown as { releaseOnMove: boolean }).releaseOnMove = true; });
  const before = (await events()).length;
  const executor = new InputExecutor(page, surface, abort.signal);
  await assert.rejects(executor.execute({ type: 'look', dx: 120, dy: 0, durationMs: 600 }), /Stop looking|aborted|lock was lost/i);
  const moved = (await events()).slice(before);
  assert.ok(moved.length >= 1 && moved.length < 15);
  assert.ok(moved.every(event => event.type === 'mousemove' && event.buttons === 0 && event.trusted));
  assert.ok(moved.reduce((sum, event) => sum + event.dx, 0) < 120);
  assert.equal(executor.executed, 0);
  await executor.releaseAll();
  assert.deepEqual((await events()).slice(before), moved);
});
