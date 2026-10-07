import assert from 'node:assert/strict';
import test from 'node:test';
import { nominateGames } from './selection.js';
import type { GoogleServices } from '../server/providers/google.js';
import type { GameCandidate } from '../server/games/schema.js';

const candidate: GameCandidate = { id: 'real', title: 'Observed game', titleSource: 'visible_text', url: 'https://www.astrocade.com/games/observed/real', metrics: [], observations: [] };
const nomination = { gameId: 'real', hypothesis: 'Look for a visible consequence.', viewerQuestion: 'Which gate works?', controlRisk: 'Controls are not yet inspected.' };

test('shortlisting rejects invented and duplicate IDs before inspecting any game', async () => {
  for (const games of [[{ ...nomination, gameId: 'invented' }], [nomination, nomination]]) {
    const google = { json: async () => ({ games }) } as unknown as GoogleServices;
    await assert.rejects(nominateGames([candidate], [], google, 3), /duplicate or unknown/);
  }
  const google = { json: async () => ({ games: [nomination] }) } as unknown as GoogleServices;
  assert.deepEqual(await nominateGames([candidate], [], google, 3), [nomination]);
});
