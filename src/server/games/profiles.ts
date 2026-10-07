import { gameProfileSchema, type GameCandidate, type GameProfile, type InputAction } from './schema.js';

const gameFrame = ['iframe[title="Astrocade Game"]'];

function carWashSweeps(count: number, durationMs: number): InputAction[] {
  return Array.from({ length: count }, (_, row): InputAction[] => {
    const y = [0.41, 0.49, 0.57][row % 3]!;
    return [
      { type: 'drag', from: { x: row % 2 ? 0.9 : 0.1, y }, to: { x: row % 2 ? 0.1 : 0.9, y }, durationMs },
      { type: 'wait', durationMs: 100 },
    ];
  }).flat();
}

// Two fresh live captures passed on 2026-10-07 UTC. See docs/acceptance.md.
export const verifiedProfiles: GameProfile[] = [gameProfileSchema.parse({
  id: 'crowd-pier-run',
  name: 'Crowd Pier Run',
  gameUrl: 'https://www.astrocade.com/games/crowd-pier-run/01M2YWFH66FH6MMVW5AE66NX7S',
  verification: 'verified',
  verificationNotes: 'Two fresh live captures passed on 2026-10-07 UTC; full HUD and changing crowd counts were visually checked. Content quality is assessed for each generated video.',
  viewport: { width: 720, height: 1280 },
  surface: { selector: 'canvas', frames: gameFrame },
  ready: { selector: '#start-btn', frames: gameFrame },
  setup: [{ type: 'click', target: { selector: '[aria-label="Start playing"]' } }],
  start: [{ type: 'click', target: { selector: '#start-btn', frames: gameFrame } }],
  reset: [],
  focus: 'click',
  objective: 'Steer the running crowd through number gates and record visible changes in crowd size. A loss is usable; do not claim to finish the level.',
  maxDurationMs: 16000,
  controller: {
    type: 'timed', repetitions: 1,
    actions: [
      { type: 'wait', durationMs: 300 },
      { type: 'drag', from: { x: 0.5, y: 0.7 }, to: { x: 0.25, y: 0.7 }, durationMs: 500 },
      { type: 'wait', durationMs: 3500 },
      { type: 'drag', from: { x: 0.25, y: 0.7 }, to: { x: 0.75, y: 0.7 }, durationMs: 500 },
      { type: 'wait', durationMs: 3500 },
      { type: 'drag', from: { x: 0.75, y: 0.7 }, to: { x: 0.5, y: 0.7 }, durationMs: 500 },
      { type: 'wait', durationMs: 3500 },
    ],
  },
}), gameProfileSchema.parse({
  id: 'car-wash-simulator',
  name: 'Car Wash Simulator',
  gameUrl: 'https://www.astrocade.com/games/car-wash-simulator/01M3J5ZVKCWQ7K5XGXWZ6RRRTY',
  verification: 'verified',
  verificationNotes: 'Two fresh 29.43s/29.58s live captures passed on 2026-10-07 UTC. Both showed dirt falling from 100% to 26% and foam rinsed away. This profile demonstrates cleaning progress, not a completed customer or level.',
  viewport: { width: 720, height: 1280 },
  surface: { selector: '#game-canvas', frames: gameFrame },
  ready: { selector: '#start-btn', frames: gameFrame },
  setup: [{ type: 'click', target: { selector: '[aria-label="Start playing"]' } }],
  start: [{ type: 'click', target: { selector: '#start-btn', frames: gameFrame } }, { type: 'wait', durationMs: 700 }],
  reset: [], focus: 'click',
  objective: 'Apply visible foam, scrub dirt, and rinse the vehicle. Capture changes in the visible dirt and foam meters; do not claim a completed customer or level unless shown.',
  maxDurationMs: 35000,
  controller: {
    type: 'timed', repetitions: 1,
    actions: [
      ...carWashSweeps(9, 1200),
      { type: 'tap', point: { x: 0.36, y: 0.85 } }, // Observed Scrub tool.
      ...carWashSweeps(6, 1100),
      { type: 'tap', point: { x: 0.50, y: 0.85 } }, // Observed Rinse tool.
      ...carWashSweeps(6, 1100),
      { type: 'wait', durationMs: 1200 },
    ],
  },
})];

/** A starting form, never automatically treated as supported gameplay. */
export function unverifiedProfileTemplate(candidate: Pick<GameCandidate, 'id' | 'url' | 'title'>): GameProfile {
  return gameProfileSchema.parse({
    id: `game-${candidate.id.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60)}`,
    name: candidate.title,
    gameUrl: candidate.url,
    verification: 'unverified',
    verificationNotes: 'Template only. Inspect the live game, correct selectors/start/reset steps, and test twice before marking verified. Canvas and controls are not confirmed.',
    viewport: { width: 1080, height: 1920 },
    surface: { selector: 'canvas' },
    ready: { selector: 'canvas' },
    objective: 'Produce an understandable interaction with a visible outcome. Stop if instructions or controls are unclear.',
    controller: { type: 'sparse', maxDecisions: 6 },
  });
}
