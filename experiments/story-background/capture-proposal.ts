import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runCaptureAttempt } from '../../src/server/games/runner.js';
import { gameProfileSchema } from '../../src/server/games/schema.js';
import { createFeedbackController } from '../../src/server/games/feedback.js';
import { CodexServices } from '../../src/server/providers/codex.js';
import { storyRouteController } from './route-controller.js';

// Explicit bounded experiment: preserve medium-confidence proposals as unverified
// and judge actual footage. This does not change the main pipeline's acceptance.
const [inspectionDirectory, outputDirectory] = process.argv.slice(2);
if (!inspectionDirectory || !outputDirectory) throw new Error('Usage: capture-proposal.ts INSPECTION_DIR NEW_OUTPUT_DIR');
const dir = resolve(outputDirectory); await mkdir(dir);
const feedback = process.argv.includes('--feedback');
const inspection = JSON.parse(await readFile(resolve(inspectionDirectory, 'inspection.json'), 'utf8'));
const proposal = JSON.parse(await readFile(resolve(inspectionDirectory, 'timed-assessment.json'), 'utf8'));
if (!proposal.supported || !proposal.actions?.length) throw new Error('No observed-input proposal exists');
const activation = inspection.performedStart ? [
  { type: 'click', target: { selector: inspection.performedStart.selector, frames: inspection.startTargetFrames } },
  { type: 'wait', durationMs: 1500 },
] : [];
// This exact reward label was observed in the inspection and blocked the first
// captured route. Dismiss it through its native button before recording.
const observedReward = /DAILY REWARD[\s\S]*CLAIM/.test(inspection.text);
if (observedReward) activation.push(
  { type: 'click', target: { selector: 'button:text-is("CLAIM")', frames: inspection.startTargetFrames } },
  { type: 'wait', durationMs: 500 },
);
const profile = gameProfileSchema.parse({
  id: 'story-background-unverified-route', name: 'Popular Obby route probe',
  gameUrl: inspection.gameUrl, verification: 'unverified',
  verificationNotes: 'Parent explicitly authorized a bounded native route probe from a medium-confidence agent proposal; inspect real output before editorial use.',
  viewport: inspection.viewport, surface: inspection.surface, ready: inspection.ready, setup: [...inspection.setup, ...activation],
  start: proposal.start ?? [],
  reset: [], focus: 'focus', objective: feedback ? 'Capture at least 45 seconds of distinct competent parkour movement across the observed platforms and checkpoints. The final 38-second narration background may cut documented inference pauses, but must not repeat footage or show repeated deaths. Observe platform alignment and make small native movement/jump corrections. Remain on safe platforms while observing; do not repeatedly rerun a failed blind route.' : proposal.objective,
  maxDurationMs: feedback ? 360_000 : 60_000,
  controller: feedback ? { type: 'sparse', maxDecisions: 26, allowedKeys: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'], allowPointer: false, allowLook: false,
    instructions: 'Visible controls: WASD/arrow movement, Space jump, drag to look. This probe uses only keyboard controls. The actual 45-second W+Space hold repeatedly falls near the later pink platform and resets to stage 1; removing all sideways input was insufficient. A prior mixed lateral route briefly reached stage 2. Current geometry must guide corrections; those are observations, not guaranteed mechanics. Do not open GLOBAL CHAT: it opens a blocking modal. The reward is already dismissed. Capture actual route progression with successful landings; use safe observation points and verify each controlled action.' }
    : { type: 'timed', actions: proposal.actions, repetitions: 1 },
});
const actions: unknown[] = [];
const events: unknown[] = [];
const provider = new CodexServices({ reasoningModel: 'default' }, e => { events.push(e); process.stderr.write(JSON.stringify(e) + '\n'); });
const decide = process.argv.includes('--story-feedback') ? storyRouteController(provider, resolve(dir, 'feedback')) : feedback ? createFeedbackController(profile, provider, resolve(dir, 'feedback'), undefined,
  { captureGoal: profile.objective, rejectIf: 'Do not call repeated falls, idle pauses or menu exploration usable background. Need genuine sustained route progress.', editingStyle: 'episode', maxDurationMs: profile.maxDurationMs }) : undefined;
await writeFile(resolve(dir, 'request.json'), JSON.stringify({ profile, proposal, inspectionDirectory: resolve(inspectionDirectory), unverifiedProbeAuthorized: true }, null, 2));
try {
  const result = await runCaptureAttempt({ profile, outputPath: resolve(dir, 'source.webm'), allowUnverified: true,
    recorderOptions: { ffmpeg: { ffmpegPath: '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' } },
    onProgress: e => process.stderr.write(JSON.stringify(e) + '\n'), onAction: e => { actions.push(e); },
    decide, observeActionFrames: feedback,
  });
  await writeFile(resolve(dir, 'capture.json'), JSON.stringify(result, null, 2));
  console.log(result.artifact.path);
} catch (error) {
  await writeFile(resolve(dir, 'error.json'), JSON.stringify({ message: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally {
  await writeFile(resolve(dir, 'native-inputs.json'), JSON.stringify(actions, null, 2));
  await writeFile(resolve(dir, 'provider-events.json'), JSON.stringify(events, null, 2));
}
