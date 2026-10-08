import carWashProfile from './profiles/car-wash-simulator.json' with { type: 'json' };
import stickmanArcherProfile from './profiles/stickman-archer.json' with { type: 'json' };
import { gameProfileSchema, type GameProfile } from './schema.js';

const gameFrame = ['iframe[title="Astrocade Game"]'];

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
}), gameProfileSchema.parse(carWashProfile), gameProfileSchema.parse(stickmanArcherProfile)];
