import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CodexServices } from '../../src/server/providers/codex.js';
import { inspectGame, learnGameProfile, type CaptureIntent } from '../../src/server/games/learning.js';
import { runCaptureAttempt } from '../../src/server/games/runner.js';
import { gameCandidateSchema } from '../../src/server/games/schema.js';
import { inspectSettledGame } from './settled-inspection.js';

const candidates = {
  obby: { id: '01M3WBJ6P4T8S4ZES9JV3T1616', title: 'POPULAR OBBY', url: 'https://www.astrocade.com/games/popular-obby/01M3WBJ6P4T8S4ZES9JV3T1616' },
  rail: { id: '01KYNNYEY1VXE2HYZQDA71M27Z', title: 'Rail Runner', url: 'https://www.astrocade.com/games/rail-runner/01KYNNYEY1VXE2HYZQDA71M27Z' },
  onelife: { id: '01M492C4VHV0E4096R6MS2T25W', title: 'ONE LIFE OBBY', url: 'https://www.astrocade.com/games/one-life-obby/01M492C4VHV0E4096R6MS2T25W' },
  astro: { id: '01M353S455XAWFZMRC3DVWZNJ3', title: 'Astro Runner', url: 'https://www.astrocade.com/games/astro-runner/01M353S455XAWFZMRC3DVWZNJ3' },
  egg: { id: '01M3GC76Y5EN7XVYYPKQS6FEDK', title: 'Jump To Steal An Egg', url: 'https://www.astrocade.com/games/jump-to-steal-an-egg/01M3GC76Y5EN7XVYYPKQS6FEDK' },
};
const kind = process.argv[2] as keyof typeof candidates;
if (!candidates[kind] || !process.argv[3]) throw new Error('Usage: node --import tsx experiments/story-background/capture-background.ts obby|rail|onelife|astro|egg NEW_OUTPUT_DIRECTORY');
const directory = resolve(process.argv[3]);
await mkdir(directory, { recursive: false });
const events: unknown[] = [], actions: unknown[] = [];
const provider = new CodexServices({ reasoningModel: 'default' }, event => {
  events.push(event); process.stderr.write(`${JSON.stringify(event)}\n`);
});
const candidate = gameCandidateSchema.parse({ ...candidates[kind], titleSource: 'image_alt', metrics: [], observations: [] });
const intent: CaptureIntent = {
  captureGoal: 'Background gameplay for an unrelated spoken story, not a short payoff montage. Aim for at least 40 seconds of satisfying progression through changing situations: running, dodging obstacles, collecting, driving or accessible traversal. Parkour is optional; prefer a game whose observed controls allow competent movement at available input latency. A continuous 40–60 second native timed input sequence without inference pauses is useful. Prefer smooth competent route progress with observed controls; avoid menus, shops, attacks, stop-and-think pauses, repeated death/reset, spinning camera or idle waiting. Use only observed native input mappings. Repeated early-course approaches are not usable new progress even if their failures could be trimmed. If a bounded probe repeatedly fails the same transition, stop and propose an easier runner/dodging/traversal candidate instead of planning a montage of retries. This is an unverified route attempt: never claim it will succeed or pretend to react to unseen hazards.',
  rejectIf: 'No clearly observed movement/jump controls or plausible route; only menu/idle/cosmetic actions; an open-loop sequence cannot reasonably create useful traversal. Do not invent controls to satisfy duration. Record limitations honestly.',
  maxDurationMs: 120_000,
  editingStyle: 'episode',
};
await writeFile(resolve(directory, 'capture-request.json'), JSON.stringify({ candidate, intent, provider: 'CodexServices', modelSetting: 'default', source: 'public native gameplay', freshCaptureAuthorizedByParent: true }, null, 2));
try {
  const inspection = process.argv.includes('--settle')
    ? await inspectSettledGame(candidate, resolve(directory, 'inspection'))
    : await inspectGame(candidate, resolve(directory, 'inspection'), undefined, provider);
  const learned = await learnGameProfile(inspection, candidate, provider, undefined, intent);
  await writeFile(resolve(directory, 'learned.json'), JSON.stringify(learned, null, 2));
  if (!learned.profile) {
    process.stdout.write('No supported timed profile; no capture started.\n');
  } else {
    const result = await runCaptureAttempt({
      profile: learned.profile, outputPath: resolve(directory, 'source.webm'), allowUnverified: true,
      recorderOptions: { ffmpeg: { ffmpegPath: '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' } },
      onProgress: event => process.stderr.write(`${JSON.stringify(event)}\n`),
      onAction: event => { actions.push(event); },
    });
    await writeFile(resolve(directory, 'capture.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${result.artifact.path}\n`);
  }
} catch (error) {
  await writeFile(resolve(directory, 'error.json'), JSON.stringify({ message: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally {
  await writeFile(resolve(directory, 'provider-events.json'), JSON.stringify(events, null, 2));
  await writeFile(resolve(directory, 'native-inputs.json'), JSON.stringify(actions, null, 2));
}
