import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalGameUrl } from './discovery.js';
import { gameProfileSchema, type GameCandidate } from './schema.js';
import { parsePublicMetrics, rankGames } from './selection.js';

const candidate = (id: string, text: string): GameCandidate => ({ id, title: id, titleSource: 'visible_text', url: `https://www.astrocade.com/games/${id}/${id}`, metrics: parsePublicMetrics(text), observations: [{ sourceUrl: 'https://www.astrocade.com/', observedAt: '2026-10-06T00:00:00Z', cardText: text }] });

test('public metrics require an explicit label and preserve approximate display text', () => {
  assert.deepEqual(parsePublicMetrics('2.4K plays\nLikes: 31\nVersion 42'), [
    { label: 'plays', raw: '2.4K plays', value: 2400, approximate: true },
    { label: 'likes', raw: 'Likes: 31', value: 31, approximate: false },
  ]);
  assert.deepEqual(parsePublicMetrics('Featured #1\n2026\n1.2K'), []);
});

test('canonicalization accepts only actual Astrocade game paths', () => {
  assert.equal(canonicalGameUrl('/games/my-game/abc123/?ref=home'), 'https://www.astrocade.com/games/my-game/abc123');
  assert.equal(canonicalGameUrl('https://astrocade.com/games/a/id#play'), 'https://www.astrocade.com/games/a/id');
  assert.equal(canonicalGameUrl('https://evil.example/games/a/id'), undefined);
  assert.equal(canonicalGameUrl('/category/trending'), undefined);
});

test('popular ranking compares like counters, retaining missing information as unknown', () => {
  const ranked = rankGames([candidate('unknown', '9999'), candidate('small', '12 plays'), candidate('large', '100 plays'), candidate('likes', '100000 likes')], { mode: 'popular' });
  assert.deepEqual(ranked.map(r => r.candidate.id), ['large', 'small', 'unknown', 'likes']);
  assert.equal(ranked[2]!.signals.popularity, undefined);
});

test('trend mode reports no match and visual ranking requires evidence', () => {
  const input = [candidate('runner', 'space race'), candidate('sorter', 'color sort')];
  assert.deepEqual(rankGames(input, { mode: 'trend', trendTerms: ['football'] }), []);
  assert.equal(rankGames(input, { mode: 'trend', trendTerms: ['color'] })[0]!.candidate.id, 'sorter');
  const ranked = rankGames(input, { mode: 'visual', visualAssessments: { sorter: { score: 4, reason: 'Visible sorting transformation.', evidence: 'Probe shows objects move into matching bins.' } } });
  assert.equal(ranked[0]!.candidate.id, 'sorter');
  assert.equal(ranked[1]!.provisional, true);
});

test('profile actions cannot contain unbounded keys, arbitrary evaluation, or extreme durations', () => {
  const profile = { id: 'fixture', name: 'Fixture', gameUrl: 'http://127.0.0.1:1234/', viewport: { width: 800, height: 600 }, ready: { selector: 'canvas' }, surface: { selector: 'canvas' }, objective: 'Show a move.', controller: { type: 'timed', actions: [{ type: 'key', key: 'Space', durationMs: 100 }] } };
  assert.equal(gameProfileSchema.parse(profile).verification, 'unverified');
  assert.equal(gameProfileSchema.safeParse({ ...profile, controller: { type: 'timed', actions: [{ type: 'key', key: 'Meta+R', durationMs: 100 }] } }).success, false);
  assert.equal(gameProfileSchema.safeParse({ ...profile, controller: { type: 'timed', actions: [{ type: 'evaluate', script: 'arbitrary()' }] } }).success, false);
});
