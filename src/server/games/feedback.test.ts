import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Inference } from '../providers/inference.js';
import { createFeedbackController, learnFeedbackProfile, validateFeedbackDecision } from './feedback.js';
import { gameProfileSchema } from './schema.js';
import type { GameplayObservation } from './runner.js';
import type { GameInspection } from './learning.js';

const profile = gameProfileSchema.parse({ id: 'fixture', name: 'Fixture puzzle', gameUrl: 'https://www.astrocade.com/games/fixture/fixture',
  viewport: { width: 720, height: 1280 }, surface: { selector: 'canvas' }, ready: { selector: 'canvas' }, objective: 'Fill a board.',
  controller: { type: 'sparse', instructions: 'Drag shapes to matching slots.', allowPointer: true },
});
const move = { type: 'drag' as const, from: { x: 0.2, y: 0.8 }, to: { x: 0.6, y: 0.3 }, durationMs: 600 };
const answer = { observation: 'One shape remains.', outcome: 'progress' as const, lesson: 'Previous placement worked.', stop: false, reason: 'Place the remaining shape.', actions: [move] };
const observation: GameplayObservation = { observationId: 'fixture:0', gameName: 'Fixture puzzle', objective: profile.objective,
  image: Buffer.from('CURRENT_SYNTHETIC_IMAGE'), mimeType: 'image/jpeg', text: 'one remaining', pointerLocked: false, elapsedMs: 2000, remainingMs: 100000,
  previousActions: [], isFinal: false, signal: new AbortController().signal,
};

test('feedback rejects unknown controls, invalid batches and contradictory terminal results', () => {
  for (const invalid of [
    { ...answer, actions: [{ type: 'key', key: 'KeyW', durationMs: 100 }] },
    { ...answer, actions: [{ type: 'tap', point: { x: 2, y: 0.5 } }] },
    { ...answer, actions: Array.from({ length: 6 }, () => ({ ...move, durationMs: 2000 })) },
    { ...answer, stop: true }, { ...answer, outcome: 'success' }, { ...answer, actions: [] },
    { ...answer, actions: [{ ...move, selector: '#hidden' }] },
  ]) assert.throws(() => validateFeedbackDecision(invalid, profile));
  assert.deepEqual(validateFeedbackDecision(answer, profile), answer);
});

test('continuous paths require observed pointer controls and share the action-batch time budget', () => {
  const path = { type: 'path' as const, points: [{ x: 0.4, y: 0.5 }, { x: 0.5, y: 0.6 }, { x: 0.6, y: 0.5 }, { x: 0.4, y: 0.5 }], durationMs: 2000 };
  assert.deepEqual(validateFeedbackDecision({ ...answer, actions: [path] }, profile).actions, [path]);
  const keyboardOnly = gameProfileSchema.parse({ ...profile, controller: { type: 'sparse', allowedKeys: ['Space'], allowPointer: false } });
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [path] }, keyboardOnly), /control not established/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: Array.from({ length: 6 }, () => path) }, profile), /exceeds 10 seconds/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...path, keepHeld: true }] }, profile), /unrecognized_keys/);
});

test('right-button actions preserve pointer permission and reject unsupported buttons', () => {
  const keyboardOnly = gameProfileSchema.parse({ ...profile, controller: { type: 'sparse', allowedKeys: ['Space'], allowPointer: false } });
  for (const action of [
    { type: 'tap' as const, point: { x: 0.5, y: 0.5 }, button: 'right' as const },
    { ...move, button: 'right' as const },
    { type: 'path' as const, points: [move.from, move.to], durationMs: 500, button: 'right' as const },
  ]) {
    assert.deepEqual(validateFeedbackDecision({ ...answer, actions: [action] }, profile).actions, [action]);
    assert.throws(() => validateFeedbackDecision({ ...answer, actions: [action] }, keyboardOnly), /control not established/);
    assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...action, button: 'middle' }] }, profile));
    assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...action, button: ['left', 'right'] }] }, profile));
  }
});

test('feedback compares fresh images, retains lessons and saves its actual evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = { json: async (prompt: string, _schema: unknown, media: Array<{ data: string }>) => {
    calls++;
    if (calls === 1) { assert.equal(media.length, 1); assert.match(prompt, /initial CURRENT/); return answer; }
    assert.equal(media.length, 2);
    assert.equal(Buffer.from(media[0]!.data, 'base64').toString(), 'PREVIOUS_SYNTHETIC_IMAGE');
    assert.equal(Buffer.from(media[1]!.data, 'base64').toString(), 'CURRENT_SYNTHETIC_IMAGE');
    assert.match(prompt, /Previous placement worked/);
    assert.match(prompt, /FINAL evaluation/);
    return { ...answer, observation: 'The board shows COMPLETE.', outcome: 'success', stop: true, actions: [] };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory);
  await decide(observation);
  const result = await decide({ ...observation, observationId: 'fixture:1', previousActions: [move], previousImage: Buffer.from('PREVIOUS_SYNTHETIC_IMAGE'), isFinal: true });
  assert.equal(result.outcome, 'success');
  assert.deepEqual(result.actions, []);
  const saved = JSON.parse(await readFile(join(directory, 'decision-02.json'), 'utf8'));
  assert.equal(saved.observationId, 'fixture:1');
  assert.deepEqual(saved.previousActions, [move]);
  assert.equal(await readFile(join(directory, 'decision-02.jpg'), 'utf8'), 'CURRENT_SYNTHETIC_IMAGE');
});

test('three consecutive no-progress observations stop instead of repeating indefinitely', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-stalled-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const provider = { json: async () => ({ ...answer, outcome: 'no_progress' }) } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory);
  assert.equal((await decide(observation)).stop, false, 'initial view has no failed input');
  const afterMove = { ...observation, previousActions: [move] };
  assert.equal((await decide(afterMove)).stop, false);
  assert.equal((await decide(afterMove)).stop, false);
  const result = await decide(afterMove);
  assert.equal(result.stop, true);
  assert.deepEqual(result.actions, []);
});

test('reel exploration remembers earlier mechanics beyond the recent four decisions without weakening action guards', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-exploration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = { json: async (prompt: string) => {
    calls++;
    assert.match(prompt, /One ordinary success is a milestone: report outcome=progress and continue/);
    assert.match(prompt, /Stop on death or terminal game completion/);
    if (calls === 6) {
      assert.match(prompt, /Earlier exploration ledger[^\n]*"atSeconds":2[^\n]*SYNTHETIC initial ice form/);
      assert.match(prompt, /Earlier exploration ledger[^\n]*SYNTHETIC ice control established/);
    }
    return { ...answer, observation: calls === 1 ? 'SYNTHETIC initial ice form is visible.' : `SYNTHETIC distinct later state ${calls}.`, lesson: calls === 1 ? 'SYNTHETIC ice control established.' : 'Compare the next observed effect.' };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, undefined, { editingStyle: 'reel' });
  for (let i = 0; i < 6; i++) {
    const result = await decide({ ...observation, observationId: `fixture:${i}`, elapsedMs: 2000 + i * 5000, previousActions: i ? [move] : [] });
    assert.equal(result.stop, false, 'a subgoal can remain progress while exploration continues');
    assert.deepEqual(result.actions, [move]);
  }
  assert.throws(() => validateFeedbackDecision({ ...answer, outcome: 'success' }, profile), /terminal outcome must stop/, 'reel guidance does not bypass terminal/action consistency');
  const legacy = createFeedbackController(profile, { json: async (prompt: string) => {
    assert.doesNotMatch(prompt, /REEL EXPLORATION|Earlier exploration ledger/);
    assert.match(prompt, /Stop on death or completion/);
    return { ...answer, outcome: 'success', stop: true, actions: [] };
  } } as unknown as Pick<Inference, 'json'>, join(directory, 'legacy'));
  assert.equal((await legacy(observation)).stop, true, 'saved episode runs keep their existing completion policy');
});

test('selection goals reach current-state feedback but are not treated as observed success', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-intent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const intent = { captureGoal: 'SYNTHETIC reveal the hidden picture.', rejectIf: 'SYNTHETIC the picture stays unreadable.' };
  const provider = { json: async (prompt: string) => {
    assert.match(prompt, /SYNTHETIC reveal the hidden picture/);
    assert.match(prompt, /SYNTHETIC the picture stays unreadable/);
    assert.match(prompt, /Uncertainty or an unmet goal alone does not prove rejection/);
    assert.match(prompt, /success requires an explicit completed board\/result/);
    return { ...answer, observation: 'The image remains covered and no outcome is visible.', outcome: 'uncertain', stop: true, actions: [] };
  } } as unknown as Pick<Inference, 'json'>;
  const result = await createFeedbackController(profile, provider, directory, undefined, intent)(observation);
  assert.equal(result.outcome, 'uncertain');
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /Provisional capture goal: SYNTHETIC reveal the hidden picture/);
});

test('feedback setup skips reflex games and never treats learned mechanics as verified play', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const imagePath = join(directory, 'fixture.png');
  await writeFile(imagePath, 'SYNTHETIC image');
  const inspection: GameInspection = { gameUrl: profile.gameUrl, observedAt: 'fixture', outputDir: directory, imagePath, beforeImagePath: imagePath,
    text: 'Drag to sort', surface: profile.surface, ready: profile.ready, startTargets: [], viewport: profile.viewport, setup: [] };
  const candidate = { id: 'fixture', url: profile.gameUrl, title: profile.name, titleSource: 'visible_text' as const, metrics: [], observations: [] };
  const response = { supported: true, confidence: 'high', latencyTolerant: false, objective: 'Fill one board', instructions: 'Drag visible shapes',
    allowedKeys: [], allowPointer: true, start: [], evidence: ['Visible drag instructions'], limitations: [] };
  const provider = { json: async () => response } as unknown as Pick<Inference, 'json'>;
  assert.equal((await learnFeedbackProfile(inspection, candidate, provider)).profile, undefined);
  await rm(join(directory, 'learning.json'));
  await rm(join(directory, 'feedback-assessment.json'));
  response.latencyTolerant = true;
  response.confidence = 'medium'; // A visible but untested affordance permits one reversible probe.
  const learned = await learnFeedbackProfile(inspection, candidate, provider);
  assert.equal(learned.profile?.verification, 'unverified');
  assert.equal(learned.profile?.focus, 'focus');
  assert.equal(learned.profile?.controller.type, 'sparse');
  if (learned.profile?.controller.type === 'sparse') assert.equal(learned.profile.controller.maxDecisions, 16);
  assert.equal(learned.profile?.maxDurationMs, 175000);
  await rm(join(directory, 'learning.json'));
  await rm(join(directory, 'feedback-assessment.json'));
  const shorter = await learnFeedbackProfile(inspection, candidate, provider, undefined, { captureGoal: 'Fill one visible corner.', maxDurationMs: 60000 });
  assert.equal(shorter.profile?.maxDurationMs, 60000);
  if (shorter.profile?.controller.type === 'sparse') assert.equal(shorter.profile.controller.maxDecisions, 16, 'the call ceiling may increase without extending the requested wall-time cap');
});

test('reel setup scopes latency tolerance to observed safe exploration without expanding its budget', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-exploration-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const imagePath = join(directory, 'fixture.png');
  await writeFile(imagePath, 'SYNTHETIC quiet free-roam screenshot');
  const inspection: GameInspection = { gameUrl: profile.gameUrl, observedAt: 'fixture', outputDir: directory, imagePath, beforeImagePath: imagePath,
    text: 'F opens a transformation dial. WASD moves in the empty plaza.', readyToPlay: true, surface: profile.surface, ready: profile.ready, startTargets: [], viewport: profile.viewport, setup: [] };
  const provider = { json: async (prompt: string) => {
    assert.match(prompt, /Judge the CURRENT scene and proposed exploration/);
    assert.match(prompt, /quiet free-roam area or input-paced transformation menu can qualify/);
    assert.match(prompt, /when danger demands fast reactions, stop and report the limit/);
    assert.match(prompt, /3–6 useful moments/);
    return { supported: true, confidence: 'medium', latencyTolerant: true, objective: 'Compare visible forms and their effects in the safe plaza.', instructions: inspection.text,
      allowedKeys: ['KeyF', 'KeyW', 'KeyA', 'KeyS', 'KeyD'], allowPointer: true, allowLook: false,
      evidence: ['SYNTHETIC visible controls and empty plaza permit a bounded probe.'], limitations: ['Combat is not established as latency-tolerant.'] };
  } } as unknown as Pick<Inference, 'json'>;
  const learned = await learnFeedbackProfile(inspection, { id: 'fixture', url: profile.gameUrl, title: profile.name, titleSource: 'visible_text', metrics: [], observations: [] }, provider, undefined, { editingStyle: 'reel', maxDurationMs: 90000 });
  assert.equal(learned.profile?.maxDurationMs, 90000);
  assert.equal(learned.profile?.verification, 'unverified');
  if (learned.profile?.controller.type === 'sparse') assert.equal(learned.profile.controller.maxDecisions, 16);
  else assert.fail('Expected a bounded sparse hypothesis.');
  assert.deepEqual(learned.limitations, ['Combat is not established as latency-tolerant.']);
});

test('an invalid stop proposal is saved before validation and returns no additional actions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-invalid-stop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalid = { ...answer, observation: 'A single mark is visible.', outcome: 'success', stop: true,
    reason: 'Hold the completed screen.', actions: [{ type: 'wait', durationMs: 1000 }] };
  let calls = 0, accepted = 0;
  const provider = { json: async (prompt: string) => {
    assert.match(prompt, /For EVERY decision, stop=true requires actions=\[\]/);
    assert.match(prompt, /success and failure are terminal outcomes/);
    return calls++ ? invalid : answer;
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, () => { accepted++; });
  const dispatched: unknown[] = [];
  const consume = async (current: GameplayObservation) => { dispatched.push(...(await decide(current)).actions); };
  await consume(observation);
  await assert.rejects(consume({ ...observation, observationId: 'fixture:1', previousActions: [move] }), /A stop decision cannot contain actions/);
  assert.deepEqual(dispatched, [move], 'the invalid final wait never reaches the action consumer');
  assert.equal(accepted, 1, 'only the valid decision is emitted as accepted');
  const saved = JSON.parse(await readFile(join(directory, 'decision-02-proposal.json'), 'utf8'));
  assert.equal(saved.observationId, 'fixture:1');
  assert.deepEqual(saved.previousActions, [move]);
  assert.deepEqual(saved.proposal, invalid);
  assert.equal(await readFile(saved.imagePath, 'utf8'), 'CURRENT_SYNTHETIC_IMAGE');
  await assert.rejects(readFile(join(directory, 'decision-02.json')), { code: 'ENOENT' });
});

test('an initial reading wait does not bypass the single gameplay-control probe', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-reading-wait-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = { json: async (prompt: string, schema: { safeParse: (value: unknown) => { success: boolean } }) => {
    calls++;
    if (calls === 1) return { ...answer, reason: 'Allow time to read the initial choices.', actions: [{ type: 'wait', durationMs: 5000 }] };
    assert.match(prompt, /first gameplay input is still an unverified control probe/);
    assert.equal(schema.safeParse({ ...answer, actions: [{ ...move, button: 'left' }, { type: 'wait', durationMs: 400 }] }).success, false);
    return answer;
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory);
  await decide(observation);
  const result = await decide({ ...observation, observationId: 'fixture:1', previousActions: [{ type: 'wait', durationMs: 5000 }], previousImage: observation.image });
  assert.deepEqual(result.actions, [move]);
});

test('relative look requires observed pointer/look permissions and current browser lock', () => {
  const look = { type: 'look' as const, dx: 30, dy: -20, durationMs: 200 };
  const configured = (allowPointer: boolean, allowLook?: boolean) => gameProfileSchema.parse({ ...profile,
    controller: { type: 'sparse', allowPointer, ...(allowLook === undefined ? {} : { allowLook }), instructions: 'Mouse Look controls the camera.' } });
  for (const [pointer, lookAllowed, locked] of [[true, undefined, true], [true, false, true], [false, true, true], [true, true, false]] as const) {
    assert.throws(() => validateFeedbackDecision({ ...answer, actions: [look] }, configured(pointer, lookAllowed), locked), /observed Mouse Look.*active browser pointer lock/);
  }
  assert.deepEqual(validateFeedbackDecision({ ...answer, actions: [look] }, configured(true, true), true).actions, [look]);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: Array.from({ length: 6 }, () => ({ ...look, durationMs: 2000 })) }, configured(true, true), true), /exceeds 10 seconds/);
});

for (const pointerLocked of [false, true]) test(`feedback observes browser lock=${pointerLocked} before permitting relative look`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-look-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lookProfile = gameProfileSchema.parse({ ...profile, controller: { type: 'sparse', allowPointer: true, allowLook: true,
    instructions: 'Mouse Look controls the camera; click the labeled panel to engage.' } });
  const look = { type: 'look' as const, dx: 0, dy: 30, durationMs: 300 };
  const provider = { json: async (prompt: string) => {
    assert.match(prompt, new RegExp('Browser pointer lock NOW: ' + pointerLocked));
    assert.match(prompt, /"type":"look","dx":0,"dy":30,"durationMs":300/);
    assert.match(prompt, /relative mouse offsets, not normalized coordinates or known camera angles/);
    return { ...answer, actions: [look] };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(lookProfile, provider, directory);
  if (pointerLocked) assert.deepEqual((await decide({ ...observation, pointerLocked })).actions, [look]);
  else await assert.rejects(decide({ ...observation, pointerLocked }), /active browser pointer lock/);
  const saved = JSON.parse(await readFile(join(directory, 'decision-01-proposal.json'), 'utf8'));
  assert.equal(saved.pointerLocked, pointerLocked);
});

test('feedback can establish visible Mouse Look before a fresh browser engages pointer lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-look-learning-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const imagePath = join(directory, 'fixture.png');
  await writeFile(imagePath, 'SYNTHETIC instructions image');
  const inspection: GameInspection = { gameUrl: profile.gameUrl, observedAt: 'fixture', outputDir: directory, imagePath, beforeImagePath: imagePath,
    text: 'Mouse Look. Click the labeled panel to engage. Left click removes a block; right click places one.', pointerLocked: false,
    readyToPlay: true, surface: profile.surface, ready: profile.ready, startTargets: [], viewport: profile.viewport, setup: [] };
  const provider = { json: async (prompt: string) => {
    assert.match(prompt, /Browser pointer lock at inspection: false/);
    assert.match(prompt, /Set allowLook=true only when visible instructions establish relative Mouse Look/);
    return { supported: true, confidence: 'medium', latencyTolerant: true, objective: 'Place a short row of blocks.',
      instructions: inspection.text, allowedKeys: [], allowPointer: true, allowLook: true,
      evidence: ['The visible controls explicitly say Mouse Look and describe the engagement click.'], limitations: ['Camera sensitivity needs a small live probe.'] };
  } } as unknown as Pick<Inference, 'json'>;
  const learned = await learnFeedbackProfile(inspection, { id: 'fixture', url: profile.gameUrl, title: profile.name, titleSource: 'visible_text', metrics: [], observations: [] }, provider);
  assert.equal(learned.profile?.verification, 'unverified');
  if (learned.profile?.controller.type === 'sparse') assert.equal(learned.profile.controller.allowLook, true);
  else assert.fail('Expected a sparse profile with a visible Mouse Look hypothesis.');
});
