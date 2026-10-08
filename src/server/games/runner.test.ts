import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chromium } from 'playwright';
import type { CaptureOptions } from '../media/recorder.js';
import { gameProfileSchema } from './schema.js';
import { gameScreenshot } from './screenshot.js';
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
  return { page, profile, lifecycle, actions, options: { profile, outputPath: '/tmp/feedback-fixture.webm', allowLocalGame: true, createCapture, onAction: (action: ActionProgress) => actions.push(action) } };
}

test('sparse feedback observes actual input effects and reserves its last call for evaluation', browserTest, async t => {
  const { options, lifecycle, actions } = await fixture(t);
  const observations: GameplayObservation[] = [];
  const right = { type: 'key' as const, key: 'ArrowRight', durationMs: 40 };
  const result = await runCaptureAttempt({ ...options, decide: async observation => {
    const index = observations.length;
    observations.push(observation);
    assert.equal(observation.recentFrames, undefined, 'legacy captures do not sample action frames');
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

test('the causal BEFORE frame is refreshed after changes during inference and before native input', browserTest, async t => {
  const { page, options, actions } = await fixture(t);
  let request: GameplayObservation | undefined, preActionImage: Buffer | undefined;
  const result = await runCaptureAttempt({ ...options, decide: async current => {
    if (!request) {
      request = current;
      // Fixture-only autonomous game change while the provider is still waiting.
      await page.frameLocator('#game').locator('canvas').evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        const canvas = document.querySelector('canvas')!;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#ee2200'; context.fillRect(0, 0, 320, 320);
        document.querySelector('#hud')!.textContent = 'Autonomous change before input';
      });
      preActionImage = await gameScreenshot(page, { x: 8, y: 8, width: 320, height: 320 }, { type: 'jpeg', quality: 70 });
      return { stop: false, reason: 'Now move right.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 40 }] };
    }
    assert.notDeepEqual(current.previousImage, request.image, 'inference-time state must not be attributed to the action');
    assert.deepEqual(current.previousImage, preActionImage, 'BEFORE shows the autonomous change, before the key changes it again');
    assert.notDeepEqual(current.image, current.previousImage);
    assert.ok(current.previousImageElapsedMs! >= request.elapsedMs + 200);
    assert.ok(current.previousImageElapsedMs! <= actions.find(action => action.status === 'started')!.recordingElapsedMs!);
    assert.match(current.text, /Position: 1; held: false; trusted: true/);
    return { stop: true, reason: 'The native key caused the later position change only.', actions: [] };
  } });
  assert.equal(result.stopReason, 'model_stop', result.controllerError ?? 'Expected normal controller completion.');
  assert.equal(result.actionsExecuted, 1);
});

test('one decision timeout consumes its slot, takes a fresh frame, and ignores the late answer', browserTest, async t => {
  const { page, options, actions, lifecycle } = await fixture(t);
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', () => timeout(250));
  const observations: GameplayObservation[] = [], warnings: string[] = [];
  let completeLate!: (value: unknown) => void;
  const result = await runCaptureAttempt({ ...options, retryDecisionTimeout: true,
    onProgress: event => { if (event.stage === 'warning') warnings.push(event.message); },
    decide: async current => {
      observations.push(current);
      if (observations.length === 1) {
        await page.frameLocator('#game').locator('canvas').evaluate(() => {
          const context = document.querySelector('canvas')!.getContext('2d')!;
          context.fillStyle = '#ee2200'; context.fillRect(0, 0, 320, 320);
          document.querySelector('#hud')!.textContent = 'Changed while waiting';
        });
        return new Promise(resolve => { completeLate = resolve; });
      }
      if (observations.length === 2) {
        assert.notDeepEqual(current.image, observations[0]!.image);
        assert.equal(current.text, 'Changed while waiting');
        assert.deepEqual(current.previousActions, [], 'the expired proposal executed no input');
        assert.equal(current.previousImage, undefined);
        return { stop: false, reason: 'Fresh control probe.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 40 }] };
      }
      assert.equal(current.isFinal, true, 'the failed call still consumed a decision slot');
      return { stop: true, reason: 'Evaluate the one executed batch.', actions: [] };
    },
  });
  assert.equal(result.stopReason, 'model_stop', result.controllerError ?? 'Expected normal controller completion.');
  assert.equal(result.actionsExecuted, 1);
  assert.deepEqual(observations.map(item => item.observationId.split(':').at(-1)), ['0', '1', '2']);
  assert.deepEqual(result.decisions.map(item => item.observationId), observations.slice(1).map(item => item.observationId));
  assert.equal(observations[0]!.signal.aborted, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /slot is consumed.*unchanged capture budget/);
  completeLate({ stop: false, reason: 'Expired batch must never run.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 40 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(actions.filter(action => action.status === 'started').length, 1);
  assert.match(lifecycle.finalText, /Position: 1; held: false; trusted: true/);
});

for (const scenario of ['second timeout', 'final timeout', 'schema error', 'disabled recovery', 'operator cancellation'] as const) {
  test(`decision recovery does not retry ${scenario}`, browserTest, async t => {
    const { options, lifecycle, actions } = await fixture(t);
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', () => timeout(100));
    options.profile.controller = { type: 'sparse', maxDecisions: scenario === 'final timeout' ? 2 : 4, instructions: '', allowedKeys: [], allowPointer: false };
    const abort = new AbortController(), warnings: string[] = [];
    let calls = 0;
    const run = runCaptureAttempt({ ...options, signal: abort.signal, retryDecisionTimeout: scenario !== 'disabled recovery',
      onProgress: event => { if (event.stage === 'warning') warnings.push(event.message); },
      decide: async () => {
        calls++;
        if (calls === 1) return { stop: false, reason: 'Initial native input.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 40 }] };
        if (scenario === 'schema error') return { stop: false, reason: 'Malformed controls.', actions: [{ type: 'unknown' }] };
        if (scenario === 'operator cancellation') abort.abort(new Error('Operator canceled'));
        return new Promise(() => {});
      },
    });
    if (scenario === 'operator cancellation') {
      await assert.rejects(run, /canceled/i);
      assert.equal(lifecycle.cancel, 1);
    } else {
      const result = await run;
      assert.equal(result.stopReason, 'controller_error');
      assert.equal(result.actionsExecuted, 1);
      assert.ok(result.controllerError);
      assert.equal(lifecycle.finish, 1);
    }
    assert.equal(calls, scenario === 'second timeout' ? 3 : 2);
    assert.equal(warnings.length, scenario === 'second timeout' ? 1 : 0);
    assert.equal(actions.filter(action => action.status === 'started').length, 1);
    assert.match(lifecycle.finalText, /Position: 1; held: false; trusted: true/);
  });
}

const transientFrame = `<!doctype html><style>body{margin:0}canvas{display:block}</style>
<canvas width="320" height="320" tabindex="0"></canvas><p id="hud"></p>
<script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),held=new Set();let trusted=true;
function draw(){ctx.fillStyle=held.has('KeyW')&&held.has('Space')?'#0044ee':'#ee2200';ctx.fillRect(0,0,320,320);document.querySelector('#hud').textContent='held: '+held.size+'; trusted: '+trusted}
canvas.onkeydown=e=>{held.add(e.code);trusted&&=e.isTrusted;draw()};canvas.onkeyup=e=>{held.delete(e.code);trusted&&=e.isTrusted;draw()};draw();
</script>`;

test('action sampling sees native simultaneous-key flight that has vanished from the settled frame', browserTest, async t => {
  const { page, options, lifecycle, actions } = await fixture(t, 12000, transientFrame);
  let calls = 0;
  const result = await runCaptureAttempt({ ...options, observeActionFrames: true, decide: async observation => {
    if (!calls++) {
      assert.equal(observation.recentFrames, undefined);
      return { stop: false, reason: 'Move while holding the observed flight control.', actions: [{ type: 'keys', keys: ['KeyW', 'Space'], durationMs: 3200 }] };
    }
    assert.match(observation.text, /held: 0; trusted: true/);
    const frames = observation.recentFrames!;
    assert.ok(frames.length >= 2 && frames.length <= 6);
    const started = actions.find(action => action.phase === 'control' && action.status === 'started')!.recordingElapsedMs!;
    const completed = actions.find(action => action.phase === 'control' && action.status === 'completed')!.recordingElapsedMs!;
    assert.ok(completed - started >= 3200, 'the held input lasts beyond the old two-second limit');
    assert.ok(frames.every((frame, index) => frame.elapsedMs > started && frame.elapsedMs < completed && (!index || frame.elapsedMs > frames[index - 1]!.elapsedMs)));
    assert.ok(observation.elapsedMs > frames.at(-1)!.elapsedMs);
    const colors = await page.evaluate(async images => Promise.all(images.map(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context = canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();
      return Array.from(context.getImageData(100,100,1,1).data);
    })), [...frames.map(frame => [...frame.image]), [...observation.image]]);
    assert.ok(colors.slice(0, -1).every(color => color[2]! > 200 && color[0]! < 20), 'during-action images show the blue airborne state');
    assert.ok(colors.at(-1)![0]! > 200 && colors.at(-1)![2]! < 20, 'the separately labeled NOW image is red/landed');
    return { stop: true, reason: 'The temporal frames establish the transient effect.', actions: [] };
  } });
  assert.equal(result.stopReason, 'model_stop');
  assert.equal(result.actionsExecuted, 1);
  assert.equal(lifecycle.finalText, 'held: 0; trusted: true');
  assert.equal(lifecycle.close, 1);
});

test('canceling sampled native input drains its screenshot before closing and releases the whole chord', browserTest, async t => {
  const { page, options, lifecycle } = await fixture(t, 10000, transientFrame);
  const abort = new AbortController();
  const screenshot = page.screenshot.bind(page);
  let screenshots = 0, pending = 0, closedWhilePending = false;
  page.screenshot = async (...args: Parameters<typeof page.screenshot>) => {
    screenshots++; pending++;
    try {
      const result = await screenshot(...args);
      if (screenshots === 3) {
        abort.abort(new Error('Cancel during a held chord and screenshot'));
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return result;
    } finally { pending--; }
  };
  const createCapture = options.createCapture;
  await assert.rejects(runCaptureAttempt({ ...options, signal: abort.signal, observeActionFrames: true,
    createCapture: async config => {
      const capture = await createCapture(config);
      return { ...capture, close: async () => { closedWhilePending = pending !== 0; await capture.close(); } };
    },
    decide: async () => ({ stop: false, reason: 'Hold movement and flight.', actions: [{ type: 'keys', keys: ['KeyW', 'Space'], durationMs: 6000 }] }),
  }), /canceled/i);
  assert.equal(screenshots, 3, 'no additional scheduled sample runs after cancellation');
  assert.equal(pending, 0);
  assert.equal(closedWhilePending, false);
  assert.equal(lifecycle.finalText, 'held: 0; trusted: true');
  assert.equal(lifecycle.finish, 0);
  assert.equal(lifecycle.cancel, 1);
  assert.equal(lifecycle.close, 1);
});

test('an optional mid-action screenshot failure preserves native footage and reports partial evidence', browserTest, async t => {
  const { page, options, lifecycle, actions } = await fixture(t, 10000, transientFrame);
  const screenshot = page.screenshot.bind(page);
  let screenshots = 0, pending = 0, closedWhilePending = false, decisions = 0;
  const warnings: string[] = [];
  page.screenshot = async (...args: Parameters<typeof page.screenshot>) => {
    screenshots++; pending++;
    try {
      if (screenshots === 4) throw new Error('Synthetic optional screenshot timeout');
      return await screenshot(...args);
    } finally { pending--; }
  };
  const createCapture = options.createCapture;
  const result = await runCaptureAttempt({ ...options, observeActionFrames: true,
    onProgress: progress => { if (progress.stage === 'warning') warnings.push(progress.message); },
    createCapture: async config => {
      const capture = await createCapture(config);
      return { ...capture, close: async () => { closedWhilePending = pending !== 0; await capture.close(); } };
    },
    decide: async observation => {
      if (!decisions++) return { stop: false, reason: 'Hold observed movement and flight.', actions: [{ type: 'keys', keys: ['KeyW', 'Space'], durationMs: 2200 }] };
      assert.equal(observation.recentFrames?.length, 1, 'retain the actual sample captured before failure');
      assert.match(observation.text, /held: 0; trusted: true/);
      return { stop: true, reason: 'Final screenshot and partial temporal evidence remain available.', actions: [] };
    },
  });
  assert.equal(result.stopReason, 'model_stop');
  assert.equal(result.actionsExecuted, 1, 'optional screenshot failure does not interrupt native inputs');
  const controls = actions.filter(action => action.phase === 'control');
  assert.ok(controls[1]!.recordingElapsedMs! - controls[0]!.recordingElapsedMs! >= 2200);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /after 1 sample.*source recording continues/);
  assert.equal(screenshots, 5, 'request, fresh pre-action baseline, one captured sample, failed sample, then current; no trailing sampler operations');
  assert.equal(pending, 0);
  assert.equal(closedWhilePending, false);
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
  const result = await runCaptureAttempt({ ...options, retryDecisionTimeout: true, decide: async () => {
    if (calls++) throw new Error('Provider unavailable');
    return { stop: false, reason: 'Move right.', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 40 }] };
  } });
  assert.equal(result.stopReason, 'controller_error');
  assert.equal(result.controllerError, 'Provider unavailable');
  assert.equal(calls, 2, 'generic provider errors never use timeout recovery');
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
  const result = await runCaptureAttempt({ ...options, retryDecisionTimeout: true, decide: observation => {
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

for (const wholeFrame of [false, true]) test(`feedback receives current native pointer-lock state for ${wholeFrame ? 'an iframe' : 'a canvas'}`, browserTest, async t => {
  const html = `<!doctype html><style>body{margin:0}canvas{display:block}</style><canvas width="320" height="320" tabindex="0"></canvas><p id="hud">Click to engage Mouse Look</p><script>
    const canvas=document.querySelector('canvas'),hud=document.querySelector('#hud');let moved=false;
    canvas.onclick=()=>canvas.requestPointerLock();
    document.addEventListener('pointerlockchange',()=>{hud.textContent='Locked: '+Boolean(document.pointerLockElement)+'; moved: '+moved});
    document.addEventListener('mousemove',event=>{if(document.pointerLockElement){moved ||= event.movementX!==0||event.movementY!==0;hud.textContent='Locked: true; moved: '+moved+'; buttons: '+event.buttons}});
    document.addEventListener('keydown',event=>{if(event.code==='Escape')document.exitPointerLock()});
    </script>`;
  const { options, lifecycle } = await fixture(t, 15000, html);
  if (wholeFrame) { options.profile.surface = { selector: '#game', frames: [] }; options.profile.ready = options.profile.surface; }
  options.profile.controller = { type: 'sparse', maxDecisions: 4, instructions: 'Click to engage Mouse Look.', allowedKeys: ['Escape'], allowPointer: true, allowLook: true };
  const seen: boolean[] = [];
  const result = await runCaptureAttempt({ ...options, decide: async current => {
    seen.push(current.pointerLocked);
    if (seen.length === 1) return { stop: false, reason: 'Use the visible engagement control.', actions: [{ type: 'tap', point: { x: 0.5, y: wholeFrame ? 0.4 : 0.5 } }] };
    if (seen.length === 2) return { stop: false, reason: 'Probe relative Mouse Look after the browser reports lock.', actions: [{ type: 'look', dx: 30, dy: 15, durationMs: 100 }] };
    if (seen.length === 3) {
      assert.match(current.text, /moved: true; buttons: 0/);
      return { stop: false, reason: 'Exit the observed pointer-lock mode.', actions: [{ type: 'key', key: 'Escape', durationMs: 40 }] };
    }
    return { stop: true, reason: 'The browser reports lock released.', actions: [] };
  } });
  assert.deepEqual(seen, [false, true, true, false]);
  assert.equal(result.stopReason, 'model_stop', result.controllerError ?? 'Pointer-lock observations should finish normally.');
  assert.equal(result.actionsExecuted, 3);
  assert.match(lifecycle.finalText, /Locked: false; moved: true/);
});
