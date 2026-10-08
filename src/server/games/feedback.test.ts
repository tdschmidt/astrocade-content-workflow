import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import type { Inference } from '../providers/inference.js';
import { createFeedbackController, learnFeedbackProfile, validateFeedbackDecision } from './feedback.js';
import { controlDecisionSchema, gameProfileSchema, type InputAction } from './schema.js';
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

test('reel tap combos fit the action cap without expanding the ten-second budget', () => {
  const tap = { type: 'tap' as const, point: { x: 0.5, y: 0.5 }, button: 'left' as const };
  const combo: InputAction[] = Array.from({ length: 16 }, () => [tap, { type: 'wait' as const, durationMs: 400 }]).flat();
  const decision = validateFeedbackDecision({ ...answer, actions: combo }, profile, false, 32);
  assert.equal(decision.actions.filter(action => action.type === 'tap').length, 16);
  assert.deepEqual(controlDecisionSchema.parse(decision).actions, combo, 'runner transport must accept the validated reel batch');
  const exactBudget: InputAction[] = [...combo.slice(0, -1), { type: 'wait', durationMs: 2400 }];
  assert.deepEqual(validateFeedbackDecision({ ...answer, actions: exactBudget }, profile, false, 32).actions, exactBudget);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [...combo.slice(0, -1), { type: 'wait', durationMs: 2401 }] }, profile, false, 32), /exceeds 10 seconds/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [...combo, tap] }, profile, false, 32));
  assert.equal(controlDecisionSchema.safeParse({ ...decision, actions: [...combo, tap] }).success, false);
  assert.deepEqual(validateFeedbackDecision({ ...answer, actions: combo.slice(0, 8) }, profile).actions, combo.slice(0, 8));
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: combo.slice(0, 9) }, profile), 'legacy validation defaults to eight actions');
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [tap, tap] }, profile, false, 1), 'the first probe is one action');
});

test('only reel feedback expands an observed gameplay loop beyond eight actions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-tap-combo-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tap = { type: 'tap' as const, point: { x: 0.5, y: 0.5 }, button: 'left' as const };
  const combo: InputAction[] = Array.from({ length: 16 }, () => [tap, { type: 'wait' as const, durationMs: 400 }]).flat();
  for (const editingStyle of ['episode', 'reel'] as const) {
    let calls = 0;
    const proposal = { ...answer, ...(editingStyle === 'reel' ? { pivotTo: null, mechanics: [] } : {}), actions: combo };
    const provider = { json: async (prompt: string, schema: z.ZodType) => {
      calls++;
      if (calls === 1) {
        assert.match(prompt, /Choose no more than 1 actions/);
        assert.equal(schema.safeParse({ ...proposal, actions: [tap, tap] }).success, false);
        return { ...proposal, actions: [tap] };
      }
      assert.match(prompt, new RegExp(`Choose no more than ${editingStyle === 'reel' ? 32 : 8} actions`));
      assert.equal(schema.safeParse(proposal).success, editingStyle === 'reel');
      if (editingStyle === 'reel') {
        assert.match(prompt, /successful probe establishes a stable target and visible combo or earned-currency reward/);
        assert.match(prompt, /never blind sequences of menu choices/);
      }
      return proposal;
    } } as unknown as Pick<Inference, 'json'>;
    const decide = createFeedbackController(profile, provider, join(directory, editingStyle), undefined, { editingStyle });
    const first = await decide(observation);
    assert.deepEqual(first.actions, [tap]);
    const next = { ...observation, observationId: 'fixture:1', previousActions: first.actions, previousImage: observation.image };
    if (editingStyle === 'reel') assert.deepEqual((await decide(next)).actions, combo);
    else await assert.rejects(decide(next), /too_big/);
  }
});

test('compact repeat taps require reel pointer controls and share the aggregate time budget', () => {
  const taps = { type: 'taps' as const, point: { x: 0.5, y: 0.5 }, button: 'left' as const, count: 40, durationMs: 4000 };
  const exactBudget = { ...answer, actions: [taps, { ...taps, durationMs: 6000 }] };
  assert.deepEqual(validateFeedbackDecision(exactBudget, profile, false, 32).actions, exactBudget.actions);
  assert.deepEqual(controlDecisionSchema.parse(exactBudget).actions, exactBudget.actions);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...taps, durationMs: 4001 }, { ...taps, durationMs: 6000 }] }, profile, false, 32), /exceeds 10 seconds/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...taps, durationMs: 3999 }] }, profile, false, 32), /100ms per tap/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [taps] }, profile), 'legacy decisions cannot add compact repetition');
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [taps] }, profile, false, 1), 'the initial control probe cannot repeat');
  const keyboardOnly = gameProfileSchema.parse({ ...profile, controller: { type: 'sparse', allowedKeys: ['Space'], allowPointer: false } });
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [taps] }, keyboardOnly, false, 32), /control not established/);
});

test('compact repeat taps enter the reel wire only after a single non-wait probe', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-compact-taps-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tap = { type: 'tap' as const, point: { x: 0.5, y: 0.5 }, button: 'left' as const };
  const taps = { ...tap, type: 'taps' as const, count: 4, durationMs: 800 };
  for (const editingStyle of ['episode', 'reel'] as const) {
    let calls = 0;
    const proposal = { ...answer, ...(editingStyle === 'reel' ? { pivotTo: null, mechanics: [] } : {}), actions: [taps] };
    const provider = { json: async (prompt: string, schema: z.ZodType) => {
      calls++;
      const allowed = editingStyle === 'reel' && calls === 3;
      assert.equal(schema.safeParse(proposal).success, allowed);
      if (calls === 1) return { ...proposal, actions: [{ type: 'wait', durationMs: 500 }] };
      if (calls === 2) return { ...proposal, actions: [tap] };
      if (editingStyle === 'reel') {
        assert.match(prompt, /First test a small faster-cadence batch/);
        assert.match(prompt, /Slow the cadence if taps or rewards are missed/);
        assert.match(prompt, /400ms waits still apply between menu\/puzzle choices/);
        assert.equal(schema.safeParse({ ...proposal, actions: [{ ...taps, button: undefined }] }).success, false);
      }
      return proposal;
    } } as unknown as Pick<Inference, 'json'>;
    const decide = createFeedbackController(profile, provider, join(directory, editingStyle), undefined, { editingStyle });
    const first = await decide(observation);
    const probe = await decide({ ...observation, observationId: 'fixture:1', previousActions: first.actions, previousImage: observation.image });
    const next = { ...observation, observationId: 'fixture:2', previousActions: probe.actions, previousImage: observation.image };
    if (editingStyle === 'reel') assert.deepEqual((await decide(next)).actions, [taps]);
    else await assert.rejects(decide(next), /invalid_union/);
  }
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
  const learnedMechanics = [{ name: 'Ice wall', status: 'working', evidence: 'SYNTHETIC initial ice form created a wall at 2s.', nextGoal: 'Use the wall beside the visible target.' }];
  const provider = { json: async (prompt: string) => {
    calls++;
    assert.match(prompt, /One ordinary success is a milestone: report outcome=progress and continue/);
    assert.match(prompt, /Stop on death or terminal game completion/);
    if (calls === 6) {
      assert.deepEqual(JSON.parse(prompt.match(/Mechanic checklist from the last decision.*?: (\[.*\])\. Return/)![1]!), learnedMechanics);
      assert.doesNotMatch(prompt, /Recent observations\/lessons[^\n]*SYNTHETIC initial ice form/);
    }
    return { ...answer, pivotTo: null, mechanics: learnedMechanics, observation: calls === 1 ? 'SYNTHETIC initial ice form is visible.' : `SYNTHETIC distinct later state ${calls}.`, lesson: calls === 1 ? 'SYNTHETIC ice control established.' : 'Compare the next observed effect.' };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, undefined, { editingStyle: 'reel' });
  for (let i = 0; i < 6; i++) {
    const result = await decide({ ...observation, observationId: `fixture:${i}`, elapsedMs: 2000 + i * 5000, previousActions: i ? [move] : [] });
    assert.equal(result.stop, false, 'a subgoal can remain progress while exploration continues');
    assert.deepEqual(result.actions, [move]);
    assert.deepEqual(result.mechanics, learnedMechanics);
  }
  assert.throws(() => validateFeedbackDecision({ ...answer, outcome: 'success' }, profile), /terminal outcome must stop/, 'reel guidance does not bypass terminal/action consistency');
  const legacy = createFeedbackController(profile, { json: async (prompt: string) => {
    assert.doesNotMatch(prompt, /REEL EXPLORATION|Mechanic checklist/);
    assert.match(prompt, /Stop on death or completion/);
    return { ...answer, outcome: 'success', stop: true, actions: [] };
  } } as unknown as Pick<Inference, 'json'>, join(directory, 'legacy'));
  assert.equal((await legacy(observation)).stop, true, 'saved episode runs keep their existing completion policy');
});

test('reel camera correction uses current lock and remembered failed engagement before allowing look', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-engagement-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cameraProfile = gameProfileSchema.parse({ ...profile, controller: { type: 'sparse', instructions: 'Click the visible aim prompt to engage Mouse Look. Escape cancels the visible dial.', allowedKeys: ['Escape'], allowPointer: true, allowLook: true } });
  const miss = { type: 'tap' as const, point: { x: 0.5, y: 0.51 }, button: 'left' as const };
  const correction = { type: 'tap' as const, point: { x: 0.5, y: 0.44 }, button: 'left' as const };
  let calls = 0;
  const reelAnswer = { ...answer, pivotTo: null, mechanics: [] };
  const provider = { json: async (prompt: string) => {
    calls++;
    assert.match(prompt, /permit ONE corrected engagement attempt/);
    assert.match(prompt, /Do not substitute a generic center-screen click/);
    assert.match(prompt, /After the correction, a still-unlocked browser is an explicit limitation/);
    if (calls === 1) return { ...reelAnswer, reason: 'SYNTHETIC first engagement attempt.', actions: [miss], lesson: 'SYNTHETIC engagement unverified.' };
    if (calls === 2) {
      assert.match(prompt, /Browser pointer lock NOW: false/);
      assert.match(prompt, /Previous actions:.*"y":0.51/);
      return { ...reelAnswer, observation: 'SYNTHETIC aim prompt remains and the dial opened.', reason: 'Return using the observed cancel, then correct the visible target once.', lesson: 'SYNTHETIC first engagement failed; one corrected attempt is now used.', actions: [{ type: 'key', key: 'Escape', durationMs: 100 }, { type: 'wait', durationMs: 400 }, correction] };
    }
    assert.match(prompt, /Browser pointer lock NOW: false/);
    assert.match(prompt, /one corrected attempt is now used/);
    return { ...reelAnswer, observation: 'SYNTHETIC engagement remains blocked.', outcome: 'uncertain', stop: true, actions: [], lesson: 'SYNTHETIC camera remains unavailable after one correction.' };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(cameraProfile, provider, directory, undefined, { editingStyle: 'reel' });
  const first = await decide(observation);
  const second = await decide({ ...observation, observationId: 'fixture:1', previousActions: first.actions, previousImage: observation.image });
  assert.deepEqual(second.actions.at(-1), correction, 'policy can correct a missed target without assuming lock');
  const last = await decide({ ...observation, observationId: 'fixture:2', previousActions: second.actions, previousImage: observation.image });
  assert.equal(last.stop, true);
  assert.deepEqual(last.actions, []);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ type: 'look', dx: 20, dy: 0, durationMs: 100 }] }, cameraProfile, false), /active browser pointer lock/, 'prompt-level retry guidance cannot bypass the native-mode guard');
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
    assert.match(prompt, /meaningful progression objective/);
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

test('simultaneous controls require every observed key and retain the ten-second batch limit', () => {
  const movement = gameProfileSchema.parse({ ...profile, controller: { type: 'sparse', allowedKeys: ['KeyW', 'Space'], allowPointer: false } });
  const flight = { type: 'keys', keys: ['KeyW', 'Space'], durationMs: 6000 };
  assert.deepEqual(validateFeedbackDecision({ ...answer, actions: [flight, { type: 'key', key: 'KeyW', durationMs: 4000 }] }, movement).actions[0], flight);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...flight, keys: ['KeyW', 'KeyX'] }] }, movement), /control not established/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...flight, keys: ['KeyW', 'KeyW'] }] }, movement), /unique/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [flight, { type: 'key', key: 'KeyW', durationMs: 5000 }] }, movement), /exceeds 10 seconds/);
  assert.throws(() => validateFeedbackDecision({ ...answer, actions: [{ ...flight, durationMs: 6001 }] }, movement));
});

test('during-action frames survive a landed NOW image and carry working mechanics into the next decision', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-transient-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const movement = gameProfileSchema.parse({ ...profile, controller: { type: 'sparse', allowedKeys: ['KeyW', 'Space'], allowPointer: false } });
  const probe = { type: 'key' as const, key: 'Space', durationMs: 4000 };
  const checklist = [{ name: 'Flight', status: 'working', evidence: 'DURING image 2 at 3s shows airborne ascent; NOW landed.', nextGoal: 'Fly toward the visible roof.' }];
  let calls = 0;
  const provider = { json: async (prompt: string, schema: z.ZodType, media: Array<{ data: string }>) => {
    calls++;
    const proposal = { ...answer, pivotTo: null, mechanics: checklist, actions: [probe] };
    const wire = z.toJSONSchema(schema);
    const assertStrict = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;
      if (node.type === 'object') assert.deepEqual([...(node.required as string[])].sort(), Object.keys(node.properties as object).sort());
      Object.values(node).forEach(item => Array.isArray(item) ? item.forEach(assertStrict) : assertStrict(item));
    };
    assertStrict(wire);
    if (calls === 1) {
      assert.equal(schema.safeParse({ ...proposal, actions: [{ type: 'keys', keys: ['KeyW', 'Space'], durationMs: 4000 }] }).success, false, 'a chord cannot be the first control probe');
      return { ...proposal, mechanics: [{ ...checklist[0], status: 'testing', evidence: 'Space is an observed hold-to-fly instruction.' }] };
    }
    if (calls === 2) {
      assert.deepEqual(media.map(item => Buffer.from(item.data, 'base64').toString()), ['GROUNDED_BEFORE', 'AIRBORNE_DURING', 'ASCENDING_DURING', 'LANDED_NOW']);
      const manifest = JSON.parse(prompt.match(/Image order and recording timestamps: (\[.*\])\. BEFORE/)![1]!);
      assert.deepEqual(manifest.map((item: { elapsedMs: number }) => item.elapsedMs), [2500, 3000, 5000, 10000]);
      assert.match(prompt, /Absence from a late screenshot alone is not a failed control/);
      return proposal;
    }
    assert.deepEqual(JSON.parse(prompt.match(/Mechanic checklist from the last decision.*?: (\[.*\])\. Return/)![1]!), checklist);
    assert.equal(media.length, 2, 'old sampled images are not repeatedly retransmitted');
    assert.equal(schema.safeParse({ ...proposal, actions: [{ type: 'keys', keys: ['KeyW', 'Space'], durationMs: 4000 }] }).success, true);
    return { ...proposal, actions: [{ type: 'keys', keys: ['KeyW', 'Space'], durationMs: 4000 }] };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(movement, provider, directory, undefined, { editingStyle: 'reel' });
  await decide(observation);
  const observed = await decide({ ...observation, elapsedMs: 10000, previousActions: [probe], previousImage: Buffer.from('GROUNDED_BEFORE'), previousImageElapsedMs: 2500, image: Buffer.from('LANDED_NOW'),
    recentFrames: [{ image: Buffer.from('AIRBORNE_DURING'), elapsedMs: 3000 }, { image: Buffer.from('ASCENDING_DURING'), elapsedMs: 5000 }] });
  assert.equal(observed.mechanics?.[0]?.status, 'working');
  const saved = JSON.parse(await readFile(join(directory, 'decision-02.json'), 'utf8'));
  assert.equal(await readFile(saved.sampledFrames[0].imagePath, 'utf8'), 'AIRBORNE_DURING');
  assert.equal(await readFile(saved.sampledFrames[1].imagePath, 'utf8'), 'ASCENDING_DURING');
  assert.deepEqual(saved.mechanics, checklist);
  assert.equal(saved.previousImageElapsedMs, 2500, 'BEFORE uses its actual pre-input time, not the prior 2000ms request time');
  assert.equal(await readFile(saved.previousImagePath, 'utf8'), 'GROUNDED_BEFORE');
  assert.equal(await readFile(saved.imagePath, 'utf8'), 'LANDED_NOW');
  assert.equal(await readFile(join(directory, 'decision-01.jpg'), 'utf8'), 'CURRENT_SYNTHETIC_IMAGE', 'the original request screenshot remains separate');
  const next = await decide({ ...observation, elapsedMs: 20000, previousActions: [probe], previousImage: Buffer.from('LANDED_NOW') });
  assert.equal(next.actions[0]?.type, 'keys');
});

test('aborted feedback consumes a unique artifact slot and late proposals cannot enter accepted memory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-expired-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const abort = new AbortController(), accepted: unknown[] = [];
  const timeout = new DOMException('Decision deadline reached', 'TimeoutError');
  let completeLate!: (value: unknown) => void, providerEntered!: () => void, calls = 0;
  const entered = new Promise<void>(resolve => { providerEntered = resolve; });
  const provider = { json: async (prompt: string) => {
    calls++;
    if (calls === 1) {
      providerEntered();
      return new Promise(resolve => { completeLate = resolve; });
    }
    assert.match(prompt, /equivalent failed shot or an autonomous phase banner is not new progress/);
    assert.match(prompt, /Free exploration can progress through real new areas without a score/);
    assert.doesNotMatch(prompt, /LATE FALSE SUCCESS/);
    assert.match(prompt, new RegExp(`${profile.controller.type === 'sparse' ? profile.controller.maxDecisions - calls : -1} action batches remain`));
    const history = JSON.parse(prompt.match(/Recent observations\/lessons.*?: (\[.*\])\./)![1]!);
    assert.equal(history.length, calls - 2, 'failed and late calls are absent from accepted memory');
    return { ...answer, pivotTo: null, mechanics: [] };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, value => accepted.push(value), { editingStyle: 'reel' });
  const failed = decide({ ...observation, signal: abort.signal });
  const rejected = assert.rejects(failed, error => error === timeout);
  await entered;
  abort.abort(timeout);
  await rejected;
  const failure = JSON.parse(await readFile(join(directory, 'decision-01-failure.json'), 'utf8'));
  assert.equal(failure.aborted, true);
  assert.equal(failure.error.name, 'TimeoutError');
  assert.equal(failure.observationId, observation.observationId);
  assert.equal(await readFile(failure.imagePath, 'utf8'), 'CURRENT_SYNTHETIC_IMAGE');
  await decide({ ...observation, observationId: 'fixture:1' });
  completeLate({ ...answer, observation: 'LATE FALSE SUCCESS', outcome: 'success', stop: true, actions: [], pivotTo: null, mechanics: [] });
  await new Promise(resolve => setImmediate(resolve));
  await decide({ ...observation, observationId: 'fixture:2', previousActions: [move] });
  assert.equal(accepted.length, 2);
  for (const suffix of ['.json', '-proposal.json']) await assert.rejects(readFile(join(directory, `decision-01${suffix}`)), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(directory, 'decision-02.json'), 'utf8')).observationId, 'fixture:1');
  assert.equal(JSON.parse(await readFile(join(directory, 'decision-03.json'), 'utf8')).observationId, 'fixture:2');
  assert.doesNotMatch(await readFile(join(directory, 'report.md'), 'utf8'), /LATE FALSE SUCCESS|decision-01/);
});

test('frame ordering and checklist size are bounded before actions can be dispatched', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-bounds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = { json: async () => { calls++; return answer; } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory);
  for (const times of [[1500, 1000], [2100], [Number.NaN], [-1], [1, 2, 3, 4, 5, 6, 7]]) {
    await assert.rejects(decide({ ...observation, recentFrames: times.map(elapsedMs => ({ image: observation.image, elapsedMs })) }), /six chronological recording timestamps/);
  }
  assert.equal(calls, 0);
  const mechanic = { name: 'Flight', status: 'testing', evidence: 'Observed control, result uncertain.', nextGoal: 'Inspect the next action frames.' };
  assert.throws(() => validateFeedbackDecision({ ...answer, pivotTo: null, mechanics: Array.from({ length: 9 }, (_, index) => ({ ...mechanic, name: `Mechanic ${index}` })) }, profile));
  assert.throws(() => validateFeedbackDecision({ ...answer, pivotTo: null, mechanics: [mechanic, { ...mechanic, name: 'flight' }] }, profile), /unique/);
});

test('new reel feedback profiles scale their call ceiling within the requested capture budget', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const imagePath = join(directory, 'fixture.png');
  await writeFile(imagePath, 'SYNTHETIC quiet scene');
  const provider = { json: async () => ({ supported: true, confidence: 'medium', latencyTolerant: true, objective: 'Reach the visible landmark using flight.',
    instructions: 'W moves; hold Space to fly.', allowedKeys: ['KeyW', 'Space'], allowPointer: false, allowLook: false,
    evidence: ['Visible movement and flight controls.'], limitations: [] }) } as unknown as Pick<Inference, 'json'>;
  for (const [requested, duration, decisions] of [[undefined, 600000, 40], [175000, 175000, 16], [600000, 600000, 40]] as const) {
    const outputDir = await mkdtemp(join(directory, 'case-'));
    const inspection: GameInspection = { gameUrl: profile.gameUrl, observedAt: 'fixture', outputDir, imagePath, beforeImagePath: imagePath,
      text: 'W moves; hold Space to fly.', readyToPlay: true, surface: profile.surface, ready: profile.ready, startTargets: [], viewport: profile.viewport, setup: [] };
    const result = await learnFeedbackProfile(inspection, { id: 'fixture', url: profile.gameUrl, title: profile.name, titleSource: 'visible_text', metrics: [], observations: [] }, provider, undefined, { editingStyle: 'reel', ...(requested ? { maxDurationMs: requested } : {}) });
    assert.equal(result.profile?.maxDurationMs, duration);
    assert.equal(result.profile?.controller.type, 'sparse');
    if (result.profile?.controller.type === 'sparse') assert.equal(result.profile.controller.maxDecisions, decisions);
  }
});

test('reel response limits are enforced on the strict request and returned data without narrowing legacy decisions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-concise-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const atLimit = { ...answer, pivotTo: null, observation: 'o'.repeat(500), lesson: 'l'.repeat(300), reason: 'r'.repeat(400), actions: [{ ...move, button: 'left' }],
    mechanics: [{ name: 'Movement', status: 'working', evidence: 'e'.repeat(180), nextGoal: 'g'.repeat(120) }] };
  const invalid = [
    { ...atLimit, observation: 'o'.repeat(501) },
    { ...atLimit, lesson: 'l'.repeat(301) },
    { ...atLimit, reason: 'r'.repeat(401) },
    { ...atLimit, mechanics: [{ ...atLimit.mechanics[0], evidence: 'e'.repeat(181) }] },
    { ...atLimit, mechanics: [{ ...atLimit.mechanics[0], nextGoal: 'g'.repeat(121) }] },
  ];
  let accepted = 0;
  for (const [index, proposal] of [atLimit, ...invalid].entries()) {
    const provider = { json: async (_prompt: string, schema: z.ZodType) => {
      assert.equal(schema.safeParse(atLimit).success, true);
      for (const value of invalid) assert.equal(schema.safeParse(value).success, false);
      const wire = z.toJSONSchema(schema) as { properties: Record<string, unknown>; required: string[] };
      assert.deepEqual([...wire.required].sort(), Object.keys(wire.properties).sort(), 'the concise checklist is required on the strict wire');
      return proposal;
    } } as unknown as Pick<Inference, 'json'>;
    const decide = createFeedbackController(profile, provider, join(directory, String(index)), () => { accepted++; }, { editingStyle: 'reel' });
    if (!index) assert.equal((await decide(observation)).observation.length, 500);
    else await assert.rejects(decide(observation), /too_big/, 'an overlong provider response cannot reach the action consumer');
  }
  assert.equal(accepted, 1);
  const legacyResponse = { ...answer, observation: 'o'.repeat(501), lesson: 'l'.repeat(301), reason: 'r'.repeat(401) };
  assert.deepEqual(validateFeedbackDecision(legacyResponse, profile), legacyResponse);
  const legacy = createFeedbackController(profile, { json: async (_prompt: string, schema: z.ZodType) => {
    assert.equal(schema.safeParse({ ...legacyResponse, actions: [{ ...move, button: 'left' }] }).success, true);
    assert.equal('mechanics' in z.toJSONSchema(schema).properties!, false);
    assert.equal('pivotTo' in z.toJSONSchema(schema).properties!, false);
    return legacyResponse;
  } } as unknown as Pick<Inference, 'json'>, join(directory, 'legacy'));
  assert.deepEqual((await legacy(observation)).actions, [move]);
});

test('reel history retains scoped demonstrations when the current checklist forgets or blocks them', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const heat = { name: 'Heatblast: flight', status: 'working', evidence: 'SYNTHETIC Heatblast lifted over a roof at 7s.', nextGoal: 'Reach the visible tower.' };
  const ice = { name: 'Ice form: flight', status: 'working', evidence: 'SYNTHETIC ice form glided over water at 12s.', nextGoal: 'Reach the far bank.' };
  let calls = 0;
  const provider = { json: async (prompt: string) => {
    calls++;
    assert.match(prompt, /complete native setup→choice→change→use sequence/);
    assert.match(prompt, /A count of button demonstrations or short moments is not completion/);
    const historical = JSON.parse(prompt.match(/Earlier demonstrated mechanics[^\n]*?: (\[.*\])\. This server-owned/)![1]!);
    if (calls === 2) assert.deepEqual(historical, [], 'an initial hypothesis is not an observed action result');
    if (calls === 8) {
      assert.deepEqual(historical, [
        { name: heat.name, evidence: heat.evidence, atSeconds: 7 },
        { name: ice.name, evidence: ice.evidence, atSeconds: 12 },
      ]);
      assert.match(prompt, /NOT independently verified or necessarily available in the CURRENT form/);
      assert.doesNotMatch(prompt.match(/Recent observations\/lessons[^\n]*/)![0], /lifted over a roof/);
      assert.match(prompt, /Mechanic checklist from the last decision[^\n]*: \[\]\. Return/);
    }
    const mechanics = calls === 1 ? [{ ...heat, status: 'testing' }]
      : calls === 2 ? [heat] : calls === 3 ? [ice]
        : calls === 4 ? [{ ...heat, name: 'HEATBLAST: FLIGHT', status: 'blocked', evidence: 'Current form is Ice; the old Heatblast input is unavailable.' }] : [];
    return { ...answer, observation: calls === 2 ? heat.evidence : `SYNTHETIC current state ${calls}.`, pivotTo: null, mechanics };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, undefined, { editingStyle: 'reel' });
  for (let i = 0; i < 8; i++) await decide({ ...observation, elapsedMs: 2000 + i * 5000, previousActions: i ? [move] : [] });
  const saved = JSON.parse(await readFile(join(directory, 'decision-08.json'), 'utf8'));
  assert.equal(saved.demonstratedMechanics.length, 2, 'scoped effects survive omission and a current-form block');
  assert.deepEqual(saved.mechanics, [], 'historical effects never masquerade as the current checklist');
  assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /Heatblast: flight at 7\.00s/);
});

test('reel demonstration memory deduplicates stable names and stays bounded', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-history-bound-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = { json: async () => {
    const start = calls++ < 2 ? 0 : (calls - 2) * 8;
    return { ...answer, pivotTo: null, mechanics: Array.from({ length: 8 }, (_, index) => ({
      name: calls === 2 ? ` FORM: ${start + index} ` : `Form: ${start + index}`,
      status: 'working', evidence: 'SYNTHETIC visible effect.', nextGoal: 'Use this toward a visible target.',
    })) };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, undefined, { editingStyle: 'reel' });
  for (let i = 0; i < 4; i++) await decide({ ...observation, previousActions: [move], elapsedMs: 2000 + i * 5000 });
  const deduped = JSON.parse(await readFile(join(directory, 'decision-02.json'), 'utf8'));
  assert.equal(deduped.demonstratedMechanics.length, 8);
  const bounded = JSON.parse(await readFile(join(directory, 'decision-04.json'), 'utf8'));
  assert.equal(bounded.demonstratedMechanics.length, 16);
  assert.equal(bounded.demonstratedMechanics[0].name, 'Form: 8');
});

test('a reel can pivot once from a stalled route to another known feature then must show progress', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-pivot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const route = { name: 'Route: tower', status: 'blocked', evidence: 'SYNTHETIC the tower route is lost.', nextGoal: 'Leave this blocked route.' };
  const tool = { name: 'Builder: tool selector', status: 'untried', evidence: 'SYNTHETIC the current instructions show a tool selector.', nextGoal: 'Open the observed selector and choose the bridge tool.' };
  let calls = 0;
  const provider = { json: async (prompt: string) => {
    calls++;
    if (calls === 4) assert.match(prompt, /Consecutive stalled observations before this decision: 2/);
    if (calls === 5) assert.match(prompt, /One recovery pivot for this session: already used/);
    return { ...answer, outcome: calls === 1 ? 'progress' : 'no_progress', mechanics: [route, tool], pivotTo: calls >= 4 ? tool.name : null };
  } } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, undefined, { editingStyle: 'reel' });
  for (let i = 0; i < 3; i++) assert.equal((await decide({ ...observation, previousActions: i ? [move] : [] })).stop, false);
  const pivot = await decide({ ...observation, previousActions: [move] });
  assert.equal(pivot.stop, false);
  assert.deepEqual(pivot.actions, [move]);
  assert.match(pivot.reason, /One bounded recovery toward Builder: tool selector/);
  const stopped = await decide({ ...observation, previousActions: [move] });
  assert.equal(stopped.stop, true);
  assert.deepEqual(stopped.actions, []);
  assert.match(stopped.reason, /4 consecutive observations without progress/);
  assert.equal(JSON.parse(await readFile(join(directory, 'decision-04.json'), 'utf8')).pivotUsed, true);
});

test('pivot cannot invent a feature, revive a blocked feature or overrule a terminal stop', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-pivot-guards-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const route = { name: 'Route: tower', status: 'blocked', evidence: 'SYNTHETIC lost route.', nextGoal: 'Stop this route.' };
  const tool = { name: 'Builder: tool selector', status: 'untried', evidence: 'SYNTHETIC observed selector.', nextGoal: 'Choose another observed tool.' };
  for (const [index, scenario] of ['invented', 'blocked', 'terminal', 'wait_only', 'final'].entries()) {
    let calls = 0;
    const provider = { json: async () => {
      calls++;
      const terminal = calls === 4 && ['terminal', 'final'].includes(scenario);
      return { ...answer, outcome: terminal ? 'failure' : 'no_progress', stop: terminal,
        actions: terminal ? [] : scenario === 'wait_only' && calls === 4 ? [{ type: 'wait', durationMs: 500 }] : [move],
        pivotTo: calls === 4 ? scenario === 'invented' ? 'Unseen teleport' : tool.name : null,
        mechanics: calls === 4 && scenario === 'blocked' ? [route, { ...tool, status: 'blocked' }] : [route, tool] };
    } } as unknown as Pick<Inference, 'json'>;
    const decide = createFeedbackController(profile, provider, join(directory, String(index)), undefined, { editingStyle: 'reel' });
    for (let i = 0; i < 3; i++) await decide({ ...observation, previousActions: i ? [move] : [] });
    const stopped = await decide({ ...observation, previousActions: [move], isFinal: scenario === 'final' });
    assert.equal(stopped.stop, true, scenario);
    assert.deepEqual(stopped.actions, [], scenario);
    const saved = JSON.parse(await readFile(join(directory, String(index), 'decision-04.json'), 'utf8'));
    assert.equal(saved.pivotUsed, false, scenario);
  }
});

test('successful pivot resets stalls but does not grant a second recovery in the same reel', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-pivot-once-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = { json: async () => ({ ...answer, outcome: ++calls === 5 ? 'progress' : 'no_progress', pivotTo: 'Builder: selector', mechanics: [
    { name: 'Route: tower', status: 'blocked', evidence: 'SYNTHETIC lost route.', nextGoal: 'Leave the failed route.' },
    { name: 'Builder: selector', status: 'working', evidence: 'SYNTHETIC observed selector.', nextGoal: 'Choose the visible tool.' },
  ] }) } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, undefined, { editingStyle: 'reel' });
  for (let i = 0; i < 7; i++) assert.equal((await decide({ ...observation, previousActions: i ? [move] : [] })).stop, false);
  const stopped = await decide({ ...observation, previousActions: [move] });
  assert.equal(stopped.stop, true);
  assert.match(stopped.reason, /3 consecutive observations without progress; the one recovery pivot was already used/);
});


test('an uncertain recovery cannot silently reset the stall guard', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-pivot-uncertain-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = { json: async () => ({ ...answer, outcome: ++calls === 5 ? 'uncertain' : 'no_progress', pivotTo: 'Builder: selector', mechanics: [
    { name: 'Route: tower', status: 'blocked', evidence: 'SYNTHETIC lost route.', nextGoal: 'Leave the failed route.' },
    { name: 'Builder: selector', status: 'working', evidence: 'SYNTHETIC observed selector.', nextGoal: 'Choose the visible tool.' },
  ] }) } as unknown as Pick<Inference, 'json'>;
  const decide = createFeedbackController(profile, provider, directory, undefined, { editingStyle: 'reel' });
  for (let i = 0; i < 4; i++) assert.equal((await decide({ ...observation, previousActions: i ? [move] : [] })).stop, false);
  const stopped = await decide({ ...observation, previousActions: [move] });
  assert.equal(stopped.outcome, 'uncertain');
  assert.equal(stopped.stop, true);
  assert.deepEqual(stopped.actions, []);
  assert.match(stopped.reason, /one recovery pivot did not establish progress/);
});
