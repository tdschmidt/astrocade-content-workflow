import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium } from 'playwright';
import type { GoogleServices } from '../providers/google.js';
import { inspectGamePage, isObservedStartLabel, learnGameProfile, type GameInspection } from './learning.js';
import { learnFeedbackProfile } from './feedback.js';
import { InputExecutor } from './input.js';
import type { GameCandidate } from './schema.js';

async function fixture(t: TestContext) {
  const outputDir = await mkdtemp(join(tmpdir(), 'astrocade-learn-test-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const imagePath = join(outputDir, 'fixture.png');
  await writeFile(imagePath, 'test image bytes: never sent to a provider');
  const candidate: GameCandidate = { id: 'Game1', title: 'Observed Runner', url: 'https://www.astrocade.com/games/observed-runner/Game1', titleSource: 'visible_text', metrics: [], observations: [] };
  const inspection: GameInspection = {
    gameUrl: candidate.url, observedAt: '2026-10-07T00:00:00.000Z', outputDir, imagePath, beforeImagePath: imagePath,
    text: 'Hold the right arrow to move.', surface: { selector: 'canvas', frames: ['iframe[title="Astrocade Game"]'] },
    ready: { selector: '#start', frames: ['iframe[title="Astrocade Game"]'] },
    startTargets: [{ selector: '#start', label: 'Start' }], viewport: { width: 720, height: 1280 }, setup: [],
  };
  const proposal = { supported: true, confidence: 'high', objective: 'Move right and observe progress.', start: [{ type: 'button', index: 0 }], actions: [{ type: 'key', key: 'ArrowRight', durationMs: 1000 }, { type: 'wait', durationMs: 1000 }], evidence: ['Visible instruction says to hold the right arrow.'], limitations: [] };
  const google = { json: async () => structuredClone(proposal) } as unknown as Pick<GoogleServices, 'json'>;
  return { outputDir, candidate, inspection, proposal, google };
}

test('learning builds an unverified profile from observed selectors and saves its evidence', async t => {
  const { outputDir, candidate, inspection, google } = await fixture(t);
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile?.verification, 'unverified');
  assert.equal(learned.profile?.gameUrl, candidate.url);
  assert.deepEqual(learned.profile?.surface, inspection.surface);
  assert.deepEqual(learned.profile?.start, [{ type: 'click', target: { selector: '#start', frames: inspection.surface.frames } }]);
  assert.deepEqual(JSON.parse(await readFile(join(outputDir, 'learning.json'), 'utf8')), learned);
  const assessment = JSON.parse(await readFile(join(outputDir, 'timed-assessment.json'), 'utf8'));
  assert.equal(assessment.supported, true);
  assert.equal(assessment.confidence, 'high');
});

test('a timed simultaneous-key plan preserves keyboard focus and counts the shared hold once', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  inspection.text = 'Hold W to move and Space to fly.';
  const action = { type: 'keys' as const, keys: ['KeyW', 'Space'], durationMs: 6000 };
  const provider = { json: async (prompt: string) => {
    assert.match(prompt, /keys holds 2–3 unique observed keys simultaneously for 20–6000ms/);
    assert.match(prompt, /"type":"keys","keys":\["KeyW","Space"\],"durationMs":3000/);
    assert.doesNotMatch(prompt, /simultaneous key combinations are unavailable/);
    return { ...proposal, actions: [action], evidence: ['The visible instructions establish W movement and Space flight.'] };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, provider, undefined, { maxDurationMs: 9000 });
  assert.equal(learned.profile?.focus, 'click', 'a plan containing only simultaneous keys still needs the keyboard focus path');
  assert.equal(learned.profile?.maxDurationMs, 9000);
  assert.equal(learned.profile?.verification, 'unverified');
  assert.deepEqual(learned.profile?.controller, { type: 'timed', repetitions: 1, actions: [action] });
});

test('low-confidence controls are skipped rather than promoted to a runnable plan', async t => {
  const { candidate, inspection, proposal, google } = await fixture(t);
  proposal.confidence = 'low';
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /No high-confidence/);
  assert.equal(JSON.parse(await readFile(join(inspection.outputDir, 'timed-assessment.json'), 'utf8')).confidence, 'low');
});

test('observed fixed controls allow an unverified probe without implying a likely win', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  const google = { json: async (prompt: string) => {
    assert.match(prompt, /NOT the probability of winning/);
    assert.match(prompt, /uncertain.*outcome varies|outcome varies/i);
    assert.match(prompt, /an unseen keyboard mapping cannot/);
    return { ...proposal, objective: 'Take a visible bite and observe the consequence.', actions: [{ type: 'tap', point: { x: 0.77, y: 0.90 } }], evidence: ['The visible CHOMP button previously removed part of the sandwich.'], limitations: ['Coworker timing varies; avoiding detection and winning are unproven.'] };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile?.verification, 'unverified');
  assert.deepEqual(learned.limitations, ['Coworker timing varies; avoiding detection and winning are unproven.']);
  assert.equal(learned.profile?.focus, 'focus', 'pointer plans must not add an unobserved center click before their first action');
});

test('a model cannot select an unobserved start button', async t => {
  const { candidate, inspection, proposal, google } = await fixture(t);
  proposal.start = [{ type: 'button', index: 1 }];
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /observed allowlist/);
});

test('an observed inspector Start is replayed exactly once', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  inspection.performedStart = inspection.startTargets[0];
  const { start: _start, ...withoutStart } = proposal;
  const google = { json: async () => withoutStart } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile?.start.filter(step => step.type === 'click').length, 1);
  assert.deepEqual(learned.profile?.start[0], { type: 'click', target: { selector: '#start', frames: inspection.surface.frames } });
});

test('a known Start is omitted from model decisions and unexpected start fields are rejected', async t => {
  const { candidate, inspection, google } = await fixture(t);
  inspection.performedStart = inspection.startTargets[0];
  await assert.rejects(learnGameProfile(inspection, candidate, google), /unrecognized_keys/);
});

test('visual menu steps are replayed once and omitted from model start decisions', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  inspection.performedVisualStart = [{ type: 'tap', point: { x: 0.5, y: 0.7 } }, { type: 'wait', durationMs: 700 }];
  const { start: _start, ...withoutStart } = proposal;
  const google = { json: async (prompt: string) => {
    assert.match(prompt, /already knows the Start actions/);
    return withoutStart;
  } } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.deepEqual(learned.profile?.start, inspection.performedVisualStart);
});

test('a visual intro skip is replayed before the DOM Start it revealed', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  inspection.performedVisualStart = [{ type: 'tap', point: { x: 0.5, y: 0.7 } }, { type: 'wait', durationMs: 700 }];
  inspection.performedStart = inspection.startTargets[0];
  const { start: _start, ...withoutStart } = proposal;
  const google = { json: async () => withoutStart } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.deepEqual(learned.profile?.start, [...inspection.performedVisualStart, { type: 'click', target: { selector: '#start', frames: inspection.surface.frames } }, { type: 'wait', durationMs: 700 }]);
});

test('plans longer than the learning budget are skipped', async t => {
  const { candidate, inspection, proposal, google } = await fixture(t);
  proposal.actions = Array.from({ length: 10 }, () => ({ type: 'wait', durationMs: 5000 })) as typeof proposal.actions;
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /45-second/);
});

test('reel timed learning asks for distinct supported moments while preserving the existing action budget', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  const google = { json: async (prompt: string) => {
    assert.match(prompt, /gameplay REEL/);
    assert.match(prompt, /3–6 useful moments/);
    assert.match(prompt, /cannot choose unseen moving targets or pretend to adapt/);
    assert.match(prompt, /up to the available 45 seconds/);
    assert.doesNotMatch(prompt, /Prefer 10–25 seconds/);
    return { ...proposal, actions: Array.from({ length: 10 }, () => ({ type: 'wait', durationMs: 5000 })) };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, google, undefined, { editingStyle: 'reel' });
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /45-second learning budget/, 'exploration never expands or fills a cap by bypassing the native plan guard');
});

test('a requested capture budget guides the selected goal and rejects an overlong plan without truncation', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  const intent = { captureGoal: 'SYNTHETIC reach the first flag.', rejectIf: 'SYNTHETIC no flag or progress is visible.', maxDurationMs: 10000 };
  const google = { json: async (prompt: string) => {
    assert.match(prompt, /SYNTHETIC reach the first flag/);
    assert.match(prompt, /SYNTHETIC no flag or progress/);
    assert.match(prompt, /upper budget, not a target to fill/);
    assert.match(prompt, /must fit 7.5 seconds/);
    return { ...proposal, actions: Array.from({ length: 4 }, () => ({ type: 'key', key: 'ArrowRight', durationMs: 2000 })) };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, google, undefined, intent);
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /7.5-second learning budget/);
});

test('a longer bounded capture permits a longer action sequence and records its actual cap', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  const actions = Array.from({ length: 40 }, () => ({ type: 'key', key: 'ArrowRight', durationMs: 2000 }));
  const google = { json: async () => ({ ...proposal, actions }) } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, google, undefined, { maxDurationMs: 90000 });
  assert.equal(learned.profile?.maxDurationMs, 90000);
  assert.equal(learned.profile?.controller.type, 'timed');
  if (learned.profile?.controller.type === 'timed') assert.equal(learned.profile.controller.actions.length, 40);
  assert.equal(learned.profile?.verification, 'unverified');
});

test('inspection provenance mismatch fails before any provider call', async t => {
  const { candidate, inspection } = await fixture(t);
  const google = { json: async () => { assert.fail('unrelated inspection must not be uploaded'); } } as unknown as Pick<GoogleServices, 'json'>;
  inspection.gameUrl = 'https://www.astrocade.com/games/another/Game2';
  await assert.rejects(learnGameProfile(inspection, candidate, google), /does not belong/);
});

test('the inspector recognizes observed game-start labels without broadening to unrelated buttons', () => {
  assert.equal(isObservedStartLabel('ENTER ARENA'), true);
  assert.equal(isObservedStartLabel('Start Shift'), true);
  assert.equal(isObservedStartLabel('DEPLOY ↗'), true);
  assert.equal(isObservedStartLabel('Deploy'), true);
  assert.equal(isObservedStartLabel('New Game'), true);
  assert.equal(isObservedStartLabel('New World'), true);
  assert.equal(isObservedStartLabel('New World Options'), false);
  assert.equal(isObservedStartLabel('Deploy update'), false);
  assert.equal(isObservedStartLabel('ENTER SHOP'), false);
  assert.equal(isObservedStartLabel('Play ad for reward'), false);
});

test('invalid model action aliases are rejected without normalization', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  for (const action of [{ type: 'keyDown', key: 'KeyW', durationMs: 1000 }, { type: 'KeyW', durationMs: 1000 }, { type: 'key', key: 'Shift', durationMs: 1000 }, { type: 'key', key: 'KeyW', durationMs: 1000, selector: '#unobserved' }]) {
    const google = { json: async () => ({ ...proposal, actions: [action] }) } as unknown as Pick<GoogleServices, 'json'>;
    await assert.rejects(learnGameProfile(inspection, candidate, google));
  }
});

test('tap syntax cannot be substituted for an indexed start button', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  const google = { json: async () => ({ ...proposal, start: [{ type: 'tap', index: 0 }] }) } as unknown as Pick<GoogleServices, 'json'>;
  await assert.rejects(learnGameProfile(inspection, candidate, google));
});

test('the learning request supplies exact native-input wire examples', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  const google = { json: async (prompt: string) => {
    assert.match(prompt, /"type":"key","key":"KeyW","durationMs":1500/);
    assert.match(prompt, /"type":"button","index":0/);
    assert.match(prompt, /never emit keyDown\/keyUp/);
    return proposal;
  } } as unknown as Pick<GoogleServices, 'json'>;
  assert.ok((await learnGameProfile(inspection, candidate, google)).profile);
});

for (const label of ['START RUN', 'DEPLOY ↗', 'New Game', 'New World']) test(`inspection clicks ${label} before waiting for its hidden game canvas`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const { outputDir, candidate } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
  const frame = page.frames()[1]!;
  await frame.setContent(`<style>body{margin:0;background:#123}canvas{display:none;background:#24b}button{margin:100px;width:200px;height:80px}</style><button id="start">${label}</button><canvas width="600" height="1100"></canvas><script>document.querySelector("button").onclick=event=>{document.body.dataset.trusted=String(event.isTrusted);document.querySelector("button").remove();document.querySelector("canvas").style.display="block"}</script>`);
  const provider = { json: async () => ({ phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'The start menu disappeared and the board is visible.' }) } as unknown as Pick<GoogleServices, 'json'>;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, provider);
  assert.deepEqual(inspection.performedStart, { selector: '#start', label });
  assert.equal(inspection.ready.selector, '#start');
  assert.deepEqual(inspection.surface, { selector: 'iframe[title="Astrocade Game"]', frames: [] });
  assert.equal(await frame.locator('body').getAttribute('data-trusted'), 'true');
  assert.notDeepEqual(await readFile(inspection.beforeImagePath), await readFile(inspection.imagePath));
});

for (const scenario of ['play', 'skip then play', 'skip then DOM start', 'game board', 'unrelated label'] as const) test(`visual menu inspection handles ${scenario} with bounded native input`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const { outputDir, candidate } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
  const frame = page.frames()[1]!;
  await frame.setContent(`<style>body{margin:0}</style><canvas width="600" height="1100"></canvas><script>
    const canvas=document.querySelector('canvas'), context=canvas.getContext('2d');
    let clicks=0;
    function draw(){context.fillStyle=clicks?'#247':'#123';context.fillRect(0,0,600,1100);context.fillStyle='white';context.font='32px sans-serif';context.fillText(clicks?${scenario === 'skip then play' ? "clicks===1?'PLAY':'BOARD '+clicks" : "'BOARD '+clicks"}:${JSON.stringify(scenario.startsWith('skip') ? 'Tap to skip' : scenario === 'game board' ? 'Drag the shapes' : 'PLAY')},200,600)}
    draw();
    canvas.onclick=event=>{clicks++;document.body.dataset.clicks=String(clicks);document.body.dataset.trusted=String(event.isTrusted);draw();${scenario === 'skip then DOM start' ? "const button=document.createElement('button');button.id='startAfterSkip';button.textContent='Start';button.style='position:absolute;left:200px;top:500px;width:200px;height:80px';button.onclick=e=>{document.body.dataset.domStarted=String(e.isTrusted);button.remove()};document.body.append(button);" : ''}};
  </script>`);
  const observedImages: string[] = [];
  const provider = { json: async (prompt: string, _schema: unknown, media: { data: string }[]) => {
    assert.match(prompt, /playing: an active board/);
    observedImages.push(media[0]!.data);
    assert.ok(observedImages.length <= 3, 'menu discovery must remain bounded');
    if (scenario === 'game board' || observedImages.length > (scenario.startsWith('skip') ? 2 : 1)) return { phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'Active game board, no menu control.' };
    if (scenario === 'skip then DOM start' && observedImages.length === 2) return { phase: 'entry', buttonIndex: 0, point: null, label: 'Start', reason: 'The skipped intro revealed a native Start button.' };
    return { phase: scenario.startsWith('skip') && observedImages.length === 1 ? 'tutorial' : 'entry', buttonIndex: null, point: { x: 0.5, y: 0.55 }, label: scenario === 'unrelated label' ? 'Buy upgrade' : scenario.startsWith('skip') && observedImages.length === 1 ? 'Tap to skip' : 'PLAY', reason: 'Visible menu label.' };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, provider);
  const expectedTaps = scenario === 'skip then play' ? 2 : scenario === 'play' || scenario === 'skip then DOM start' ? 1 : 0;
  assert.equal(Number(await frame.locator('body').getAttribute('data-clicks') ?? '0'), expectedTaps);
  assert.equal(inspection.performedVisualStart?.filter(step => step.type === 'tap').length ?? 0, expectedTaps);
  if (scenario === 'skip then DOM start') {
    assert.ok(inspection.performedMenuSteps?.some(step => step.type === 'click' && step.target.selector === '#startAfterSkip'));
    assert.equal(await frame.locator('body').getAttribute('data-dom-started'), 'true');
  } else assert.equal(inspection.performedStart, undefined);
  assert.equal(inspection.ready.selector, 'iframe[title="Astrocade Game"]');
  assert.equal((await readFile(inspection.beforeImagePath)).toString('base64'), observedImages[0]);
  if (expectedTaps) {
    assert.equal(await frame.locator('body').getAttribute('data-trusted'), 'true');
    assert.notDeepEqual(await readFile(inspection.beforeImagePath), await readFile(inspection.imagePath));
  }
  if (expectedTaps === 2) assert.notEqual(observedImages[0], observedImages[1], 'each visual menu decision must see the updated screen');
  assert.equal(JSON.parse(await readFile(join(outputDir, 'inspection-menu-1.json'), 'utf8')).reason, scenario === 'game board' ? 'Active game board, no menu control.' : 'Visible menu label.');
});

test('visual menu replay survives a replaced and resized canvas in the fixed game frame', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const { outputDir, candidate } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  const loadFixture = async () => {
    await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
    await page.frames()[1]!.setContent(`<style>body{margin:0}canvas{background:#123}</style><canvas width="600" height="1100"></canvas><script>
      document.querySelector('canvas').onclick=event=>{
        document.body.dataset.trusted=String(event.isTrusted);
        document.body.dataset.clickPoint=event.clientX+','+event.clientY;
        const replacement=document.createElement('canvas');replacement.width=300;replacement.height=400;replacement.style='background:#27b;margin:100px';
        event.currentTarget.replaceWith(replacement);
      };
    </script>`);
  };
  await loadFixture();
  let calls = 0;
  const provider = { json: async () => ++calls === 1
    ? { phase: 'entry', buttonIndex: null, point: { x: 0.5, y: 0.55 }, label: 'PLAY', reason: 'Visible menu Play control.' }
    : { phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'The replacement gameplay canvas is visible.' },
  } as unknown as Pick<GoogleServices, 'json'>;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, provider);
  assert.deepEqual(inspection.surface, { selector: 'iframe[title="Astrocade Game"]', frames: [] });
  assert.equal(inspection.readyToPlay, true);
  assert.equal(inspection.performedMenuSteps?.filter(action => action.type === 'tap').length, 1);
  assert.notDeepEqual(await readFile(inspection.beforeImagePath), await readFile(inspection.imagePath));
  assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-click-point'), '300,605');
  await loadFixture();
  const executor = new InputExecutor(page, inspection.surface);
  for (const step of [...inspection.setup, ...inspection.performedMenuSteps!]) await executor.step(step);
  assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-trusted'), 'true');
  assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-click-point'), '300,605', 'fresh replay uses iframe coordinates despite new canvas geometry');
});

test('an observed native loader waits without taps and replays its delay before a canvas Start', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 30000 }, async t => {
  const { outputDir, candidate, proposal } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  const loadFixture = async () => {
    await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
    await page.frames()[1]!.setContent(`<style>body{margin:0}</style><canvas width="600" height="1100"></canvas><script>
      const canvas=document.querySelector('canvas'),context=canvas.getContext('2d');let ready=false;
      function draw(label){context.fillStyle='#123';context.fillRect(0,0,600,1100);context.fillStyle='white';context.font='32px sans-serif';context.fillText(label,150,600)}
      draw('PREPARING ARENA 38%');
      setTimeout(()=>{ready=true;draw('PLAY')},2200);
      canvas.onclick=event=>{document.body.dataset.clickedWhileLoading=String(!ready);document.body.dataset.trusted=String(event.isTrusted);if(ready){document.body.dataset.started='true';draw('BOARD')}};
    </script>`);
  };
  await loadFixture();
  const observedImages: string[] = [];
  const provider = { json: async (_prompt: string, _schema: unknown, media: { data: string }[]) => {
    observedImages.push(media[0]!.data);
    return observedImages.length === 1
      ? { phase: 'loading', buttonIndex: null, point: null, label: 'PREPARING ARENA 38%', reason: 'A loading percentage is visible.' }
      : observedImages.length === 2
        ? { phase: 'entry', buttonIndex: null, point: { x: 0.5, y: 0.55 }, label: 'PLAY', reason: 'Loading completed; Play is now visible.' }
        : { phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'The active board is visible.' };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, provider);
  assert.equal(observedImages.length, 3);
  assert.notEqual(observedImages[0], observedImages[1], 'the second decision must see a freshly observed menu');
  assert.equal((await readFile(inspection.beforeImagePath)).toString('base64'), observedImages[1], 'the learner receives the actual menu, not the earlier loader');
  assert.equal(inspection.performedVisualStart?.filter(action => action.type === 'tap').length, 1);
  const extraWait = inspection.setup.slice(2).reduce((sum, step) => sum + (step.type === 'wait' ? step.durationMs : 0), 0);
  assert.ok(extraWait >= 5000 && extraWait <= 10000, 'observed loading time is saved outside gameplay, including inference elapsed time');
  assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-clicked-while-loading'), 'false');
  const { start: _start, ...withoutStart } = proposal;
  const learned = await learnGameProfile(inspection, candidate, { json: async () => withoutStart } as unknown as Pick<GoogleServices, 'json'>);
  assert.ok(learned.profile);
  await loadFixture();
  const executor = new InputExecutor(page, learned.profile.surface);
  for (const step of [...learned.profile.setup, ...learned.profile.start]) await executor.step(step);
  const body = page.frames()[1]!.locator('body');
  assert.equal(await body.getAttribute('data-clicked-while-loading'), 'false', 'a fresh page must finish the same native load before the replayed Start');
  assert.equal(await body.getAttribute('data-trusted'), 'true');
  assert.equal(await body.getAttribute('data-started'), 'true');
});

test('a persistent native loader exhausts its observation budget without fabricated taps', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 35000 }, async t => {
  const { outputDir, candidate } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
  const frame = page.frames()[1]!;
  await frame.setContent('<style>body{margin:0}</style><canvas width="600" height="1100" onclick="document.body.dataset.clicked=String(event.isTrusted)"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillText("Loading 38%",150,600)</script>');
  let calls = 0;
  const provider = { json: async () => { calls++; return { phase: 'loading', buttonIndex: null, point: null, label: 'Loading 38%', reason: 'The same loading progress remains visible.' }; } } as unknown as Pick<GoogleServices, 'json'>;
  await assert.rejects(inspectGamePage(page, candidate.url, outputDir, undefined, provider), /still visibly loading after the bounded menu inspection/);
  assert.equal(calls, 6);
  assert.equal(await frame.locator('body').getAttribute('data-clicked'), null);
  const evidence = JSON.parse(await readFile(join(outputDir, 'inspection-menu-6.json'), 'utf8'));
  assert.equal(evidence.phase, 'loading');
  await assert.rejects(readFile(join(outputDir, 'inspection.json')), { code: 'ENOENT' });
});

for (const { label, gameSetup, allowed } of [
  { label: 'CHOOSE', gameSetup: true, allowed: true },
  { label: 'Continue', gameSetup: true, allowed: true },
  { label: 'Continue', gameSetup: false, allowed: false },
  { label: 'Buy upgrade', gameSetup: true, allowed: false },
  { label: 'With a friend', gameSetup: true, allowed: false },
  { label: 'CHOMP', gameSetup: true, allowed: false },
]) test(`setup confirmation ${label} depends on semantic phase and excludes external actions (${gameSetup})`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 15000 }, async t => {
  const { outputDir, candidate, proposal } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  const loadFixture = async () => {
    await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
    await page.frames()[1]!.setContent(`<style>body{margin:0}</style><canvas width="600" height="1100"></canvas><script>
      const canvas=document.querySelector('canvas'),context=canvas.getContext('2d');
      function draw(lines){context.fillStyle='#123';context.fillRect(0,0,600,1100);context.fillStyle='white';context.font='32px sans-serif';lines.forEach((line,index)=>context.fillText(line,60,400+index*70))}
      draw(['Choose your lunch','Sandwich selected - free',${JSON.stringify(label)}]);
      canvas.onclick=event=>{document.body.dataset.chosen='sandwich';document.body.dataset.trusted=String(event.isTrusted);draw(['Hold the right arrow to move.','GAME BOARD'])};
    </script>`);
  };
  await loadFixture();
  const images: string[] = [];
  const provider = { json: async (prompt: string, _schema: unknown, media: { data: string }[]) => {
    assert.match(prompt, /First transcribe the button's exact visible label, then classify it/);
    assert.match(prompt, /CHOMP is not CHOOSE/);
    images.push(media[0]!.data);
    return images.length === 1
      ? { phase: gameSetup && label !== 'CHOMP' ? 'setup' : 'playing', buttonIndex: null, point: gameSetup && label !== 'CHOMP' ? { x: 0.5, y: 0.55 } : null, label, reason: gameSetup && label !== 'CHOMP' ? 'The free sandwich is already selected in the lunch setup menu; its confirmation advances to controls.' : 'This is a gameplay action, not setup.' }
      : { phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'The selected option is confirmed; the active board now shows ArrowRight controls.' };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, provider);
  assert.equal(inspection.performedVisualStart?.filter(action => action.type === 'tap').length ?? 0, allowed ? 1 : 0);
  assert.equal(images.length, allowed ? 2 : 1, 'an allowed setup action must be followed by a new observation');
  const body = page.frames()[1]!.locator('body');
  assert.equal(await body.getAttribute('data-chosen'), allowed ? 'sandwich' : null);
  if (allowed) {
    assert.equal(await body.getAttribute('data-trusted'), 'true');
    assert.notEqual(images[0], images[1], 'the inspector must see revealed controls instead of assuming setup succeeded');
    assert.equal((await readFile(inspection.imagePath)).toString('base64'), images[1]);
    const { start: _start, ...withoutStart } = proposal;
    const learned = await learnGameProfile(inspection, candidate, { json: async (_prompt: string, _schema: unknown, media: { data: string }[]) => {
      assert.equal(media[1]!.data, images[1], 'control learning receives the post-confirmation screenshot');
      return withoutStart;
    } } as unknown as Pick<GoogleServices, 'json'>);
    assert.ok(learned.profile);
    await loadFixture();
    const executor = new InputExecutor(page, learned.profile.surface);
    for (const step of [...learned.profile.setup, ...learned.profile.start]) await executor.step(step);
    assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-chosen'), 'sandwich', 'the same default choice must be reproducible in a fresh page');
  }
  const saved = JSON.parse(await readFile(join(outputDir, 'inspection-menu-1.json'), 'utf8'));
  assert.equal(saved.phase, gameSetup && label !== 'CHOMP' ? 'setup' : 'playing');
  if (saved.phase === 'setup') assert.match(saved.reason, /free sandwich.*setup/);
});

for (const scenario of ['DOM instructions', 'canvas instructions', 'symbol close', 'missing return', 'broken return'] as const) test(`help inspection handles ${scenario} with one native round trip before New World`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const { outputDir, candidate, proposal } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  const helpName = scenario === 'canvas instructions' ? 'Controls' : 'How to Play';
  const returnName = scenario === 'symbol close' ? '×' : scenario === 'canvas instructions' ? 'Close' : 'Back';
  const loadFixture = async () => {
    await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
    await page.frames()[1]!.setContent(`<style>body{margin:0;background:#123;color:white}button{width:240px;height:80px}#board,#help{display:none}</style>
      <div id="menu"><button id="start">New World</button><button id="openHelp">${helpName}</button><button>Options...</button><button>About</button></div>
      <div id="help">${scenario === 'canvas instructions' ? '<canvas id="helpCanvas" width="600" height="800"></canvas>' : '<p>Hold ArrowRight to walk. Tap Space to jump.</p>'}${scenario === 'missing return' ? '<button aria-label="Unlabeled icon">?</button>' : `<button id="return">${returnName}</button>`}</div>
      <canvas id="board" width="600" height="1000"></canvas><script>
        const menu=document.getElementById('menu'),help=document.getElementById('help'),board=document.getElementById('board');
        document.body.dataset.clicks='';document.body.dataset.keys='';
        document.addEventListener('keydown',event=>{document.body.dataset.keys+=event.code+','});
        function log(event,name){document.body.dataset.clicks+=name+':'+event.isTrusted+','}
        document.getElementById('openHelp').onclick=event=>{log(event,'help');menu.style.display='none';help.style.display='block';${scenario === 'canvas instructions' ? "const context=document.getElementById('helpCanvas').getContext('2d');context.fillStyle='white';context.font='30px sans-serif';context.fillText('Hold ArrowRight to walk.',30,150)" : ''}};
        ${scenario === 'missing return' ? '' : `document.getElementById('return').onclick=event=>{log(event,'return');${scenario === 'broken return' ? '' : "help.style.display='none';menu.style.display='block'"}};`}
        document.getElementById('start').onclick=event=>{log(event,'start');menu.style.display='none';board.style.display='block'};
      </script>`);
  };
  await loadFixture();
  const provider = { json: async () => ({ phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'The help and start menus are closed; gameplay is visible.' }) } as unknown as Pick<GoogleServices, 'json'>;
  if (scenario === 'missing return' || scenario === 'broken return') {
    await assert.rejects(inspectGamePage(page, candidate.url, outputDir, undefined, provider), scenario === 'missing return' ? /no visible Back\/Close button/ : /did not return from help to the menu/);
    const failed = JSON.parse(await readFile(join(outputDir, 'inspection-help.json'), 'utf8'));
    assert.equal(failed.returnCompleted, false);
    assert.ok((await readFile(failed.imagePath)).length);
    assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-clicks'), scenario === 'missing return' ? 'help:true,' : 'help:true,return:true,');
    assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-keys'), '', 'missing return must not cause a guessed Escape key');
    await assert.rejects(readFile(join(outputDir, 'inspection.json')), { code: 'ENOENT' });
    return;
  }
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, provider);
  assert.deepEqual(inspection.help?.opened, { selector: '#openHelp', label: helpName });
  assert.deepEqual(inspection.help?.returned, { selector: '#return', label: returnName });
  assert.deepEqual(inspection.performedStart, { selector: '#start', label: 'New World' });
  assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-clicks'), 'help:true,return:true,start:true,');
  assert.equal(JSON.parse(await readFile(join(outputDir, 'inspection-help.json'), 'utf8')).returnCompleted, true);
  assert.equal(JSON.parse(await readFile(join(outputDir, 'inspection.json'), 'utf8')).help.imagePath, inspection.help!.imagePath);
  if (scenario !== 'canvas instructions') assert.match(inspection.text, /Observed help panel:\nHold ArrowRight to walk/);
  else assert.doesNotMatch(inspection.help!.text, /ArrowRight/, 'canvas instructions must be carried by the saved raster');
  const helpImage = (await readFile(inspection.help!.imagePath)).toString('base64');
  const { start: _start, ...withoutStart } = proposal;
  const learned = await learnGameProfile(inspection, candidate, { json: async (prompt: string, _schema: unknown, media: { data: string }[]) => {
    assert.match(prompt, /third image is the observed How to Play\/Controls panel/);
    assert.equal(media.length, 3); assert.equal(media[2]!.data, helpImage);
    return withoutStart;
  } } as unknown as Pick<GoogleServices, 'json'>);
  assert.ok(learned.profile);
  assert.equal(learned.profile.start.filter(step => step.type === 'click').length, 1);
  await rm(join(outputDir, 'learning.json'));
  await learnFeedbackProfile(inspection, candidate, { json: async (prompt: string, _schema: unknown, media: { data: string }[]) => {
    assert.match(prompt, /third image is the saved How to Play\/Controls panel/);
    assert.equal(media.length, 3); assert.equal(media[2]!.data, helpImage);
    return { supported: false, confidence: 'high', latencyTolerant: false, objective: 'Observe one movement.', instructions: 'ArrowRight walks.', allowedKeys: ['ArrowRight'], allowPointer: false, evidence: ['Observed help panel maps ArrowRight to walking.'], limitations: ['SYNTHETIC reflex game.'] };
  } } as unknown as Pick<GoogleServices, 'json'>);
  await loadFixture();
  const executor = new InputExecutor(page, learned.profile.surface);
  for (const step of [...learned.profile.setup, ...learned.profile.start]) await executor.step(step);
  assert.equal(await page.frames()[1]!.locator('body').getAttribute('data-clicks'), 'start:true,', 'fresh capture must not replay help navigation');
});

for (const mode of ['timed', 'feedback'] as const) test(`${mode} learning receives observed tutorial pages as instructions, not current board coordinates`, async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  inspection.readyToPlay = true;
  inspection.tutorials = [{ text: 'Observed tutorial: ArrowRight moves.', imagePath: inspection.imagePath }];
  const { start: _start, ...withoutStart } = proposal;
  const provider = { json: async (prompt: string, _schema: unknown, media: { data: string }[]) => {
    assert.match(prompt, /final 1 images are observed tutorial pages in order/);
    assert.match(prompt, /not current board coordinates|never as current gameplay coordinates/);
    assert.equal(media.length, 3);
    assert.equal(media[2]!.data, (await readFile(inspection.imagePath)).toString('base64'));
    return mode === 'timed' ? withoutStart : { supported: true, confidence: 'high', latencyTolerant: true,
      objective: 'Move right.', instructions: 'ArrowRight moves.', allowedKeys: ['ArrowRight'], allowPointer: false,
      evidence: ['The observed tutorial shows ArrowRight.'], limitations: [] };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await (mode === 'timed' ? learnGameProfile : learnFeedbackProfile)(inspection, candidate, provider);
  assert.deepEqual(learned.profile?.start, []);
});

test('start indexes cover the complete observed button list without inventing selectors', async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  inspection.startTargets = Array.from({ length: 26 }, (_, index) => ({ selector: `#observed-${index}`, label: `Observed control ${index}` }));
  const provider = { json: async () => ({ ...proposal, start: [{ type: 'button', index: 25 }] }) } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, provider);
  assert.deepEqual(learned.profile?.start, [{ type: 'click', target: { selector: '#observed-25', frames: ['iframe[title="Astrocade Game"]'] } }]);
});

for (const allowLook of [false, true]) test(`timed relative look requires a visible-control assessment (${allowLook})`, async t => {
  const { candidate, inspection, proposal } = await fixture(t);
  inspection.text = 'Mouse Look controls the camera after the visible Start button.';
  inspection.pointerLocked = true;
  const look = { type: 'look' as const, dx: 30, dy: 10, durationMs: 200 };
  const provider = { json: async (prompt: string) => {
    assert.match(prompt, /Browser pointer lock at inspection: true/);
    assert.match(prompt, /signed CSS-pixel dx\/dy offsets/);
    return { ...proposal, allowLook, actions: [look], evidence: ['The visible instructions show Mouse Look.'] };
  } } as unknown as Pick<GoogleServices, 'json'>;
  const learned = await learnGameProfile(inspection, candidate, provider);
  if (allowLook) {
    assert.equal(learned.profile?.verification, 'unverified');
    if (learned.profile?.controller.type === 'timed') assert.deepEqual(learned.profile.controller.actions, [look]);
    else assert.fail('Expected a bounded timed look probe.');
  } else {
    assert.equal(learned.profile, undefined);
    assert.match(learned.limitations.join(' '), /Relative mouse look was not established/);
  }
});
