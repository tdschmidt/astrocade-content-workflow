import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium } from 'playwright';
import type { GoogleServices } from '../providers/google.js';
import { inspectGamePage, isObservedStartLabel, learnGameProfile, type GameInspection } from './learning.js';
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
});

test('low-confidence controls are skipped rather than promoted to a runnable plan', async t => {
  const { candidate, inspection, proposal, google } = await fixture(t);
  proposal.confidence = 'low';
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /No high-confidence/);
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

test('plans longer than the learning budget are skipped', async t => {
  const { candidate, inspection, proposal, google } = await fixture(t);
  proposal.actions = Array.from({ length: 10 }, () => ({ type: 'wait', durationMs: 5000 })) as typeof proposal.actions;
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile, undefined);
  assert.match(learned.limitations.join(' '), /45-second/);
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

for (const label of ['START RUN', 'DEPLOY ↗']) test(`inspection clicks ${label} before waiting for its hidden game canvas`, { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const { outputDir, candidate } = await fixture(t);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent('<style>body{margin:0}iframe{width:600px;height:1100px;border:0}button{position:absolute;z-index:2;top:0;left:0}</style><button aria-label="Start playing" onclick="this.remove()">Open game</button><iframe title="Astrocade Game"></iframe>');
  const frame = page.frames()[1]!;
  await frame.setContent(`<style>body{margin:0;background:#123}canvas{display:none;background:#24b}button{margin:100px;width:200px;height:80px}</style><button id="start">${label}</button><canvas width="600" height="1100"></canvas><script>document.querySelector("button").onclick=event=>{document.body.dataset.trusted=String(event.isTrusted);document.querySelector("button").remove();document.querySelector("canvas").style.display="block"}</script>`);
  const inspection = await inspectGamePage(page, candidate.url, outputDir);
  assert.deepEqual(inspection.performedStart, { selector: '#start', label });
  assert.equal(inspection.ready.selector, '#start');
  assert.equal(inspection.surface.selector, ':nth-match(canvas, 1)');
  assert.equal(await frame.locator('body').getAttribute('data-trusted'), 'true');
  assert.notDeepEqual(await readFile(inspection.beforeImagePath), await readFile(inspection.imagePath));
});
