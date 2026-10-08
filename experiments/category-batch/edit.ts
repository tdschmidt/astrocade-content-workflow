// Compatibility entry point. New workflows use npm run pipeline -- --format meme.
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { coreRunSchema } from '../../src/core/pipeline.js';
import { renderMeme } from '../../src/editing/meme.js';
import { editorSettingsSchema } from '../../src/editing/contracts.js';

const { values } = parseArgs({ options: {
  run: { type: 'string' }, out: { type: 'string' }, game: { type: 'string' },
  style: { type: 'string', default: 'auto' }, feedback: { type: 'string' }, windows: { type: 'string' }, 'prepare-only': { type: 'boolean' },
} });
if (!values.run || !values.out) throw new Error('Use --run RUN_DIR --out NEW_OUTPUT_DIR; prefer npm run pipeline -- --from-run RUN_DIR --format meme.');
const runPath = resolve(values.run, 'run.json'), run = coreRunSchema.parse(JSON.parse(await readFile(runPath, 'utf8')));
const captures = run.attempts.filter(attempt => attempt.capture);
const id = values.game ?? run.selectedGameId ?? (captures.length === 1 ? captures[0]!.gameId : undefined);
const attempt = captures.find(item => item.gameId === id);
if (!attempt?.capture || !attempt.sourceSha256) throw new Error('Choose a saved capture with its original source hash.');
const result = await renderMeme({ capture: attempt.capture, sourceSha256: attempt.sourceSha256, runPath,
  output: resolve(values.out), model: run.provider === 'codex' ? run.model : 'default', brief: run.contentBrief,
  captureFeedbackPath: attempt.feedbackPath, style: editorSettingsSchema.shape.style.parse(values.style),
  feedbackPath: values.feedback, windowsPath: values.windows, prepareOnly: values['prepare-only'],
});
console.log(JSON.stringify(result));
