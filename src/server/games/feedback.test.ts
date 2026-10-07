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
  image: Buffer.from('CURRENT_SYNTHETIC_IMAGE'), mimeType: 'image/jpeg', text: 'one remaining', elapsedMs: 2000, remainingMs: 100000,
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
  assert.equal(learned.profile?.maxDurationMs, 175000);
  await rm(join(directory, 'learning.json'));
  await rm(join(directory, 'feedback-assessment.json'));
  const shorter = await learnFeedbackProfile(inspection, candidate, provider, undefined, { captureGoal: 'Fill one visible corner.', maxDurationMs: 60000 });
  assert.equal(shorter.profile?.maxDurationMs, 60000);
});
