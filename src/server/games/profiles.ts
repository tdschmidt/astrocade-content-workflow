import { gameProfileSchema, type GameCandidate, type GameProfile } from './schema.js';

// Actual Astrocade access is currently unavailable. Do not claim a tested controller.
export const verifiedProfiles: GameProfile[] = [];

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
