import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Configuration } from '../server/config.js';
import { coreRunSchema, runPipeline, type CoreStage } from './pipeline.js';
import { editorSettingsSchema, type EditorRequest } from '../editing/contracts.js';
import { contentBriefSchema } from '../shared/content.js';

const { values } = parseArgs({ options: {
  provider: { type: 'string' }, stage: { type: 'string', default: 'all' }, resume: { type: 'string' }, model: { type: 'string' },
  game: { type: 'string' }, candidates: { type: 'string', default: '3' }, help: { type: 'boolean', short: 'h' },
  format: { type: 'string' }, style: { type: 'string' }, narration: { type: 'string' },
  'source-windows': { type: 'string' }, 'edit-feedback': { type: 'string' }, 'story-source': { type: 'string' },
  play: { type: 'string' }, 'capture-seconds': { type: 'string' }, 'capture-goal': { type: 'string' }, brief: { type: 'string' }, 'from-run': { type: 'string' }, presenter: { type: 'string' },
} });

if (values.help) {
  console.log(`Astrocade: discover → inspect/learn → capture → analyze → agent edit → local video

npm run pipeline -- [--provider codex|gemini] [--format meme|overview|story|legacy] [--game PUBLIC_URL] [--capture-seconds 5-600]
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY --format meme
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY --format overview --narration local
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY --format story --story-source FACT_LEDGER.json
npm run pipeline -- --resume data/runs/RUN_DIRECTORY
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY --stage analyze

Default: Codex-authenticated inference, thorough native gameplay exploration, then a 15–25s meme edit. The editorial agent chooses real source moments, synchronizes its principal climax and music, and retains moving aftermath. Overview: hook-first game premise/choices/appeal with real narration, roughly30–45s. Story: sourced narration over independently reviewed sustained gameplay, roughly35–60s. Legacy retains the earlier silent editor for saved-run reproduction.

--stage discover|capture|analyze|edit|all (default all). Analysis needs --from-run or --resume with saved capture. A stage preserves its artifacts for continuation.
--play timed|feedback|auto (default auto for new reels); --candidates 1-5 (default3); --capture-goal TEXT (max800 characters, explicit --game required). Recording budget includes model latency; slow feedback cannot provide reflex play.
--style auto|troll-freeze|ironic-fail|velocity applies to meme editing. --source-windows JSON supplies source-hashed review leads; the agent freshly inspects them and chooses the actual cuts. --edit-feedback TEXT_FILE requests an evidence-based revision.
--narration local|gemini defaults local (Kokoro + real Faster Whisper recognition; see local-speech setup). --story-source supplies a grounded fact ledger and is required for story. Existing audio/model assets are verified; missing prerequisites fail explicitly.
--brief JSON supplies the audience and voice. --model MODEL changes the selected inference model. --presenter VIDEO is supported only with --format legacy.

--from-run creates a new immutable editorial revision without recapturing. --resume reuses saved configuration and verifies all source/input/output hashes. It cannot change the brief, format, source windows or feedback. Failed attempts preserve evidence. Ctrl-C preserves completed stages.

Outputs: run.json, report.md, trace.jsonl, original gameplay, source-frame evidence, agent plan, captions and final MP4. Videos stay local; there is no GUI, account creation or publishing.
Codex: install Codex CLI and sign in with ChatGPT. Gemini: configure GEMINI_API_KEY. FFmpeg with libass and Playwright Chromium are required.`);
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
    const provider = (values.provider ?? saved?.provider ?? 'codex') as 'gemini' | 'codex';
    const model = values.model ?? (saved?.provider === provider ? saved.model : provider === 'codex' ? 'gpt-5.6-sol' : 'gemini-3.5-flash');
    const editorialFlags = values.format || values.style || values.narration || values['source-windows'] || values['edit-feedback'] || values['story-source'];
    let editor: EditorRequest | undefined;
    if (!values.resume || editorialFlags) {
      const settings = editorSettingsSchema.pick({ format: true, style: true, narration: true }).parse({
        format: values.format ?? (values.resume ? saved?.editor?.format ?? 'legacy' : 'meme'),
        style: values.style ?? saved?.editor?.style, narration: values.narration ?? saved?.editor?.narration,
      });
      editor = { ...settings, windowsPath: values['source-windows'] ?? (values.resume ? saved?.editor?.windows?.path : undefined),
        feedbackPath: values['edit-feedback'] ?? (values.resume ? saved?.editor?.feedback?.path : undefined),
        storySourcePath: values['story-source'] ?? (values.resume ? saved?.editor?.storySource?.path : undefined) };
    }
    const run = await runPipeline({ directory, model, provider, editor, stage: values.stage as CoreStage, game: values.game, captureGoal: values['capture-goal'], playMode: values.play as 'timed' | 'feedback' | 'auto' | undefined, contentBrief, captureSeconds: values['capture-seconds'] === undefined ? undefined : Number(values['capture-seconds']), fromRun: values['from-run'], presenterPath: values.presenter, shortlistSize: Number(values.candidates), signal: abort.signal }, config);
    console.log(`\n${run.status === 'complete' ? 'Ready' : 'Stage complete'}: ${directory}/report.md`);
  } catch (error) {
    // Detailed sanitized stage errors are in the trace; never dump SDK request objects or credentials.
    console.error(`Run stopped (${error instanceof Error ? error.name : 'error'}). See ${directory}/report.md and resume with --resume ${directory}.`);
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
