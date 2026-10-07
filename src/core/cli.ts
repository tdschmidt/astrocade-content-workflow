import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Configuration } from '../server/config.js';
import { coreRunSchema, runPipeline, type CoreStage } from './pipeline.js';

const { values } = parseArgs({ options: {
  stage: { type: 'string', default: 'all' }, resume: { type: 'string' }, model: { type: 'string' },
  game: { type: 'string' }, candidates: { type: 'string', default: '3' }, help: { type: 'boolean', short: 'h' },
} });

if (values.help) {
  console.log(`Astrocade: discover → inspect/learn → capture → edit

npm run pipeline -- [--stage discover|capture|edit|all] [--game ID_OR_SLUG] [--candidates 1-5]
npm run pipeline -- --resume data/runs/RUN_DIRECTORY [--model MODEL]

Default: inspect up to three provisional choices, record supported games, compare visible results, and render one highlight.
Outputs: report.md, trace.jsonl, discovery/inspection/control evidence, original recordings, edit.json, highlight-*.mp4, caption.txt.
The trace shows observable actions and concise decision summaries, not private internal reasoning. Publishing is manual.
Configure GEMINI_API_KEY in .env. Existing saved keys are also read. FFmpeg with libass and Playwright Chromium are required.`);
} else {
  if (!['discover', 'capture', 'edit', 'all'].includes(values.stage)) throw new Error('Stage must be discover, capture, edit, or all.');
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Stopped by the operator. Completed artifacts are preserved.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const directory = resolve(values.resume ?? `data/runs/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
  console.log(`Run directory: ${directory}`);
  try {
    const config = await Configuration.open();
    const model = values.model ?? (values.resume ? coreRunSchema.parse(JSON.parse(await readFile(`${directory}/run.json`, 'utf8'))).model : 'gemini-3.5-flash');
    const run = await runPipeline({ directory, model, stage: values.stage as CoreStage, game: values.game, shortlistSize: Number(values.candidates), signal: abort.signal }, config);
    console.log(`\n${run.status === 'complete' ? 'Ready' : 'Stage complete'}: ${directory}/report.md`);
  } catch (error) {
    // Detailed sanitized stage errors are in the trace; never dump SDK request objects or credentials.
    console.error(`Run stopped (${error instanceof Error ? error.name : 'error'}). See ${directory}/report.md and resume with --resume ${directory}.`);
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
