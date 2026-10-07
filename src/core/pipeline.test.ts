import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { z } from 'zod';
import { Configuration } from '../server/config.js';
import { NeedsAttention } from '../server/jobs.js';
import { verifiedProfiles } from '../server/games/profiles.js';
import { GoogleServices } from '../server/providers/google.js';
import type { GameCandidate } from '../server/games/schema.js';
import { defaultContentBrief, type ContentAssessment } from '../shared/content.js';
import { runPipeline, type CoreServices } from './pipeline.js';

const content: ContentAssessment = {
  angle: 'prediction', clarity: 3, participation: 2, payoff: 3, readability: 3, distinctiveness: 1,
  evidence: 'SYNTHETIC route choice and readable consequence.', textPlacement: 'upper', placementReason: 'SYNTHETIC lower route labels must stay visible.',
};

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
    nominateGames: async () => [{ gameId: candidate.id, hypothesis: 'Fixture hypothesis.', viewerQuestion: 'Fixture question?', controlRisk: 'Fixture only.', angle: 'prediction', captureGoal: 'SYNTHETIC meaningful route choice.', rejectIf: 'SYNTHETIC route labels are unreadable.' }],
    inspectGame: async (_game, outputDir) => {
      calls.inspect++;
      return { gameUrl: candidate.url, observedAt: new Date().toISOString(), outputDir, imagePath: join(outputDir, 'inspection.png'), beforeImagePath: join(outputDir, 'inspection-before.png'), text: 'SYNTHETIC controls', surface: preset.surface, ready: preset.ready, startTargets: [], viewport: preset.viewport, setup: preset.setup };
    },
    runCaptureAttempt: async options => {
      calls.capture++; await writeFile(options.outputPath, 'SYNTHETIC source, not actual video');
      const now = new Date().toISOString();
      return { attemptId: 'fixture', gameUrl: candidate.url, profileId: preset.id, profileVerification: 'verified', artifact: { path: options.outputPath, durationSeconds: 8, width: 720, height: 1280, codec: 'vp9' }, surfaceBounds: { x: 0, y: 0, width: 720, height: 1280 }, actionsExecuted: 7, decisions: [], stopReason: 'actions_complete', startedAt: now, finishedAt: now };
    },
    analyzeFootage: async () => { calls.analyze++; return { usable: true, reason: 'Fixture visible consequence.', mechanic: 'Fixture', visualScore: 4, content, events: [{ startSeconds: 1, endSeconds: 7, event: 'Fixture action', evidence: 'SYNTHETIC evidence', outcome: 'Fixture result' }] }; },
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

test('returned edit proposals survive later semantic rejection and resume appends unique redacted records', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const proposal = { cuts: [{ startSeconds: 1, endSeconds: 4 }], reason: 'SYNTHETIC proposal PRIVATE_TEST_KEY' };
  t.mock.method(GoogleServices.prototype, 'json', async () => proposal);
  const draft = services.draftScript!;
  let attempts = 0;
  services.draftScript = async (input, provider, signal) => {
    const result = await provider.json('PRIVATE_PROMPT_NOT_FOR_TRACE', z.object({ cuts: z.array(z.object({ startSeconds: z.number(), endSeconds: z.number() })), reason: z.string() }), [], signal);
    assert.equal(result, proposal);
    if (++attempts === 1) throw new NeedsAttention('SYNTHETIC payoff was cut off after the returned proposal.');
    return draft(input, provider, signal);
  };
  const options = { directory, model: 'fixture-model', quiet: true };
  await assert.rejects(runPipeline(options, config, services), /payoff was cut off/);
  const firstText = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  const first = firstText.trim().split('\n').map(line => JSON.parse(line));
  const responseIndex = first.findIndex(record => record.stage === 'provider.response');
  assert.ok(responseIndex >= 0 && responseIndex < first.findIndex(record => record.stage === 'run' && record.status === 'failed'));
  assert.deepEqual(first[responseIndex].data.response, { ...proposal, reason: 'SYNTHETIC proposal [redacted]' });
  const resumed = await runPipeline(options, config, services);
  assert.equal(resumed.status, 'complete');
  const resumedText = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  assert.ok(resumedText.startsWith(firstText), 'resume must append instead of replacing the failed-attempt evidence');
  const responses = resumedText.trim().split('\n').map(line => JSON.parse(line)).filter(record => record.stage === 'provider.response');
  assert.equal(responses.length, 2);
  assert.notEqual(responses[0].data.requestId, responses[1].data.requestId);
  assert.ok(responses.every(record => record.data.provider === 'gemini' && record.data.model === 'fixture-model'));
  assert.equal(resumedText.includes('PRIVATE_TEST_KEY'), false);
  assert.equal(resumedText.includes('PRIVATE_PROMPT_NOT_FOR_TRACE'), false);
  assert.equal(calls.capture, 1, 'observability must not recapture footage on resume');
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

for (const mode of ['resume', 'from-run'] as const) test(`analysis-only ${mode} saves rejected footage evidence without capturing or editing`, async t => {
  const { directory, config, services, calls, candidate } = await fixture(t);
  const options = { directory, model: 'fixture-model', quiet: true };
  await runPipeline({ ...options, stage: 'capture' }, config, services);
  const manifest = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  manifest.candidates.push({ ...candidate, id: 'uncaptured' });
  manifest.shortlist.push({ gameId: 'uncaptured', hypothesis: 'Fixture', viewerQuestion: 'Fixture?', controlRisk: 'Fixture' });
  manifest.attempts.push({ gameId: 'uncaptured', error: 'SYNTHETIC failed capture.' });
  await writeFile(join(directory, 'run.json'), JSON.stringify(manifest));
  const original = await readFile(join(directory, 'run.json'), 'utf8');
  const originalTrace = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  const analyze = services.analyzeFootage!;
  services.analyzeFootage = async (...args) => ({ ...await analyze(...args), usable: false,
    reason: 'SYNTHETIC only one demonstrated feature; retain evidence for another editing workflow.' });
  services.discoverGames = services.inspectGame = services.runCaptureAttempt = services.draftScript = services.renderPortrait = async () => assert.fail('Analysis must not discover, open a browser, capture, draft or render.');
  const destination = mode === 'resume' ? directory : join(directory, 'analysis-only');
  const analyzed = await runPipeline({ ...options, directory: destination, stage: 'analyze', ...(mode === 'from-run' ? { fromRun: directory } : {}) }, config, services);
  assert.equal(analyzed.status, 'paused');
  assert.equal(analyzed.attempts[0]!.capture!.analysis!.usable, false, 'editorial rejection does not discard the analysis');
  assert.equal(analyzed.attempts[0]!.capture!.analysis!.events.length, 1);
  assert.equal(analyzed.attempts[1]!.error, 'SYNTHETIC failed capture.');
  assert.equal(analyzed.script, undefined);
  assert.equal(analyzed.selectedGameId, undefined);
  assert.equal(analyzed.videoPath, undefined);
  assert.equal(JSON.parse(await readFile(join(destination, 'analysis-fixture.json'), 'utf8')).usable, false);
  assert.equal(JSON.parse(await readFile(join(destination, 'run.json'), 'utf8')).status, 'paused');
  const trace = (await readFile(join(destination, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(trace.some(event => ['select', 'edit', 'render'].includes(event.stage)), false);
  assert.ok(trace.some(event => event.stage === 'analyze' && event.status === 'rejected'));
  await runPipeline({ ...options, directory: destination, stage: 'analyze' }, config, services);
  assert.deepEqual(calls, { discover: 1, inspect: 1, capture: 1, analyze: 1, draft: 0, render: 0, validate: 0 });
  if (mode === 'from-run') {
    assert.equal(analyzed.provenance!.sourceRunPath, directory);
    assert.equal(await readFile(join(directory, 'run.json'), 'utf8'), original);
    assert.equal(await readFile(join(directory, 'trace.jsonl'), 'utf8'), originalTrace);
  }
});

test('analysis requires existing unchanged recordings before discovery, model work or capture', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const options = { directory, model: 'fixture-model', quiet: true };
  await assert.rejects(runPipeline({ ...options, stage: 'analyze' }, config, services), /Analysis needs a saved recording/);
  assert.deepEqual(calls, { discover: 0, inspect: 0, capture: 0, analyze: 0, draft: 0, render: 0, validate: 0 });
  await runPipeline({ ...options, stage: 'discover' }, config, services);
  await assert.rejects(runPipeline({ ...options, stage: 'analyze' }, config, services), /Analysis needs a saved recording/);
  await assert.rejects(runPipeline({ ...options, directory: join(directory, 'empty-analysis'), fromRun: directory, stage: 'analyze' }, config, services), /at least one saved recording/);
  assert.equal(calls.capture, 0);
  const source = await runPipeline({ ...options, stage: 'capture' }, config, services);
  await writeFile(source.attempts[0]!.capture!.path, 'SYNTHETIC replaced source');
  await assert.rejects(runPipeline({ ...options, stage: 'analyze' }, config, services), /Saved source changed/);
  await assert.rejects(runPipeline({ ...options, directory: join(directory, 'changed-analysis'), fromRun: directory, stage: 'analyze' }, config, services), /Saved source changed/);
  assert.equal(calls.analyze, 0);
  assert.equal(calls.capture, 1);
});

test('analysis-only resume refreshes legacy evidence even when an edit exists, without touching the video', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const options = { directory, model: 'fixture-model', quiet: true };
  const completed = await runPipeline(options, config, services);
  const originalVideo = await readFile(completed.videoPath!);
  const manifest = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  delete manifest.attempts[0].capture.analysis.content;
  await writeFile(join(directory, 'run.json'), JSON.stringify(manifest));
  const analyzed = await runPipeline({ ...options, stage: 'analyze' }, config, services);
  assert.equal(analyzed.status, 'paused');
  assert.deepEqual(analyzed.script, completed.script);
  assert.equal(analyzed.videoPath, completed.videoPath);
  assert.deepEqual(await readFile(analyzed.videoPath!), originalVideo);
  assert.ok(analyzed.attempts[0]!.capture!.analysis!.content);
  assert.deepEqual(calls, { discover: 1, inspect: 1, capture: 1, analyze: 2, draft: 1, render: 1, validate: 0 });
});

test('invalid analysis cannot be reported as a completed analysis-only stage', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const options = { directory, model: 'fixture-model', quiet: true };
  await runPipeline({ ...options, stage: 'capture' }, config, services);
  services.analyzeFootage = async () => { calls.analyze++; throw new NeedsAttention('SYNTHETIC invalid evidence window'); };
  await assert.rejects(runPipeline({ ...options, stage: 'analyze' }, config, services), /No recording produced a valid analysis/);
  assert.equal(JSON.parse(await readFile(join(directory, 'run.json'), 'utf8')).status, 'failed');
  assert.equal(calls.draft, 0);
  assert.equal(calls.render, 0);
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
  // A legacy edit must still render even though its analysis predates the rubric.
  const legacy = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  delete legacy.attempts[0].capture.analysis.content;
  delete legacy.contentBrief;
  await writeFile(join(directory, 'run.json'), JSON.stringify(legacy));
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

test('Codex selection requires no Gemini key and persists provider provenance across resume', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const noKey: Configuration = Object.assign(Object.create(config), { get: () => ({ ...config.get(), geminiApiKey: '' }) });
  const options = { directory, model: 'fixture-model', provider: 'codex' as const, quiet: true };
  const run = await runPipeline(options, noKey, services);
  assert.equal(run.provider, 'codex');
  assert.equal(run.attempts[0]!.analysisProvider, 'codex');
  assert.equal(run.scriptProvider, 'codex');
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /codex\/fixture-model/);
  const resumed = await runPipeline({ ...options, provider: 'gemini', model: 'different-model' }, noKey, services);
  assert.equal(resumed.provider, 'gemini');
  assert.equal(resumed.attempts[0]!.analysisProvider, 'codex');
  assert.equal(resumed.scriptProvider, 'codex');
  assert.equal(calls.analyze, 1);
  assert.equal(calls.draft, 1);
});

test('a rejected provider schema during learning stops the run without marking the game unsupported', async t => {
  const { directory, config, services, calls, candidate } = await fixture(t);
  candidate.url = 'https://www.astrocade.com/games/fixture-game/fixture';
  services.learnGameProfile = async () => { throw Object.assign(new Error('Provider rejected schema'), { status: 400 }); };
  await assert.rejects(runPipeline({ directory, model: 'fixture-model', provider: 'codex', playMode: 'timed', quiet: true }, config, services), /Provider rejected schema/);
  const run = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  assert.equal(run.status, 'failed');
  assert.equal(run.attempts[0].unsupported, false);
  assert.equal(run.attempts[0].error, undefined);
  assert.equal(calls.capture, 0);
});

test('feedback mode learns instead of using a timed preset and survives a stage resume', async t => {
  const { directory, config, services, calls } = await fixture(t);
  let learns = 0, controllers = 0;
  const original = services.runCaptureAttempt!;
  services.learnFeedbackProfile = async (_inspection, _candidate, _provider, _signal, intent) => {
    learns++;
    assert.deepEqual(intent, { captureGoal: 'SYNTHETIC meaningful route choice.', rejectIf: 'SYNTHETIC route labels are unreadable.', maxDurationMs: 60000, editingStyle: 'reel' });
    return { profile: { ...verifiedProfiles[0]!, maxDurationMs: intent.maxDurationMs!, controller: { type: 'sparse', maxDecisions: 4, instructions: 'SYNTHETIC slow fixture controls', allowedKeys: [], allowPointer: true } }, evidence: ['Fixture mechanics'], limitations: [] };
  };
  services.createFeedbackController = (_profile, _provider, _directory, _onDecision, intent) => {
    controllers++;
    assert.equal(intent?.captureGoal, 'SYNTHETIC meaningful route choice.');
    assert.equal(intent?.rejectIf, 'SYNTHETIC route labels are unreadable.');
    assert.equal(intent?.maxDurationMs, 60000);
    return async () => ({ observation: 'Fixture complete', outcome: 'success', lesson: '', stop: true, reason: 'Done', actions: [] });
  };
  services.runCaptureAttempt = async options => {
    assert.equal(options.profile.controller.type, 'sparse');
    assert.equal(options.profile.maxDurationMs, 60000);
    assert.ok(options.decide);
    return { ...await original(options), stopReason: 'controller_error', controllerError: 'SYNTHETIC later provider outage' };
  };
  const run = await runPipeline({ directory, model: 'fixture-model', playMode: 'feedback', captureSeconds: 60, stage: 'capture', quiet: true }, config, services);
  assert.equal(run.playMode, 'feedback');
  assert.equal(run.captureSeconds, 60);
  assert.equal(learns, 1); assert.equal(controllers, 1);
  assert.match(run.attempts[0]!.feedbackPath!, /feedback-.*report.md$/);
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /Partial footage is preserved/);
  const resumed = await runPipeline({ directory, model: 'fixture-model', stage: 'edit', quiet: true }, config, services);
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.playMode, 'feedback');
  assert.equal(resumed.captureSeconds, 60);
  assert.equal(calls.capture, 1);
  await assert.rejects(runPipeline({ directory, model: 'fixture-model', playMode: 'timed', quiet: true }, config, services), /new run/);
});

test('legacy episode auto mode reuses one inspection for feedback fallback and resumes without replay', async t => {
  const { directory, config, services, calls } = await fixture(t);
  let timedInspection: Parameters<CoreServices['learnGameProfile']>[0] | undefined;
  let timedLearns = 0, feedbackLearns = 0;
  services.learnGameProfile = async inspection => {
    timedInspection = inspection; timedLearns++;
    await mkdir(inspection.outputDir, { recursive: true });
    await writeFile(join(inspection.outputDir, 'learning.json'), 'SYNTHETIC timed assessment', { flag: 'wx' });
    return { evidence: ['SYNTHETIC changing board observed.'], limitations: ['Current target coordinates cannot be replayed.'] };
  };
  services.learnFeedbackProfile = async (inspection, _candidate, _provider, _signal, intent) => {
    feedbackLearns++;
    assert.deepEqual({ ...inspection, outputDir: timedInspection!.outputDir }, timedInspection);
    assert.equal(inspection.outputDir, join(timedInspection!.outputDir, 'feedback'));
    assert.equal(intent?.maxDurationMs, 80000);
    await writeFile(join(inspection.outputDir, 'learning.json'), 'SYNTHETIC feedback assessment', { flag: 'wx' });
    return {
      profile: { ...verifiedProfiles[0]!, maxDurationMs: intent!.maxDurationMs!, verification: 'unverified', controller: { type: 'sparse', maxDecisions: 4, instructions: 'SYNTHETIC input-paced board', allowedKeys: [], allowPointer: true } },
      evidence: ['SYNTHETIC visible pointer interaction permits a probe.'], limitations: ['The probe still needs observed confirmation.'],
    };
  };
  services.createFeedbackController = () => async () => ({ observation: 'SYNTHETIC complete', outcome: 'success', lesson: '', stop: true, reason: 'SYNTHETIC result', actions: [] });
  const capture = services.runCaptureAttempt!;
  services.runCaptureAttempt = async options => {
    assert.equal(options.profile.controller.type, 'sparse');
    assert.equal(options.profile.maxDurationMs, 80000);
    assert.ok(options.decide);
    return capture(options);
  };
  const options = { directory, model: 'fixture-model', quiet: true, contentBrief: { ...defaultContentBrief, editingStyle: 'episode' as const } };
  const run = await runPipeline({ ...options, playMode: 'auto', captureSeconds: 80, stage: 'capture' }, config, services);
  assert.equal(run.playMode, 'auto');
  assert.equal(run.attempts[0]!.unsupported, false);
  assert.deepEqual(run.attempts[0]!.limitations, ['Timed mode only: Current target coordinates cannot be replayed.', 'Feedback mode: The probe still needs observed confirmation.']);
  assert.deepEqual(run.attempts[0]!.evidence, ['Timed assessment: SYNTHETIC changing board observed.', 'Feedback assessment: SYNTHETIC visible pointer interaction permits a probe.']);
  assert.equal(await readFile(join(timedInspection!.outputDir, 'learning.json'), 'utf8'), 'SYNTHETIC timed assessment');
  assert.equal(await readFile(join(timedInspection!.outputDir, 'feedback', 'learning.json'), 'utf8'), 'SYNTHETIC feedback assessment');
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /Controller: screenshot feedback \(requested mode: auto\)/);
  assert.ok(JSON.parse(await readFile(join(directory, 'controls-feedback-fixture.json'), 'utf8')).profile);
  assert.equal(JSON.parse(await readFile(join(directory, 'controls-timed-fixture.json'), 'utf8')).profile, undefined);
  const resumed = await runPipeline({ ...options, stage: 'edit' }, config, services);
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.playMode, 'auto');
  assert.equal(resumed.captureSeconds, 80);
  assert.equal(calls.inspect, 1); assert.equal(calls.capture, 1);
  assert.equal(timedLearns, 1); assert.equal(feedbackLearns, 1);
});

test('auto mode keeps tested timed controls without unnecessary feedback inference', async t => {
  const { directory, config, services } = await fixture(t);
  services.learnGameProfile = async () => assert.fail('A tested preset needs no new timed inference.');
  services.learnFeedbackProfile = async () => assert.fail('A supported timed plan must not trigger feedback.');
  const run = await runPipeline({ directory, model: 'fixture-model', playMode: 'auto', stage: 'capture', quiet: true }, config, services);
  assert.equal(run.attempts[0]!.profile?.controller.type, 'timed');
  assert.equal(run.attempts[0]!.unsupported, false);
});

test('auto mode does not turn provider errors into feedback fallbacks or unsupported games', async t => {
  for (const editingStyle of ['episode', 'reel'] as const) for (const status of [401, 503, undefined]) {
    const { directory, config, services, calls, candidate } = await fixture(t);
    candidate.url = 'https://www.astrocade.com/games/fixture-game/fixture';
    let firstCalls = 0, fallbackCalls = 0;
    const first = async () => { firstCalls++; throw Object.assign(new Error('SYNTHETIC provider failure'), status ? { status } : {}); };
    const fallback = async () => { fallbackCalls++; assert.fail('Provider errors cannot establish unsupported controls.'); };
    services.learnGameProfile = editingStyle === 'episode' ? first : fallback;
    services.learnFeedbackProfile = editingStyle === 'reel' ? first : fallback;
    await assert.rejects(runPipeline({ directory, model: 'fixture-model', playMode: 'auto', contentBrief: { ...defaultContentBrief, editingStyle }, stage: 'capture', quiet: true }, config, services));
    const run = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
    assert.equal(run.attempts[0].unsupported, false);
    assert.equal(calls.capture, 0);
    assert.equal(firstCalls, 1); assert.equal(fallbackCalls, 0);
  }
});

test('auto mode records both unsupported modes without attempting gameplay', async t => {
  const { directory, config, services, calls, candidate } = await fixture(t);
  candidate.url = 'https://www.astrocade.com/games/fixture-game/fixture';
  services.learnGameProfile = async () => ({ evidence: ['SYNTHETIC timed inspection'], limitations: ['No repeatable timed plan.'] });
  services.learnFeedbackProfile = async () => ({ evidence: ['SYNTHETIC feedback inspection'], limitations: ['Observed hazards require reflexes.'] });
  await assert.rejects(runPipeline({ directory, model: 'fixture-model', playMode: 'auto', stage: 'capture', quiet: true }, config, services), /No candidate produced a recording/);
  const run = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  assert.equal(run.attempts[0].unsupported, true);
  assert.deepEqual(run.attempts[0].limitations, ['Feedback mode only: Observed hazards require reflexes.', 'Timed mode: No repeatable timed plan.']);
  assert.equal(calls.capture, 0);
});

test('an explicit timed duration replans instead of truncating a preset and cannot change on resume', async t => {
  const { directory, config, services, calls } = await fixture(t);
  let learns = 0;
  services.learnGameProfile = async (_inspection, _candidate, _provider, _signal, intent) => {
    learns++;
    assert.deepEqual(intent, { captureGoal: 'SYNTHETIC meaningful route choice.', rejectIf: 'SYNTHETIC route labels are unreadable.', maxDurationMs: 30000, editingStyle: 'reel' });
    return { profile: { ...verifiedProfiles[0]!, verification: 'unverified', maxDurationMs: intent.maxDurationMs! }, evidence: ['SYNTHETIC replanned inputs.'], limitations: [] };
  };
  const capture = services.runCaptureAttempt!;
  services.runCaptureAttempt = async options => {
    assert.equal(options.profile.maxDurationMs, 30000);
    assert.equal(options.profile.verification, 'unverified');
    return capture(options);
  };
  const options = { directory, model: 'fixture-model', playMode: 'timed' as const, stage: 'capture' as const, quiet: true };
  const run = await runPipeline({ ...options, captureSeconds: 30 }, config, services);
  assert.equal(run.captureSeconds, 30);
  assert.equal(learns, 1);
  const manifest = await readFile(join(directory, 'run.json'), 'utf8');
  await assert.rejects(runPipeline({ ...options, captureSeconds: 45 }, config, services), /saved capture budget cannot be changed/);
  assert.equal(await readFile(join(directory, 'run.json'), 'utf8'), manifest);
  await runPipeline(options, config, services);
  assert.equal(calls.capture, 1);
  assert.equal(learns, 1);
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /at most 30 seconds per attempt/);
});

test('invalid capture budgets fail before any provider or browser work', async t => {
  const { directory, config, services, calls } = await fixture(t);
  for (const captureSeconds of [0, 4, 600.1, 601, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(runPipeline({ directory, model: 'fixture-model', captureSeconds, quiet: true }, config, services), /integer from 5 to 600/);
  }
  assert.equal(calls.discover, 0);
  assert.equal(calls.inspect, 0);
});

test('a ten-minute exploration budget and action observations survive capture and resume', async t => {
  const { directory, config, services, calls } = await fixture(t);
  let learns = 0;
  services.learnFeedbackProfile = async (_inspection, _candidate, _provider, _signal, intent) => {
    learns++;
    assert.equal(intent?.maxDurationMs, 600000);
    return { profile: { ...verifiedProfiles[0]!, maxDurationMs: 600000, controller: {
      type: 'sparse', maxDecisions: 40, instructions: 'SYNTHETIC observed movement.', allowedKeys: ['KeyW', 'Space'], allowPointer: false,
    } }, evidence: ['SYNTHETIC movement and flight controls'], limitations: [] };
  };
  services.createFeedbackController = () => async () => ({ stop: true, reason: 'SYNTHETIC completed exploration', actions: [], observation: 'SYNTHETIC route complete', outcome: 'progress', lesson: 'SYNTHETIC controls worked' });
  const capture = services.runCaptureAttempt!;
  services.runCaptureAttempt = async options => {
    assert.equal(options.profile.maxDurationMs, 600000);
    assert.equal(options.observeActionFrames, true, 'reel learning receives evidence during active inputs');
    return capture(options);
  };
  const run = await runPipeline({ directory, model: 'fixture-model', playMode: 'feedback', captureSeconds: 600, stage: 'capture', quiet: true }, config, services);
  assert.equal(run.captureSeconds, 600);
  const resumed = await runPipeline({ directory, model: 'fixture-model', stage: 'edit', quiet: true }, config, services);
  assert.equal(resumed.captureSeconds, 600);
  assert.equal(resumed.attempts[0]!.profile!.maxDurationMs, 600000);
  assert.equal(calls.capture, 1);
  assert.equal(learns, 1);
});

test('source reuse passes bounded action observations as search hints without treating plans as evidence', async t => {
  const { directory, config, services, calls } = await fixture(t);
  await runPipeline({ directory, model: 'fixture-model', stage: 'capture', quiet: true }, config, services);
  const feedback = join(directory, 'saved-feedback');
  await mkdir(feedback);
  const record = { elapsedMs: 4000, sampledFrames: [{ elapsedMs: 2500 }, { elapsedMs: 3200 }],
    observation: 'SYNTHETIC brief projectile is visible.', lesson: 'UNVERIFIED stored lesson', mechanics: [{ nextGoal: 'INVENTED future goal' }] };
  await writeFile(join(feedback, 'decision-01.json'), JSON.stringify(record));
  await writeFile(join(feedback, 'decision-02.json'), JSON.stringify({ ...record, elapsedMs: 9000 }));
  await writeFile(join(feedback, 'decision-03.json'), JSON.stringify({ ...record, sampledFrames: [{ elapsedMs: 3200 }, { elapsedMs: 2500 }] }));
  await writeFile(join(feedback, 'decision-04.json'), JSON.stringify({ elapsedMs: 5000, observation: 'Legacy observation has no action-time range.' }));
  await writeFile(join(feedback, 'decision-05-proposal.json'), JSON.stringify({ ...record, observation: 'Rejected proposal must not become a hint.' }));
  await writeFile(join(feedback, 'decision-06.json'), JSON.stringify({ ...record, observation: '   ' }));
  await writeFile(join(feedback, 'decision-06.json'), 'invalid JSON');
  const manifestPath = join(directory, 'run.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.attempts[0].feedbackPath = join(feedback, 'report.md');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const original = await readFile(manifestPath, 'utf8');
  const analyze = services.analyzeFootage!;
  services.analyzeFootage = async (...args) => {
    assert.deepEqual(args[4], [{ startSeconds: 2.5, endSeconds: 4, observation: record.observation }]);
    return analyze(...args);
  };
  const destination = join(directory, 'new-edit');
  const result = await runPipeline({ directory: destination, fromRun: directory, stage: 'edit', model: 'fixture-model', quiet: true }, config, services);
  assert.equal(result.status, 'complete');
  assert.equal(calls.capture, 1);
  assert.equal(calls.analyze, 1);
  assert.equal(await readFile(manifestPath, 'utf8'), original, 'analysis never modifies source evidence');
  assert.match(await readFile(join(destination, 'trace.jsonl'), 'utf8'), /optional action observations were unavailable or invalid/);
});

test('an explicit Astrocade URL is inspected directly without inventing catalog metadata', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const game = verifiedProfiles[0]!.gameUrl;
  const run = await runPipeline({ directory, model: 'fixture-model', game, stage: 'capture', quiet: true }, config, services);
  assert.equal(calls.discover, 0);
  assert.equal(calls.inspect, 1);
  assert.equal(run.candidates[0]!.url, game);
  assert.equal(run.candidates[0]!.titleSource, 'url_slug');
  assert.deepEqual(run.candidates[0]!.observations, []);
});

test('an explicit exploration goal reaches learning and feedback and remains fixed on resume', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const captureGoal = 'SYNTHETIC open the selector, transform, use two abilities, then reach the next area.';
  const game = verifiedProfiles[0]!.gameUrl;
  let learned = 0;
  services.learnFeedbackProfile = async (_inspection, _game, _provider, _signal, intent) => {
    learned++;
    assert.equal(intent?.captureGoal, captureGoal);
    return { profile: { ...verifiedProfiles[0]!, controller: { type: 'sparse', maxDecisions: 4, instructions: 'SYNTHETIC visible controls', allowedKeys: [], allowPointer: true } }, evidence: ['SYNTHETIC'], limitations: [] };
  };
  services.createFeedbackController = (_profile, _provider, _directory, _callback, intent) => {
    assert.equal(intent?.captureGoal, captureGoal);
    return async () => ({ stop: true, reason: 'SYNTHETIC fixture only', actions: [], observation: 'SYNTHETIC', outcome: 'progress', lesson: '' });
  };
  const options = { directory, model: 'fixture-model', game, captureGoal, playMode: 'feedback' as const, stage: 'capture' as const, quiet: true };
  const run = await runPipeline(options, config, services);
  assert.equal(run.shortlist[0]!.captureGoal, captureGoal);
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /open the selector, transform/);
  await runPipeline(options, config, services);
  assert.equal(learned, 1);
  assert.equal(calls.capture, 1);
  await assert.rejects(runPipeline({ ...options, captureGoal: 'Change the saved goal' }, config, services), /saved capture goal cannot be changed/);
  assert.equal(JSON.parse(await readFile(join(directory, 'run.json'), 'utf8')).shortlist[0].captureGoal, captureGoal);
  await assert.rejects(runPipeline({ ...options, game: undefined }, config, services), /requires an explicit game/);
  await assert.rejects(runPipeline({ ...options, captureGoal: ' ' }, config, services));
  await assert.rejects(runPipeline({ ...options, captureGoal: 'x'.repeat(801) }, config, services));
});

test('a saved brief is reused by nomination and editing, and a changed resume brief preserves prior provenance', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const brief = { ...defaultContentBrief, audience: 'SYNTHETIC viewers who choose the route.' };
  const nominate = services.nominateGames!, draft = services.draftScript!;
  let nominations = 0;
  services.nominateGames = async (...args) => {
    nominations++;
    assert.deepEqual(args[6], brief);
    return nominate(...args);
  };
  services.draftScript = async (...args) => {
    assert.deepEqual(args[0].brief, brief);
    return draft(...args);
  };
  const options = { directory, model: 'fixture-model', quiet: true };
  const discovered = await runPipeline({ ...options, stage: 'discover', contentBrief: brief }, config, services);
  assert.deepEqual(discovered.contentBrief, brief);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'content-brief.json'), 'utf8')), brief);
  const completed = await runPipeline(options, config, services);
  assert.equal(completed.status, 'complete');
  assert.deepEqual(completed.contentBrief, brief);
  const manifest = await readFile(join(directory, 'run.json'), 'utf8');
  await assert.rejects(runPipeline({ ...options, contentBrief: { ...brief, voice: 'A different voice.' } }, config, services), /saved editorial brief cannot be changed/);
  assert.equal(await readFile(join(directory, 'run.json'), 'utf8'), manifest);
  const resumed = await runPipeline({ ...options, contentBrief: brief }, config, services);
  assert.equal(resumed.status, 'complete');
  assert.equal(nominations, 1);
  assert.equal(calls.analyze, 1);
  assert.equal(calls.draft, 1);
});

test('content gates reject beautiful unreadable footage and rank the remaining games by editorial evidence', async t => {
  const { directory, config, services, candidate } = await fixture(t);
  const discover = services.discoverGames!, analyze = services.analyzeFootage!;
  services.discoverGames = async (...args) => ({ ...await discover(...args), candidates: [candidate, { ...candidate, id: 'unreadable' }, { ...candidate, id: 'clear-choice' }] });
  services.nominateGames = async () => ['fixture', 'unreadable', 'clear-choice'].map(gameId => ({ gameId, hypothesis: 'Fixture', viewerQuestion: 'Fixture?', controlRisk: 'Fixture' }));
  services.analyzeFootage = async (...args) => {
    const analysis = await analyze(...args);
    if (args[0].game.id === 'unreadable') return { ...analysis, visualScore: 5, content: { ...content, participation: 3, distinctiveness: 3, readability: 0 } };
    if (args[0].game.id === 'clear-choice') return { ...analysis, visualScore: 1, content: { ...content, participation: 3, distinctiveness: 3 } };
    return analysis;
  };
  const run = await runPipeline({ directory, model: 'fixture-model', quiet: true }, config, services);
  assert.equal(run.selectedGameId, 'clear-choice');
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /rejected by clarity\/payoff\/readability gate/);
  const trace = (await readFile(join(directory, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const selection = trace.find(event => event.stage === 'select');
  assert.deepEqual(selection.data.map((entry: { score: number }) => entry.score), [30, 26]);
});

test('an unfinished legacy analysis is refreshed once, while a finished legacy video is reused without inference', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const options = { directory, model: 'fixture-model', quiet: true };
  await runPipeline({ ...options, stage: 'capture' }, config, services);
  const legacy = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  legacy.attempts[0].capture.analysis = { usable: true, reason: 'Legacy analysis', mechanic: 'Legacy', visualScore: 5, events: [{ startSeconds: 1, endSeconds: 7, event: 'Legacy', evidence: 'Legacy evidence', outcome: 'Legacy result' }] };
  delete legacy.contentBrief;
  await writeFile(join(directory, 'run.json'), JSON.stringify(legacy));
  const edited = await runPipeline({ ...options, stage: 'edit' }, config, services);
  assert.deepEqual(edited.contentBrief, { ...defaultContentBrief, editingStyle: 'episode' });
  assert.equal(calls.analyze, 1);
  assert.equal(calls.capture, 1);
  const completedLegacy = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  delete completedLegacy.attempts[0].capture.analysis.content;
  delete completedLegacy.contentBrief;
  await writeFile(join(directory, 'run.json'), JSON.stringify(completedLegacy));
  await runPipeline(options, config, services);
  assert.equal(calls.analyze, 1);
  assert.equal(calls.draft, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.validate, 1);
});

test('new unassessed footage cannot bypass the content gates', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const analyze = services.analyzeFootage!;
  services.analyzeFootage = async (...args) => {
    const { content: _missing, ...legacy } = await analyze(...args);
    return legacy;
  };
  await assert.rejects(runPipeline({ directory, model: 'fixture-model', quiet: true }, config, services), /No recording contains a supported short-form moment/);
  assert.equal(calls.draft, 0);
  assert.equal(calls.render, 0);
});

test('new reel runs pass exploration intent and the fifteen-second ceiling through every stage', async t => {
  const { directory, config, services, candidate } = await fixture(t);
  const inspect = services.inspectGame!, analyze = services.analyzeFootage!, draft = services.draftScript!;
  services.inspectGame = async (...args) => inspect(...args);
  let feedbackFirst = false;
  services.learnFeedbackProfile = async () => {
    feedbackFirst = true;
    return { evidence: ['SYNTHETIC time-sensitive game'], limitations: ['Slow observations cannot support these hazards.'] };
  };
  services.learnGameProfile = async (_inspection, _candidate, _provider, _signal, intent) => {
    assert.equal(feedbackFirst, true);
    assert.equal(intent?.editingStyle, 'reel');
    assert.ok(intent?.captureGoal?.length, 'the explicit-game exploration goal reaches the timed fallback');
    return { profile: { ...verifiedProfiles[0]!, maxDurationMs: 60000 }, evidence: ['SYNTHETIC bounded exploration'], limitations: [] };
  };
  services.analyzeFootage = async (...args) => {
    assert.equal(args[3]?.editingStyle, 'reel');
    return analyze(...args);
  };
  services.draftScript = async (...args) => {
    assert.equal(args[0].brief?.editingStyle, 'reel');
    assert.equal(args[0].maxDurationSeconds, 15);
    return draft(...args);
  };
  const run = await runPipeline({ directory, model: 'fixture-model', game: candidate.url, captureSeconds: 60, quiet: true }, config, services);
  assert.equal(run.playMode, 'auto');
  assert.equal(run.attempts[0]!.analysisEditingStyle, 'reel');
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /gameplay reel · up to 15 seconds/);
});

test('changing an episode to a reel rescans saved footage once without changing or recapturing its source', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const legacyBrief = { ...defaultContentBrief, editingStyle: 'episode' as const };
  const original = await runPipeline({ directory, model: 'fixture-model', contentBrief: legacyBrief, quiet: true }, config, services);
  // Emulate evidence written before analysis style was recorded.
  const legacy = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  delete legacy.attempts[0].analysisEditingStyle;
  await writeFile(join(directory, 'run.json'), JSON.stringify(legacy));
  const originalManifest = await readFile(join(directory, 'run.json'), 'utf8');
  const reelDirectory = join(directory, 'reel');
  const options = { directory: reelDirectory, fromRun: directory, model: 'fixture-model', contentBrief: defaultContentBrief, quiet: true };
  const reel = await runPipeline(options, config, services);
  assert.equal(calls.analyze, 2, 'the old single-episode selection cannot stand in for a reel scan');
  assert.equal(calls.capture, 1);
  assert.equal(reel.attempts[0]!.capture!.path, original.attempts[0]!.capture!.path);
  assert.equal(reel.attempts[0]!.analysisEditingStyle, 'reel');
  assert.equal(await readFile(join(directory, 'run.json'), 'utf8'), originalManifest);
  await runPipeline({ directory: reelDirectory, model: 'fixture-model', quiet: true }, config, services);
  assert.equal(calls.analyze, 2, 'resuming the finished reel reuses its checked output');
  const failedDirectory = join(directory, 'failed-reel');
  services.analyzeFootage = async () => { throw new NeedsAttention('SYNTHETIC no varied playable moments'); };
  const beforeDraft = calls.draft;
  await assert.rejects(runPipeline({ ...options, directory: failedDirectory }, config, services), /No recording contains/);
  assert.equal(calls.draft, beforeDraft, 'failed reel analysis must not silently use stale episode evidence');
});

test('scheduled overlays reach the renderer and the report retains editorial alternatives and duration reasoning', async t => {
  const { directory, config, services } = await fixture(t);
  const draft = services.draftScript!, render = services.renderPortrait!;
  const overlays = [{ startSeconds: 0, endSeconds: 2.5, text: 'Which route would you pick?', position: 'upper' as const }];
  services.draftScript = async (...args) => ({
    ...await draft(...args), overlays,
    editorial: {
      alternatives: ['Which route?', 'That looked safe', 'Watch the gate'].map(hook => ({ angle: 'prediction' as const, hook, caption: 'SYNTHETIC caption', evidence: 'SYNTHETIC route decision.', tradeoff: 'SYNTHETIC tradeoff between choice and surprise.' })),
      selectedIndex: 0, durationReason: 'SYNTHETIC six seconds preserve approach and result.', review: 'SYNTHETIC labels remain readable.',
    },
  });
  services.renderPortrait = async options => {
    assert.deepEqual(options.overlays, overlays);
    return render(options);
  };
  const run = await runPipeline({ directory, model: 'fixture-model', quiet: true }, config, services);
  assert.deepEqual(run.script!.overlays, overlays);
  const report = await readFile(join(directory, 'report.md'), 'utf8');
  assert.match(report, /Capture goal: SYNTHETIC meaningful route choice/);
  assert.match(report, /Reject if: SYNTHETIC route labels/);
  assert.match(report, /\*\*Selected:\*\* Which route/);
  assert.match(report, /SYNTHETIC six seconds preserve approach and result/);
  assert.match(report, /SYNTHETIC labels remain readable/);
  assert.match(report, /SYNTHETIC tradeoff between choice and surprise/);
});

test('a new edit reuses captured evidence without discovery, capture or analysis and leaves its source unchanged', async t => {
  const { directory, config, services, calls, candidate } = await fixture(t);
  const sourceBrief = { ...defaultContentBrief, audience: 'SYNTHETIC source audience.' };
  const options = { directory, model: 'fixture-model', provider: 'codex' as const, quiet: true };
  const source = await runPipeline({ ...options, contentBrief: sourceBrief }, config, services);
  // Preserve failed probes too; an edit-only variation must not retry them.
  const manifest = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  manifest.candidates.push({ ...candidate, id: 'failed-probe' });
  manifest.shortlist.push({ gameId: 'failed-probe', hypothesis: 'Fixture', viewerQuestion: 'Fixture?', controlRisk: 'Fixture' });
  manifest.attempts.push({ gameId: 'failed-probe', unsupported: false, evidence: [], limitations: [], error: 'SYNTHETIC failed capture.' });
  await writeFile(join(directory, 'run.json'), JSON.stringify(manifest));
  const original = await readFile(join(directory, 'run.json'), 'utf8');
  const originalTrace = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  const variation = await runPipeline({ ...options, directory: join(directory, 'variation'), fromRun: directory }, config, services);
  assert.equal(variation.status, 'complete');
  assert.notEqual(variation.id, source.id);
  assert.notEqual(variation.createdAt, source.createdAt);
  assert.notEqual(variation.videoPath, source.videoPath);
  assert.deepEqual(variation.contentBrief, sourceBrief);
  assert.deepEqual(variation.attempts[0], source.attempts[0]);
  assert.equal(variation.attempts[1]!.error, 'SYNTHETIC failed capture.');
  assert.equal(variation.provenance!.sourceRunId, source.id);
  assert.equal(variation.provenance!.sourceRunPath, directory);
  assert.equal(variation.provenance!.discoveryPath, join(directory, 'discovery.json'));
  assert.deepEqual(calls, { discover: 1, inspect: 1, capture: 1, analyze: 1, draft: 2, render: 2, validate: 0 });
  assert.equal(await readFile(join(directory, 'run.json'), 'utf8'), original);
  assert.equal(await readFile(join(directory, 'trace.jsonl'), 'utf8'), originalTrace);
  assert.match(await readFile(join(directory, 'variation', 'report.md'), 'utf8'), /Re-edit of/);
  const newBrief = { ...sourceBrief, voice: 'SYNTHETIC different editorial voice.' };
  const alternative = await runPipeline({ ...options, directory: join(directory, 'alternative'), fromRun: directory, contentBrief: newBrief }, config, services);
  assert.deepEqual(alternative.contentBrief, newBrief);
  assert.equal(calls.analyze, 1);
  assert.equal(calls.capture, 1);
  assert.equal(await readFile(join(directory, 'run.json'), 'utf8'), original);
});

test('re-edit refuses replaced source footage or an existing destination before making another edit', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const options = { directory, model: 'fixture-model', quiet: true };
  const source = await runPipeline(options, config, services);
  const originalTrace = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  await assert.rejects(runPipeline({ ...options, fromRun: directory }, config, services), /new output directory/);
  assert.equal(await readFile(join(directory, 'trace.jsonl'), 'utf8'), originalTrace);
  await assert.rejects(runPipeline({ ...options, fromRun: directory, directory: join(directory, 'wrong-stage'), stage: 'capture' }, config, services), /only supports the analyze or edit stage/);
  const variation = join(directory, 'variation');
  await runPipeline({ ...options, directory: variation, fromRun: directory }, config, services);
  const savedVariation = await readFile(join(variation, 'run.json'), 'utf8');
  await assert.rejects(runPipeline({ ...options, directory: variation, fromRun: directory }, config, services), /cannot replace an existing run/);
  assert.equal(await readFile(join(variation, 'run.json'), 'utf8'), savedVariation);
  await writeFile(source.attempts[0]!.capture!.path, 'SYNTHETIC replacement bytes');
  await assert.rejects(runPipeline({ ...options, fromRun: directory, directory: join(directory, 'changed-source') }, config, services), /Saved source changed/);
  assert.equal(calls.draft, 2);
});

test('re-edit requires saved recordings and CLI rejects contradictory run modes before setup', async t => {
  const { directory, config, services } = await fixture(t);
  await runPipeline({ directory, model: 'fixture-model', stage: 'discover', quiet: true }, config, services);
  await assert.rejects(runPipeline({ directory: join(directory, 'variation'), fromRun: directory, model: 'fixture-model', quiet: true }, config, services), /at least one saved recording/);
  await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/core/cli.ts', '--resume', 'unused', '--from-run', 'unused']), error => {
    assert.match((error as { stderr: string }).stderr, /mutually exclusive/);
    return true;
  });
  await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/core/cli.ts', '--stage', 'analyze']), error => {
    assert.match((error as { stderr: string }).stderr, /requires --resume or --from-run with saved recordings/);
    return true;
  });
  const help = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/core/cli.ts', '--help']);
  assert.match(help.stdout, /--from-run data\/runs\/RUN_DIRECTORY --stage analyze/);
});

test('presenter video duration bounds new edits and the hashed asset cannot change on resume', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const presenterPath = join(directory, '..', 'presenter.mp4');
  const otherPresenter = join(directory, '..', 'other-presenter.mp4');
  await writeFile(presenterPath, 'SYNTHETIC generated presenter, not actual video');
  await writeFile(otherPresenter, 'SYNTHETIC alternate generated presenter');
  let probes = 0;
  services.presenterVideoDuration = async path => { probes++; assert.equal(path, presenterPath); return 5; };
  const draft = services.draftScript!, render = services.renderPortrait!;
  services.draftScript = async (...args) => {
    assert.equal(args[0].maxDurationSeconds, 5);
    assert.equal(args[0].presenter, true);
    return { ...await draft(...args), cuts: [{ startSeconds: 1, endSeconds: 6 }] };
  };
  services.renderPortrait = async options => {
    assert.deepEqual(options.presenter, { path: presenterPath });
    return render(options);
  };
  const options = { directory, model: 'fixture-model', quiet: true };
  const run = await runPipeline({ ...options, presenterPath }, config, services);
  assert.equal(probes, 1);
  assert.equal(run.presenterPath, presenterPath);
  assert.match(run.presenterSha256!, /^[a-f0-9]{64}$/);
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /Fictional AI commentator/);
  const original = await readFile(join(directory, 'run.json'), 'utf8');
  await assert.rejects(runPipeline({ ...options, presenterPath: otherPresenter }, config, services), /saved presenter cannot be changed/);
  assert.equal(await readFile(join(directory, 'run.json'), 'utf8'), original);
  await runPipeline(options, config, services);
  assert.equal(probes, 1, 'completed edits reuse their script and video without probing or drafting again');
  assert.equal(calls.render, 1);
  assert.equal(calls.validate, 1);
  await writeFile(presenterPath, 'SYNTHETIC changed presenter');
  await assert.rejects(runPipeline(options, config, services), /saved presenter asset changed/);
  assert.equal(calls.render, 1);
  assert.equal(calls.validate, 1);
});

test('a longer presenter retains the edit ceiling and saved scripts resume without redrafting', async t => {
  const { directory, config, services, calls } = await fixture(t);
  const presenterPath = join(directory, '..', 'presenter.mp4');
  await writeFile(presenterPath, 'SYNTHETIC long presenter, not actual video');
  let probes = 0;
  services.presenterVideoDuration = async () => { probes++; return 55; };
  const draft = services.draftScript!, render = services.renderPortrait!;
  services.draftScript = async (...args) => {
    assert.equal(args[0].maxDurationSeconds, 15);
    return draft(...args);
  };
  services.renderPortrait = async () => { throw new Error('SYNTHETIC render interruption'); };
  const options = { directory, model: 'fixture-model', quiet: true, presenterPath };
  await assert.rejects(runPipeline(options, config, services), /render interruption/);
  services.renderPortrait = render;
  const completed = await runPipeline(options, config, services);
  assert.equal(completed.status, 'complete');
  assert.equal(probes, 1);
  assert.equal(calls.draft, 1);
  assert.equal(calls.render, 1);
});
