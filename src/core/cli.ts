import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Configuration } from '../server/config.js';
import { coreRunSchema, runPipeline, type CoreStage } from './pipeline.js';
import { contentBriefSchema } from '../shared/content.js';

const { values } = parseArgs({ options: {
  provider: { type: 'string' }, stage: { type: 'string', default: 'all' }, resume: { type: 'string' }, model: { type: 'string' },
  game: { type: 'string' }, candidates: { type: 'string', default: '3' }, help: { type: 'boolean', short: 'h' },
  play: { type: 'string' }, 'capture-seconds': { type: 'string' }, 'capture-goal': { type: 'string' }, brief: { type: 'string' }, 'from-run': { type: 'string' }, presenter: { type: 'string' },
} });

if (values.help) {
  console.log(`Astrocade: discover → inspect/learn → capture → analyze → edit

npm run pipeline -- [--provider gemini|codex] [--stage discover|capture|analyze|edit|all] [--play timed|feedback|auto] [--game ID_OR_SLUG] [--candidates 1-5] [--capture-seconds 5-600] [--brief PATH.json]
npm run pipeline -- --resume data/runs/RUN_DIRECTORY [--model MODEL]
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY [--brief PATH.json] [--presenter GENERATED_VIDEO.mp4]
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY --stage analyze
npm run pipeline -- --provider codex --play feedback --game PUBLIC_ASTROCADE_GAME_URL

Default: inspect up to three provisional choices, learn and explore supported games, then render a gameplay reel with several distinct moments in at most 15 seconds. New default-brief runs use --play auto; saved runs retain their mode. An explicit game URL is inspected directly.
Feedback mode: learn controls, practice and explore supported gameplay, then trim the longer source into a reel. New reel feedback profiles allow up to ten minutes by default and observe frames during action batches so transient effects can be learned. Saved profiles retain their limits. Slow model calls cannot supply reflex control.
Auto mode: reuse a tested timed profile when available. For unfamiliar reel games, assess latency-tolerant screenshot feedback first, then timed controls if unsupported. Legacy episode runs try timed controls first. Both assessments share one inspection; provider errors do not trigger a fallback.
Capture budget: --capture-seconds bounds recording wall time, including inference, and guides a new control plan. It is separate from the at-most-15-second edit; exploration can finish earlier when useful gameplay coverage is complete.
Capture goal: --game URL --capture-goal "..." records a specific progression or feature-exploration objective. It guides learning and play, never proves an outcome, and cannot be changed on resume. Omit it for the default thorough exploration goal.
Editorial brief: optional JSON with audience, voice, hookExamples, format sources, dated trend evidence, and editingStyle: reel or episode. The new default is reel; older briefs without editingStyle preserve their episode behavior. Resumes reuse the saved brief; start a new run to change it.
Re-edit: --from-run creates a new run referencing saved gameplay, with a new edit and no recapture. It inherits the original brief unless --brief is supplied. Changing editingStyle reanalyzes the source for that format; unchanged analyses are reused. --from-run and --resume cannot be combined.
Analysis only: --stage analyze requires --resume or --from-run with saved recordings. It verifies the source files, saves footage analysis and pauses before editorial selection, script drafting or rendering. Analysis can report unusable footage without requiring an edit.
Presenter: --presenter adds a supplied fictional AI commentator video; generation is separate. It is saved with a file hash and cannot change on resume. New edits are faceless unless --presenter is supplied.
Outputs: report.md, trace.jsonl, content-brief.json, discovery/inspection/control evidence, original recordings, edit.json, highlight-*.mp4, caption.txt.
The trace shows observable actions and concise decision summaries, not private internal reasoning. Publishing is manual.
Gemini (default): configure GEMINI_API_KEY in .env; existing saved keys are also read.
Codex: install the Codex CLI, run codex login using ChatGPT, then pass --provider codex. This uses your Codex allowance/credits and refuses API-key billing. FFmpeg with libass and Playwright Chromium are required.`);
} else {
  if (values.resume && values['from-run']) throw new Error('--resume and --from-run are mutually exclusive.');
  if (values['from-run'] && !['all', 'analyze', 'edit'].includes(values.stage)) throw new Error('--from-run only supports --stage analyze or edit.');
  if (!['discover', 'capture', 'analyze', 'edit', 'all'].includes(values.stage)) throw new Error('Stage must be discover, capture, analyze, edit, or all.');
  if (values.stage === 'analyze' && !values.resume && !values['from-run']) throw new Error('--stage analyze requires --resume or --from-run with saved recordings.');
  if (values.provider && !['gemini', 'codex'].includes(values.provider)) throw new Error('Provider must be gemini or codex.');
  if (values.play && !['timed', 'feedback', 'auto'].includes(values.play)) throw new Error('Play mode must be timed, feedback, or auto.');
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Stopped by the operator. Completed artifacts are preserved.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const directory = resolve(values.resume ?? `data/runs/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
  console.log(`Run directory: ${directory}`);
  try {
    const config = await Configuration.open();
    const sourceDirectory = values.resume ?? values['from-run'];
    const saved = sourceDirectory ? coreRunSchema.parse(JSON.parse(await readFile(resolve(sourceDirectory, 'run.json'), 'utf8'))) : undefined;
    const contentBrief = values.brief ? contentBriefSchema.parse(JSON.parse(await readFile(resolve(values.brief), 'utf8'))) : undefined;
    const provider = (values.provider ?? saved?.provider ?? 'gemini') as 'gemini' | 'codex';
    const model = values.model ?? (saved?.provider === provider ? saved.model : provider === 'codex' ? 'gpt-5.6-sol' : 'gemini-3.5-flash');
    const run = await runPipeline({ directory, model, provider, stage: values.stage as CoreStage, game: values.game, captureGoal: values['capture-goal'], playMode: values.play as 'timed' | 'feedback' | 'auto' | undefined, contentBrief, captureSeconds: values['capture-seconds'] === undefined ? undefined : Number(values['capture-seconds']), fromRun: values['from-run'], presenterPath: values.presenter, shortlistSize: Number(values.candidates), signal: abort.signal }, config);
    console.log(`\n${run.status === 'complete' ? 'Ready' : 'Stage complete'}: ${directory}/report.md`);
  } catch (error) {
    // Detailed sanitized stage errors are in the trace; never dump SDK request objects or credentials.
    console.error(`Run stopped (${error instanceof Error ? error.name : 'error'}). See ${directory}/report.md and resume with --resume ${directory}.`);
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
