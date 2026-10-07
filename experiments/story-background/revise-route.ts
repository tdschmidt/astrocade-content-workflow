import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CodexServices } from '../../src/server/providers/codex.js';
import { plannedInputActionSchema } from '../../src/server/games/schema.js';

const [inspectionDirectory, captureDirectory, sheetPath, outputDirectory] = process.argv.slice(2);
if (!outputDirectory) throw new Error('Usage: revise-route.ts INSPECTION CAPTURE CONTACT_SHEET NEW_OUTPUT');
const output = resolve(outputDirectory); await mkdir(output);
const inspection = await readFile(resolve(inspectionDirectory!, 'inspection.json'), 'utf8');
const request = await readFile(resolve(captureDirectory!, 'request.json'), 'utf8');
const inputLog = await readFile(resolve(captureDirectory!, 'native-inputs.json'), 'utf8');
const image = await readFile(resolve(sheetPath!));
const prompt = `You are the native gameplay capture agent. Propose ONE bounded revision for smooth parkour background, using only observed controls and the actual captured contact sheet. Do not invent completion or hidden state. The 4-column contact sheet is chronological every 3 seconds from 0 through 42; the final cell is empty. The first take had a blocking daily reward; this supplied take dismissed it natively before recording. Actual supplied take reaches stage 2 but also falls repeatedly. Determine whether removing uncalibrated lateral input is a reasonable next controlled probe: the original plan guessed lateral correction without seeing the later route. If supported, propose at most 55 seconds of native inputs (each <=6000 ms), no inference waits, only grounded visible mappings. No need promise perfect play. Return supported false if no useful revision is justified. Keep the proposal explicitly medium confidence until actual video is reviewed.\nINSPECTION\n${inspection}\nCURRENT PLAN\n${request}\nACTUAL INPUT TIMELINE\n${inputLog}`;
const schema = z.object({ supported: z.boolean(), confidence: z.literal('medium'), objective: z.string(), start: z.array(plannedInputActionSchema), actions: z.array(plannedInputActionSchema).max(60), allowLook: z.literal(false), evidence: z.array(z.string()), limitations: z.array(z.string()) });
await writeFile(resolve(output, 'prompt.txt'), prompt);
await writeFile(resolve(output, 'provenance.json'), JSON.stringify({ provider: 'CodexServices', model: 'default', sheetPath: resolve(sheetPath!), imageSha256: createHash('sha256').update(image).digest('hex'), sourceCapture: resolve(captureDirectory!), nativeInputs: true }, null, 2));
await copyFile(resolve(inspectionDirectory!, 'inspection.json'), resolve(output, 'inspection.json'));
const events: unknown[] = [];
const provider = new CodexServices({ reasoningModel: 'default' }, e => { events.push(e); process.stderr.write(JSON.stringify(e) + '\n'); });
try {
 const proposal = await provider.json(prompt, schema, [{ type: 'image', data: image.toString('base64'), mime_type: 'image/jpeg' }]);
 await writeFile(resolve(output, 'timed-assessment.json'), JSON.stringify(proposal, null, 2));
} finally { await writeFile(resolve(output, 'provider-events.json'), JSON.stringify(events, null, 2)); }
