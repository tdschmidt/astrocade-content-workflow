import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { GoogleServices } from '../providers/google.js';
import { learnGameProfile, type GameInspection } from './learning.js';
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
  const { candidate, inspection, proposal, google } = await fixture(t);
  inspection.performedStart = inspection.startTargets[0];
  proposal.start = [];
  const learned = await learnGameProfile(inspection, candidate, google);
  assert.equal(learned.profile?.start.filter(step => step.type === 'click').length, 1);
  assert.deepEqual(learned.profile?.start[0], { type: 'click', target: { selector: '#start', frames: inspection.surface.frames } });
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
