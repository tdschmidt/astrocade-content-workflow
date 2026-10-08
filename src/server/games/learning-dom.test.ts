import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium, type Page } from 'playwright';
import type { CaptureOptions } from '../media/recorder.js';
import type { Inference } from '../providers/inference.js';
import { learnFeedbackProfile } from './feedback.js';
import { inspectGamePage, learnGameProfile } from './learning.js';
import { runCaptureAttempt } from './runner.js';
import type { GameCandidate } from './schema.js';

const browserTest = { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 };
const frameSelector = 'iframe[title="Astrocade Game"]';
const candidate: GameCandidate = { id: 'HtmlFixture', title: 'HTML choice fixture', url: 'https://www.astrocade.com/games/html-fixture/HtmlFixture', titleSource: 'visible_text', metrics: [], observations: [] };
const gameHtml = `<!doctype html><style>
  html,body{margin:0;width:100%;height:100%;background:#14263c;color:white;font:24px sans-serif}
  [hidden]{display:none!important}button{font:24px sans-serif;width:240px;height:60px}
  #menu,#help{padding:30px}#choice{position:absolute;left:20%;top:65%;width:60%;height:10%}
  </style><section id="menu"><h1>One choice</h1><button id="helpButton">How to Play</button><button id="start">Start</button></section>
  <section id="help" hidden>Tap Choose to finish this untimed round.<button id="back">Back</button></section>
  <section id="game" hidden><h1>Choose the blue door</h1><p id="result">Result: waiting</p><button id="choice">Choose</button></section>
  <span hidden>HIDDEN GAME VALUE</span><script>
  window.fixtureEvents=[];
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click'])document.addEventListener(type,event=>{
    window.fixtureEvents.push({type,target:event.target.id||event.target.tagName,x:event.clientX,y:event.clientY,button:event.button,trusted:event.isTrusted,time:event.timeStamp});
  },true);
  const menu=document.querySelector('#menu'),help=document.querySelector('#help'),game=document.querySelector('#game');
  document.querySelector('#helpButton').onclick=()=>{menu.hidden=true;help.hidden=false};
  document.querySelector('#back').onclick=()=>{help.hidden=true;menu.hidden=false};
  document.querySelector('#start').onclick=e=>{menu.hidden=true;game.hidden=false;game.dataset.started=String(e.isTrusted)};
  document.querySelector('#choice').onclick=e=>{document.querySelector('#result').textContent='Result: blue door opened; trusted: '+e.isTrusted;document.body.style.background='#18543c'};
  </script>`;

async function fixture(t: TestContext, body = gameHtml) {
  const outputDir = await mkdtemp(join(tmpdir(), 'astrocade-dom-learning-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const viewport = { width: 720, height: 1280 };
  const newPage = async () => {
    const page = await browser.newPage({ viewport });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: route.request().url().startsWith('https://fixture.invalid/') ? body : `<!doctype html><style>
      body{margin:0}iframe{position:absolute;left:50px;top:100px;width:400px;height:600px;border:0}
      </style><p>OUTER PAGE TEXT must never reach the gameplay observer.</p>
      <button aria-label="Start playing" onclick="this.remove()">Open game</button>
      <button id="outsideStart" onclick="document.body.dataset.outsideClicked='true'">Start</button>
      <iframe title="Astrocade Game" src="https://fixture.invalid/game"></iframe>` }));
    return page;
  };
  const page = await newPage();
  await page.goto(candidate.url);
  return { outputDir, page, viewport, newPage };
}

for (const mode of ['timed', 'feedback'] as const) test(`HTML-only inspection learns and replays native ${mode} controls inside the game frame`, browserTest, async t => {
  const { outputDir, page, viewport, newPage } = await fixture(t);
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, {
    json: async () => ({ phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'The observed Start revealed an active choice.' }),
  } as unknown as Pick<Inference, 'json'>);
  assert.deepEqual(inspection.surface, { selector: frameSelector, frames: [] });
  assert.deepEqual(inspection.ready, { selector: '#start', frames: [frameSelector] });
  assert.deepEqual(inspection.startTargetFrames, [frameSelector]);
  assert.deepEqual(inspection.performedStart, { selector: '#start', label: 'Start' });
  assert.match(inspection.help!.text, /Tap Choose to finish this untimed round/);
  assert.match(inspection.text, /Choose the blue door/);
  assert.doesNotMatch(inspection.text, /OUTER PAGE TEXT|HIDDEN GAME VALUE/);
  assert.notDeepEqual(await readFile(inspection.beforeImagePath), await readFile(inspection.imagePath));
  const common = { supported: true, confidence: 'high', objective: 'Open the blue door.', evidence: ['The observed help says to tap Choose.'], limitations: [] };
  const provider = { json: async () => mode === 'timed'
    ? { ...common, actions: [{ type: 'tap', point: { x: 0.5, y: 0.7 } }] }
    : { ...common, latencyTolerant: true, instructions: 'Tap Choose to finish this untimed round.', allowedKeys: [], allowPointer: true },
  } as unknown as Pick<Inference, 'json'>;
  const learned = await (mode === 'timed' ? learnGameProfile : learnFeedbackProfile)(inspection, candidate, provider, undefined, { maxDurationMs: 10000 });
  assert.ok(learned.profile);
  assert.equal(learned.profile.focus, 'focus');
  assert.deepEqual(learned.profile.start[0], { type: 'click', target: { selector: '#start', frames: [frameSelector] } });
  await page.close();

  let finalText = '', outsideClicked = false, startedNatively = false, decisions = 0;
  let capturePage: Page | undefined;
  let browserEvidence: unknown;
  // The capture runner, fresh browser page, screenshots and pointer events are
  // real. Only media encoding is stubbed; recorder integration has its own tests.
  const createCapture = async (options: CaptureOptions) => {
    capturePage = await newPage();
    const capturedPage = capturePage;
    return {
      page: capturedPage, start: async () => {},
      finish: async () => {
        const game = capturedPage.frameLocator(frameSelector);
        finalText = await game.locator('#result').innerText();
        browserEvidence = await game.locator('body').evaluate(body => {
          const choice = body.querySelector('#choice')!;
          const rect = choice.getBoundingClientRect();
          const hit = document.elementFromPoint(innerWidth * 0.5, innerHeight * 0.7);
          return { events: (window as unknown as { fixtureEvents: unknown[] }).fixtureEvents,
            choice: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            hit: hit?.id || hit?.tagName, active: document.activeElement?.id || document.activeElement?.tagName,
            viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } };
        });
        startedNatively = await game.locator('#game').getAttribute('data-started') === 'true';
        outsideClicked = await capturedPage.locator('body').getAttribute('data-outside-clicked') === 'true';
        await capturedPage.screenshot({ path: join(outputDir, `${mode}-result.png`) });
        return { path: options.outputPath, durationSeconds: 1, ...viewport, codec: 'fixture' };
      }, cancel: async () => {}, close: async () => { await capturedPage.close(); },
    };
  };
  const result = await runCaptureAttempt({
    profile: learned.profile, outputPath: join(outputDir, 'capture.webm'), allowUnverified: true, createCapture,
    ...(mode === 'feedback' ? { decide: async (observation: { text: string; image: Buffer }) => {
      assert.doesNotMatch(observation.text, /OUTER PAGE TEXT|HIDDEN GAME VALUE/);
      assert.match(observation.text, /Choose the blue door/);
      assert.ok(observation.image.length > 100);
      if (decisions++) {
        assert.match(observation.text, /blue door opened; trusted: true/);
        return { stop: true, reason: 'The visible result confirms the door opened.', actions: [] };
      }
      assert.match(observation.text, /Result: waiting/);
      return { stop: false, reason: 'Tap the visible Choose button.', actions: [{ type: 'tap', point: { x: 0.5, y: 0.7 } }] };
    } } : {}),
  });
  if (finalText !== 'Result: blue door opened; trusted: true' || result.controllerError) {
    const failureImage = join(tmpdir(), `astrocade-dom-${mode}-failure-${Date.now()}.png`);
    await copyFile(join(outputDir, `${mode}-result.png`), failureImage);
    t.diagnostic(JSON.stringify({ mode, failureImage, result, browserEvidence, profile: learned.profile }));
  }
  assert.equal(result.controllerError, undefined, 'the native fixture must complete both observations without a swallowed assertion');
  assert.equal(result.actionsExecuted, 2, 'one replayed Start settling wait and one gameplay tap');
  assert.deepEqual(result.surfaceBounds, { x: 50, y: 100, width: 400, height: 600 });
  assert.equal(finalText, 'Result: blue door opened; trusted: true');
  assert.equal(startedNatively, true);
  assert.equal(outsideClicked, false, 'the matching Start label on the outer page must not be clicked');
  assert.equal(decisions, mode === 'feedback' ? 2 : 0);
});

test('a blank HTML game viewport is evidence to reject, not automatic control support', browserTest, async t => {
  const { outputDir, page } = await fixture(t, '<!doctype html><style>html,body{margin:0;background:#123}</style>');
  const inspection = await inspectGamePage(page, candidate.url, outputDir);
  assert.deepEqual(inspection.surface, { selector: frameSelector, frames: [] });
  assert.equal(inspection.text, '');
  assert.deepEqual(inspection.startTargets, []);
  const learned = await learnGameProfile(inspection, candidate, { json: async () => ({
    supported: false, confidence: 'low', objective: '', start: [], actions: [], evidence: [], limitations: ['No visible controls or rules.'],
  }) } as unknown as Pick<Inference, 'json'>);
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /No high-confidence repeatable control plan/);
});
