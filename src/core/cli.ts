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
  play: { type: 'string' }, brief: { type: 'string' },
} });

if (values.help) {
  console.log(`Astrocade: discover → inspect/learn → capture → edit

npm run pipeline -- [--provider gemini|codex] [--stage discover|capture|edit|all] [--game ID_OR_SLUG] [--candidates 1-5] [--brief PATH.json]
npm run pipeline -- --resume data/runs/RUN_DIRECTORY [--model MODEL]
npm run pipeline -- --provider codex --play feedback --game PUBLIC_ASTROCADE_GAME_URL

Default: inspect up to three provisional choices, record supported games, compare visible results, and render one highlight.
Feedback mode: inspect slow/input-paced games, observe each action batch, adapt to current screenshots, and stop at a visible outcome or the bounded decision/time limit. Fast reflex games are skipped. --play timed is the default. An explicit game URL is inspected directly.
Editorial brief: optional JSON with audience, voice, hookExamples, format sources, and dated trend evidence. A default brief is saved on new runs. Resumes reuse that brief; start a new run to change it.
Outputs: report.md, trace.jsonl, content-brief.json, discovery/inspection/control evidence, original recordings, edit.json, highlight-*.mp4, caption.txt.
The trace shows observable actions and concise decision summaries, not private internal reasoning. Publishing is manual.
Gemini (default): configure GEMINI_API_KEY in .env; existing saved keys are also read.
Codex: install the Codex CLI, run codex login using ChatGPT, then pass --provider codex. This uses your Codex allowance/credits and refuses API-key billing. FFmpeg with libass and Playwright Chromium are required.`);
} else {
  if (!['discover', 'capture', 'edit', 'all'].includes(values.stage)) throw new Error('Stage must be discover, capture, edit, or all.');
  if (values.provider && !['gemini', 'codex'].includes(values.provider)) throw new Error('Provider must be gemini or codex.');
  if (values.play && !['timed', 'feedback'].includes(values.play)) throw new Error('Play mode must be timed or feedback.');
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Stopped by the operator. Completed artifacts are preserved.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const directory = resolve(values.resume ?? `data/runs/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
  console.log(`Run directory: ${directory}`);
  try {
    const config = await Configuration.open();
    const saved = values.resume ? coreRunSchema.parse(JSON.parse(await readFile(`${directory}/run.json`, 'utf8'))) : undefined;
    const contentBrief = values.brief ? contentBriefSchema.parse(JSON.parse(await readFile(resolve(values.brief), 'utf8'))) : undefined;
    const provider = (values.provider ?? saved?.provider ?? 'gemini') as 'gemini' | 'codex';
    const model = values.model ?? (saved?.provider === provider ? saved.model : provider === 'codex' ? 'gpt-5.6-sol' : 'gemini-3.5-flash');
    const run = await runPipeline({ directory, model, provider, stage: values.stage as CoreStage, game: values.game, playMode: values.play as 'timed' | 'feedback' | undefined, contentBrief, shortlistSize: Number(values.candidates), signal: abort.signal }, config);
    console.log(`\n${run.status === 'complete' ? 'Ready' : 'Stage complete'}: ${directory}/report.md`);
  } catch (error) {
    // Detailed sanitized stage errors are in the trace; never dump SDK request objects or credentials.
    console.error(`Run stopped (${error instanceof Error ? error.name : 'error'}). See ${directory}/report.md and resume with --resume ${directory}.`);
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
