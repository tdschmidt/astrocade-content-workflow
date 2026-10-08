import assert from 'node:assert/strict';
import test from 'node:test';
import { nominateGames, nominationSchema } from './selection.js';
import type { Inference } from '../server/providers/inference.js';
import type { GameCandidate } from '../server/games/schema.js';
import { contentAssessmentSchema, contentBriefSchema, contentScore, defaultContentBrief, summarizeBrief, type ContentAssessment } from '../shared/content.js';

const candidate: GameCandidate = { id: 'real', title: 'Observed game', titleSource: 'visible_text', url: 'https://www.astrocade.com/games/observed/real', metrics: [], observations: [] };
const legacyNomination = { gameId: 'real', hypothesis: 'Look for a visible consequence.', viewerQuestion: 'Which gate works?', controlRisk: 'Controls are not yet inspected.' };
const nomination = { ...legacyNomination, angle: 'prediction', gameplayFamily: 'route choice', socialPremise: 'The obvious gate choice backfires.', trendTopic: null, captureGoal: 'Show both gates, a choice, and its visible consequence.', rejectIf: 'The gate labels or resulting change are unreadable.' };

test('shortlisting rejects invented and duplicate IDs before inspecting any game', async () => {
  for (const games of [[{ ...nomination, gameId: 'invented' }], [nomination, nomination]]) {
    const google = { json: async () => ({ games }) } as unknown as Inference;
    await assert.rejects(nominateGames([candidate], [], google, 3), /duplicate or unknown/);
  }
  const google = { json: async () => ({ games: [nomination] }) } as unknown as Inference;
  assert.deepEqual(await nominateGames([candidate], [], google, 3), [nomination]);
});

test('legacy shortlists remain readable while new nominations require an event and rejection condition', async () => {
  assert.deepEqual(nominationSchema.parse(legacyNomination), legacyNomination);
  for (const games of [[legacyNomination], [{ ...nomination, captureGoal: ' ' }], [{ ...nomination, rejectIf: ' ' }]]) {
    const provider = { json: async () => ({ games }) } as unknown as Inference;
    await assert.rejects(nominateGames([candidate], [], provider, 3));
  }
});

test('nomination gives the provider a bounded editorial brief and controller limitations', async () => {
  let received = '';
  const provider = { json: async (prompt: string) => { received = prompt; return { games: [nomination] }; } } as unknown as Inference;
  await nominateGames([candidate], [], provider, 2, undefined, 'feedback', { ...defaultContentBrief, audience: 'People choosing a route before the player moves.' });
  assert.match(received, /People choosing a route/);
  assert.match(received, /5–20 seconds of inference latency/);
  assert.match(received, /captureGoal/);
  assert.match(received, /rejectIf/);
  assert.match(received, /Popularity must not rescue/);
  assert.match(received, /No current trend match is verified/);
  await assert.rejects(nominateGames([candidate], [], provider, 0), /Shortlist size/);
  await assert.rejects(nominateGames([candidate], [], provider, 6), /Shortlist size/);
});

test('reel briefs reach nomination while saved briefs preserve an absent editing style', async () => {
  const { editingStyle: _, ...legacyBrief } = defaultContentBrief;
  assert.equal(contentBriefSchema.parse(legacyBrief).editingStyle, undefined);
  assert.equal(contentBriefSchema.safeParse({ ...legacyBrief, editingStyle: 'unbounded-montage' }).success, false);
  for (const brief of [legacyBrief, { ...legacyBrief, editingStyle: 'episode' as const }, defaultContentBrief]) {
    let briefData: unknown;
    const provider = { json: async (prompt: string) => {
      // Inspect the serialized contract rather than asserting editorial prompt wording.
      briefData = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"audience":'))!);
      return { games: [nomination] };
    } } as unknown as Inference;
    await nominateGames([candidate], [], provider, 1, undefined, 'auto', brief);
    assert.deepEqual(briefData, {
      audience: brief.audience, voice: brief.voice,
      ...('editingStyle' in brief ? { editingStyle: brief.editingStyle } : {}),
      hookExamples: brief.hookExamples, sources: brief.sources, activeTrends: [],
    });
  }
  assert.equal(defaultContentBrief.editingStyle, 'reel');
});

const assessment: ContentAssessment = {
  angle: 'prediction', clarity: 3, participation: 2, payoff: 3, readability: 3, distinctiveness: 1,
  evidence: 'Two readable routes lead to visibly different outcomes.', textPlacement: 'upper', placementReason: 'The lower screen contains both route labels and the player.',
};

test('strong entertainment ratings cannot rescue absent clarity, payoff or readable gameplay', () => {
  assert.equal(contentScore(assessment), 26);
  assert.equal(contentScore({ ...assessment, participation: 3, distinctiveness: 3 }), 30);
  for (const field of ['clarity', 'payoff', 'readability'] as const) assert.equal(contentScore({ ...assessment, [field]: 0 }), -1);
  assert.equal(contentScore({ ...assessment, participation: 0, distinctiveness: 0 }), 21);
  assert.equal(contentAssessmentSchema.safeParse({ ...assessment, payoff: 3.5 }).success, false);
  assert.equal(contentAssessmentSchema.safeParse({ ...assessment, evidence: ' ' }).success, false);
});

test('only fresh, nonfuture, unexpired trend evidence reaches model prompts', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const base = { topic: 'active topic', sourceUrl: 'https://example.com/observed-trend', observedAt: '2026-10-06T12:00:00Z', validUntil: '2026-10-10T12:00:00Z', region: 'US', evidence: 'An observed signal for a stated region and measurement window, not game popularity.', gameTerms: ['cleaning'] };
  const summary = summarizeBrief({ ...defaultContentBrief, trends: [
    base,
    { ...base, topic: 'expired topic', validUntil: '2026-10-07T11:59:59Z' },
    { ...base, topic: 'future observation', observedAt: '2026-10-08T12:00:00Z' },
    { ...base, topic: 'old observation', observedAt: '2026-09-22T12:00:00Z' },
    { ...base, topic: 'overlong expiry', validUntil: '2026-11-10T12:00:00Z' },
    { ...base, topic: 'inverted interval', validUntil: '2026-10-05T12:00:00Z' },
  ] }, now);
  assert.match(summary, /active topic/);
  assert.doesNotMatch(summary, /expired topic|future observation|old observation|overlong expiry|inverted interval/);
  assert.match(summary, /untrusted reference data/);
  assert.match(summary, /only when their evidence matches the actual game mechanic/);
  assert.match(summarizeBrief({ ...defaultContentBrief, trends: [{ ...base, validUntil: '2026-10-06T12:00:00Z' }] }, now), /No current trend match is verified/);
});

test('freshness includes its stated endpoint but never outlives the fourteen-day cap', () => {
  const observedAt = '2026-09-23T12:00:00Z';
  const validUntil = '2026-10-07T12:00:00Z';
  const brief = { ...defaultContentBrief, trends: [{ topic: 'boundary topic', sourceUrl: 'https://example.com/trend', observedAt, validUntil, region: 'US', evidence: 'Dated observation.', gameTerms: ['puzzle'] }] };
  assert.match(summarizeBrief(brief, new Date(validUntil)), /boundary topic/);
  assert.doesNotMatch(summarizeBrief(brief, new Date('2026-10-07T12:00:00.001Z')), /boundary topic/);
  assert.throws(() => summarizeBrief(brief, new Date('invalid')), /evaluation date is invalid/);
  assert.equal(contentBriefSchema.safeParse({ ...brief, trends: [{ ...brief.trends[0], observedAt: 'yesterday' }] }).success, false);
});

test('a nomination cannot invent a current trend when the brief has none', async () => {
  const provider = { json: async () => ({ games: [{ ...nomination, trendTopic: 'invented viral meme' }] }) } as unknown as Inference;
  await assert.rejects(nominateGames([candidate], [], provider, 1), /unknown or expired trend/);
});
