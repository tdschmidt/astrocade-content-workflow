import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chromium } from 'playwright';
import type { CaptureOptions } from '../media/recorder.js';
import { gameProfileSchema } from './schema.js';
import { runCaptureAttempt, type ActionProgress, type GameplayObservation } from './runner.js';

const browserTest = { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 };
const frame = `<!doctype html><style>body{margin:0}canvas{display:block}</style>
<canvas width="320" height="320" tabindex="0"></canvas><p id="hud">Position: 0; held: false; trusted: false; clicks: 0</p><span hidden>HIDDEN FIXTURE VALUE</span>
<script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let position=0,held=false,trusted=false,clicks=0;
function draw(){document.querySelector('#hud').textContent='Position: '+position+'; held: '+held+'; trusted: '+trusted+'; clicks: '+clicks;ctx.fillStyle='#123';ctx.fillRect(0,0,320,320);ctx.fillStyle='#8fc';ctx.fillRect(20+position*50,140,30,30);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText('Position: '+position,20,50)}
canvas.onkeydown=e=>{if(e.code==='ArrowRight'){position++;held=true;trusted=e.isTrusted;draw()}};
canvas.onkeyup=()=>{held=false;draw()};canvas.onclick=()=>{clicks++;draw()};draw();
</script>`;

async function fixture(t: TestContext, maxDurationMs = 10000, frameHtml = frame) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/frame') ? frameHtml : '<iframe id="game" src="/frame" width="360" height="400" style="border:0"></iframe>' }));
  const profile = gameProfileSchema.parse({
    id: 'feedback-fixture', name: 'Feedback fixture', gameUrl: 'http://127.0.0.1/game', verification: 'verified',
    viewport: { width: 640, height: 480 }, surface: { selector: 'canvas', frames: ['#game'] }, ready: { selector: 'canvas', frames: ['#game'] },
    focus: 'focus', objective: 'Advance the visible position counter.', maxDurationMs, controller: { type: 'sparse', maxDecisions: 3 },
  });
  const actions: ActionProgress[] = [];
  const lifecycle = { finish: 0, cancel: 0, close: 0, finalText: '' };
  // Real browser, screenshots, and trusted native inputs; only media encoding is stubbed.
  const createCapture = async (options: CaptureOptions) => ({
    page,
    start: async () => {},
    finish: async () => {
      lifecycle.finish++;
      lifecycle.finalText = await page.frameLocator('#game').locator('#hud').innerText();
      return { path: options.outputPath, durationSeconds: 1, width: 640, height: 480, codec: 'fixture' };
    },
    cancel: async () => { lifecycle.cancel++; lifecycle.finalText = await page.frameLocator('#game').locator('#hud').innerText(); },
    close: async () => { lifecycle.close++; await page.close(); },
  });
  return { profile, lifecycle, actions, options: { profile, outputPath: '/tmp/feedback-fixture.webm', allowLocalGame: true, createCapture, onAction: (action: ActionProgress) => actions.push(action) } };
}

test('sparse feedback observes actual input effects and reserves its last call for evaluation', browserTest, async t => {
  const { options, lifecycle, actions } = await fixture(t);
  const observations: GameplayObservation[] = [];
  const right = { type: 'key' as const, key: 'ArrowRight', durationMs: 40 };
  const result = await runCaptureAttempt({ ...options, decide: async observation => {
    const index = observations.length;
    observations.push(observation);
    assert.match(observation.text, new RegExp(`Position: ${index}; held: false; trusted: ${index ? 'true' : 'false'}; clicks: 0`));
    assert.doesNotMatch(observation.text, /HIDDEN FIXTURE/);
    assert.equal(observation.isFinal, index === 2);
    if (!index) {
      assert.equal(observation.previousImage, undefined);
      assert.equal(observation.previousReason, undefined);
      assert.deepEqual(observation.previousActions, []);
    } else {
      assert.deepEqual(observation.previousImage, observations[index - 1]!.image);
      assert.notDeepEqual(observation.image, observation.previousImage);
      assert.deepEqual(observation.previousActions, [right]);
      assert.equal(observation.previousReason, `Move from ${index - 1}.`);
      assert.ok(observation.elapsedMs - observations[index - 1]!.elapsedMs >= 250, 'allow input effects to render before observing again');
    }
    // A misbehaving final answer must still never start an unobserved batch.
    return { stop: false, reason: `Move from ${index}.`, actions: [right] };
  } });
  assert.equal(result.stopReason, 'decision_limit');
  assert.equal(result.decisions.length, 3);
  assert.equal(result.actionsExecuted, 2);
  assert.equal(observations.length, 3);
  assert.equal(actions.filter(action => action.phase === 'focus').length, 0);
  assert.equal(lifecycle.finalText, 'Position: 2; held: false; trusted: true; clicks: 0');
  assert.equal(lifecycle.finish, 1);
  assert.equal(lifecycle.cancel, 0);
  assert.equal(lifecycle.close, 1);
});

test('a pointer-only plan reaches visible HTML controls over its canvas without an extra center click', browserTest, async t => {
  const html = `<!doctype html><style>body{margin:0}canvas{display:block}#interface{position:absolute;inset:0 auto auto 0;width:320px;height:320px}button{position:absolute;left:120px;top:240px;width:80px;height:40px}</style>
<canvas width="320" height="320"></canvas><div id="interface"><button>SPIN</button></div><p id="hud">spins: 0; center: 0; trusted: false</p>
<script>let spins=0,center=0;document.querySelector('#interface').onclick=e=>{if(e.target.tagName==='BUTTON')spins++;else center++;document.querySelector('#hud').textContent='spins: '+spins+'; center: '+center+'; trusted: '+e.isTrusted}</script>`;
  const { options, lifecycle } = await fixture(t, 10000, html);
  options.profile.controller = { type: 'timed', repetitions: 1, actions: [{ type: 'tap', point: { x: 0.5, y: 0.8125 } }] };
  const result = await runCaptureAttempt(options);
  assert.equal(result.actionsExecuted, 1);
  assert.equal(lifecycle.finalText, 'spins: 1; center: 0; trusted: true');
  assert.equal(lifecycle.cancel, 0);
});

test('a later controller failure preserves recorded gameplay with an explicit error', browserTest, async t => {
  const { options, lifecycle } = await fixture(t);
  let calls = 0;
  const result = await runCaptureAttempt({ ...options, decide: async () => {
    if (calls++) throw new Error('Provider unavailable');
    return { stop: false, reason: 'Move right.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 40 }] };
  } });
  assert.equal(result.stopReason, 'controller_error');
  assert.equal(result.controllerError, 'Provider unavailable');
  assert.equal(result.actionsExecuted, 1);
  assert.equal(lifecycle.finalText, 'Position: 1; held: false; trusted: true; clicks: 0');
  assert.equal(lifecycle.finish, 1);
  assert.equal(lifecycle.cancel, 0);
  assert.equal(lifecycle.close, 1);
});

test('a decision that returns after the capture deadline never executes its actions', browserTest, async t => {
  const { options, lifecycle, actions } = await fixture(t, 3000);
  let complete: ((value: unknown) => void) | undefined;
  let observedSignal: AbortSignal | undefined;
  const started = performance.now();
  const result = await runCaptureAttempt({ ...options, decide: observation => {
    observedSignal = observation.signal;
    return new Promise(resolve => { complete = resolve; });
  } });
  assert.ok(complete, 'the controller should receive an initial observation');
  assert.equal(result.stopReason, 'duration_limit');
  assert.equal(result.actionsExecuted, 0);
  assert.equal(observedSignal?.aborted, true);
  assert.ok(performance.now() - started < 6000, 'cleanup must not wait for an uncooperative provider');
  complete({ stop: false, reason: 'This answer arrived too late.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 40 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(actions.length, 0);
  assert.equal(lifecycle.finalText, 'Position: 0; held: false; trusted: false; clicks: 0');
  assert.equal(lifecycle.finish, 1);
  assert.equal(lifecycle.cancel, 0);
  assert.equal(lifecycle.close, 1);
});

test('operator cancellation releases held native inputs before closing the capture', browserTest, async t => {
  const { options, lifecycle } = await fixture(t);
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  t.after(() => clearTimeout(timer));
  await assert.rejects(runCaptureAttempt({ ...options, signal: abort.signal,
    onAction: action => {
      if (action.phase === 'control' && action.status === 'started') timer = setTimeout(() => abort.abort(), 100);
    },
    decide: async () => ({ stop: false, reason: 'Hold right.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 2000 }] }),
  }), error => error instanceof Error && 'code' in error && error.code === 'canceled');
  assert.equal(lifecycle.finalText, 'Position: 1; held: false; trusted: true; clicks: 0');
  assert.equal(lifecycle.finish, 0);
  assert.equal(lifecycle.cancel, 1);
  assert.equal(lifecycle.close, 1);
});

test('feedback observes the settled board after a rejected drag returns its object', browserTest, async t => {
  const returningObject = `<!doctype html><style>body{margin:0}canvas{display:block}</style>
  <canvas width="320" height="320" tabindex="0"></canvas><p id="hud">Ready</p><script>
  const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let x=50,dragging=false;
  function draw(){ctx.fillStyle='#123';ctx.fillRect(0,0,320,320);ctx.fillStyle='#8fc';ctx.fillRect(x,140,40,40)}
  canvas.onpointerdown=()=>{dragging=true};
  canvas.onpointermove=event=>{if(dragging){x=event.offsetX;draw()}};
  canvas.onpointerup=event=>{dragging=false;x=230;draw();document.querySelector('#hud').textContent='Returning';
    setTimeout(()=>{x=50;draw();document.querySelector('#hud').textContent='Returned to origin; trusted: '+event.isTrusted},600)};draw();
  </script>`;
  const { options, lifecycle } = await fixture(t, 10000, returningObject);
  const drag = { type: 'drag' as const, from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, durationMs: 100 };
  let initialImage: Buffer | undefined;
  let calls = 0;
  const result = await runCaptureAttempt({ ...options, decide: async observation => {
    if (!calls++) {
      assert.equal(observation.text, 'Ready');
      initialImage = observation.image;
      return { stop: false, reason: 'Test one placement.', actions: [drag] };
    }
    assert.equal(observation.text, 'Returned to origin; trusted: true');
    assert.deepEqual(observation.previousActions, [drag]);
    assert.deepEqual(observation.previousImage, initialImage);
    assert.deepEqual(observation.image, initialImage, 'the visible object must be back at its original coordinates, not mid-return');
    return { stop: true, reason: 'Placement was rejected; object returned to origin.', actions: [] };
  } });
  assert.equal(result.stopReason, 'model_stop', result.controllerError ?? 'The settled observation should stop normally.');
  assert.equal(calls, 2);
  assert.equal(lifecycle.finalText, 'Returned to origin; trusted: true');
});
