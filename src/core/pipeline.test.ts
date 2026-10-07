import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { z } from 'zod';
import { Configuration } from '../server/config.js';
import { NeedsAttention } from '../server/jobs.js';
import { verifiedProfiles } from '../server/games/profiles.js';
import type { GameCandidate } from '../server/games/schema.js';
import { runPipeline, type CoreServices } from './pipeline.js';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'core-workflow-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = await Configuration.open(join(directory, 'config'));
  await config.save({ geminiApiKey: 'PRIVATE_TEST_KEY' });
  const preset = verifiedProfiles[0]!;
  const candidate: GameCandidate = { id: 'fixture', title: 'SYNTHETIC test candidate', titleSource: 'visible_text', url: preset.gameUrl, metrics: [], observations: [] };
  const calls = { discover: 0, inspect: 0, capture: 0, analyze: 0, draft: 0, render: 0, validate: 0 };
  const services: Partial<CoreServices> = {
    discoverGames: async () => { calls.discover++; return { status: 'ok', observedAt: new Date().toISOString(), candidates: [candidate], sources: [] }; },
    nominateGames: async () => [{ gameId: candidate.id, hypothesis: 'Fixture hypothesis.', viewerQuestion: 'Fixture question?', controlRisk: 'Fixture only.' }],
    inspectGame: async (_game, outputDir) => {
      calls.inspect++;
      return { gameUrl: candidate.url, observedAt: new Date().toISOString(), outputDir, imagePath: join(outputDir, 'inspection.png'), beforeImagePath: join(outputDir, 'inspection-before.png'), text: 'SYNTHETIC controls', surface: preset.surface, ready: preset.ready, startTargets: [], viewport: preset.viewport, setup: preset.setup };
    },
    runCaptureAttempt: async options => {
      calls.capture++; await writeFile(options.outputPath, 'SYNTHETIC source, not actual video');
      const now = new Date().toISOString();
      return { attemptId: 'fixture', gameUrl: candidate.url, profileId: preset.id, profileVerification: 'verified', artifact: { path: options.outputPath, durationSeconds: 8, width: 720, height: 1280, codec: 'vp9' }, surfaceBounds: { x: 0, y: 0, width: 720, height: 1280 }, actionsExecuted: 7, decisions: [], stopReason: 'actions_complete', startedAt: now, finishedAt: now };
    },
    analyzeFootage: async () => { calls.analyze++; return { usable: true, reason: 'Fixture visible consequence.', mechanic: 'Fixture', visualScore: 4, events: [{ startSeconds: 1, endSeconds: 7, event: 'Fixture action', evidence: 'SYNTHETIC evidence', outcome: 'Fixture result' }] }; },
    draftScript: async () => { calls.draft++; return { hook: 'Fixture hook', narration: '', caption: 'SYNTHETIC test caption', rationale: 'Fixture edit decision.', cuts: [{ startSeconds: 1, endSeconds: 7 }] }; },
    renderPortrait: async options => { calls.render++; await writeFile(options.outputPath, 'SYNTHETIC final, not actual video'); return { path: options.outputPath, durationSeconds: 6, width: 1080, height: 1920, hasAudio: false }; },
    validateVideo: async () => { calls.validate++; return { durationSeconds: 6, sizeBytes: 32, video: { width: 1080, height: 1920, codec: 'h264', frameRate: 30 } }; },
  };
  return { directory: join(directory, 'run'), config, services, calls, candidate };
}

test('SYNTHETIC core run resumes after analysis failure without rediscovery or recapture', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const analyze = services.analyzeFootage!;
  services.analyzeFootage = async (...args) => {
    if (!calls.analyze) { calls.analyze++; throw new Error('Temporary failure PRIVATE_TEST_KEY'); }
    return analyze(...args);
  };
  const options = { directory, model: 'fixture-model', quiet: true };
  await assert.rejects(runPipeline(options, config, services), /Temporary failure/);
  assert.ok(!(await readFile(join(directory, 'trace.jsonl'), 'utf8')).includes('PRIVATE_TEST_KEY'));
  const resumed = await runPipeline(options, config, services);
  assert.equal(resumed.status, 'complete');
  assert.deepEqual(calls, { discover: 1, inspect: 1, capture: 1, analyze: 2, draft: 1, render: 1, validate: 0 });
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /Fixture edit decision/);
  assert.equal(await readFile(join(directory, 'caption.txt'), 'utf8'), 'SYNTHETIC test caption\n');
  await runPipeline(options, config, services);
  assert.equal(calls.render, 1);
  assert.equal(calls.analyze, 2);
  assert.equal(calls.validate, 1);
});

test('capture stage stops before model analysis and refuses changed source bytes on resume', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const run = await runPipeline({ directory, model: 'fixture-model', stage: 'capture', quiet: true }, config, services);
  assert.equal(run.status, 'paused');
  assert.equal(calls.analyze, 0);
  await writeFile(run.attempts[0]!.capture!.path, 'ALTERED');
  await assert.rejects(runPipeline({ directory, model: 'fixture-model', stage: 'edit', quiet: true }, config, services), /Saved source changed/);
  assert.equal(calls.analyze, 0);
  assert.equal(calls.capture, 1);
});

test('a live run lock rejects a second writer before discovery', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory);
  await writeFile(join(directory, '.lock'), String(process.pid));
  await assert.rejects(runPipeline({ directory, model: 'fixture-model', quiet: true }, config, services), /already open/);
  assert.equal(calls.discover, 0);
});

test('completed runs remain complete without retrying failed candidates, even for an earlier stage', async t => {
  const { directory, config, services, calls, candidate } = await fixture(t);
  const discover = services.discoverGames!, capture = services.runCaptureAttempt!;
  services.discoverGames = async (...args) => ({ ...await discover(...args), candidates: [candidate, { ...candidate, id: 'retry' }] });
  services.nominateGames = async () => ['fixture', 'retry'].map(gameId => ({ gameId, hypothesis: 'Fixture', viewerQuestion: 'Fixture?', controlRisk: 'Fixture' }));
  services.runCaptureAttempt = async (...args) => {
    if (args[0].outputPath.includes('game-retry')) { calls.capture++; throw new Error('Candidate failed'); }
    return capture(...args);
  };
  const options = { directory, model: 'fixture-model', quiet: true };
  const first = await runPipeline(options, config, services);
  assert.equal(first.status, 'complete');
  for (const stage of ['all', 'capture', 'discover'] as const) {
    const resumed = await runPipeline({ ...options, stage }, config, services);
    assert.equal(resumed.status, 'complete');
    assert.equal(resumed.videoPath, first.videoPath);
  }
  assert.deepEqual(calls, { discover: 1, inspect: 2, capture: 2, analyze: 1, draft: 1, render: 1, validate: 3 });
});

test('saved video resumes without a provider key and repairs a missing caption after interrupted finalization', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const options = { directory, model: 'fixture-model', quiet: true };
  const first = await runPipeline(options, config, services);
  await rm(join(directory, 'caption.txt'));
  const state = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  state.status = 'running';
  await writeFile(join(directory, 'run.json'), JSON.stringify(state));
  const noKey: Configuration = Object.assign(Object.create(config), { get: () => ({ ...config.get(), geminiApiKey: '' }) });
  const resumed = await runPipeline(options, noKey, services);
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.videoPath, first.videoPath);
  assert.equal(await readFile(join(directory, 'caption.txt'), 'utf8'), 'SYNTHETIC test caption\n');
  assert.equal(calls.capture, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.validate, 1);
});

test('a saved script freezes candidate work when resuming a failed render', async t => {
  const { directory, config, services, calls, candidate } = await fixture(t);
  const discover = services.discoverGames!, capture = services.runCaptureAttempt!, render = services.renderPortrait!;
  services.discoverGames = async (...args) => ({ ...await discover(...args), candidates: [candidate, { ...candidate, id: 'retry' }] });
  services.nominateGames = async () => ['fixture', 'retry'].map(gameId => ({ gameId, hypothesis: 'Fixture', viewerQuestion: 'Fixture?', controlRisk: 'Fixture' }));
  services.runCaptureAttempt = async (...args) => {
    if (args[0].outputPath.includes('game-retry')) { calls.capture++; throw new Error('Candidate failed'); }
    return capture(...args);
  };
  services.renderPortrait = async (...args) => {
    if (!calls.render) { calls.render++; throw new Error('Render interrupted'); }
    return render(...args);
  };
  const options = { directory, model: 'fixture-model', quiet: true };
  await assert.rejects(runPipeline(options, config, services), /Render interrupted/);
  const noKey: Configuration = Object.assign(Object.create(config), { get: () => ({ ...config.get(), geminiApiKey: '' }) });
  const resumed = await runPipeline(options, noKey, services);
  assert.equal(resumed.status, 'complete');
  assert.deepEqual(calls, { discover: 1, inspect: 2, capture: 2, analyze: 1, draft: 1, render: 2, validate: 0 });
});

test('candidate analysis validation failure preserves a good candidate and completed resume does no extra work', async t => {
  for (const invalid of [new NeedsAttention('Invalid playable span: 4–3 seconds'), z.boolean().safeParse('invalid').error!]) {
    const { directory, config, services, calls, candidate } = await fixture(t);
    const discover = services.discoverGames!, analyze = services.analyzeFootage!;
    services.discoverGames = async (...args) => ({ ...await discover(...args), candidates: [candidate, { ...candidate, id: 'invalid' }] });
    services.nominateGames = async () => ['fixture', 'invalid'].map(gameId => ({ gameId, hypothesis: 'Fixture', viewerQuestion: 'Fixture?', controlRisk: 'Fixture' }));
    services.analyzeFootage = async (...args) => {
      if (args[0].game.id === 'invalid') { calls.analyze++; throw invalid; }
      return analyze(...args);
    };
    const options = { directory, model: 'fixture-model', quiet: true };
    const run = await runPipeline(options, config, services);
    assert.equal(run.status, 'complete');
    assert.equal(run.selectedGameId, 'fixture');
    assert.equal(run.attempts[1]!.error, invalid.message);
    assert.ok(!(run.attempts[1]!.capture!.analysis));
    assert.ok((await readFile(join(directory, 'report.md'), 'utf8')).includes(invalid.message));
    const trace = (await readFile(join(directory, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(trace.some(event => event.stage === 'analyze' && event.status === 'failed' && event.data.gameId === 'invalid'));
    await runPipeline(options, config, services);
    assert.deepEqual(calls, { discover: 1, inspect: 2, capture: 2, analyze: 2, draft: 1, render: 1, validate: 1 });
  }
});

test('analysis provider outages and authentication failures stop without rejecting the game', async t => {
  for (const status of [401, 503]) {
    const { directory, config, services, calls } = await fixture(t);
    services.analyzeFootage = async () => { calls.analyze++; throw Object.assign(new Error(`Provider HTTP ${status}`), { status }); };
    await assert.rejects(runPipeline({ directory, model: 'fixture-model', quiet: true }, config, services), new RegExp(`Provider HTTP ${status}`));
    const run = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
    assert.equal(run.status, 'failed');
    assert.equal(run.attempts[0].error, undefined);
    assert.equal(run.attempts[0].unsupported, false);
    assert.equal(calls.render, 0);
  }
});

test('all invalid analyses fail honestly, and an explicit successful retry clears stale candidate errors', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const analyze = services.analyzeFootage!;
  services.analyzeFootage = async () => { calls.analyze++; throw new NeedsAttention('Invalid playable span'); };
  const options = { directory, model: 'fixture-model', quiet: true };
  await assert.rejects(runPipeline(options, config, services), /No recording contains a supported short-form moment/);
  services.analyzeFootage = analyze;
  const run = await runPipeline({ ...options, stage: 'edit' }, config, services);
  assert.equal(run.status, 'complete');
  assert.equal(run.attempts[0]!.error, undefined);
  assert.equal(calls.capture, 1);
  assert.equal(calls.analyze, 2);
  assert.ok(!(await readFile(join(directory, 'report.md'), 'utf8')).includes('Attempt stopped:'));
});
