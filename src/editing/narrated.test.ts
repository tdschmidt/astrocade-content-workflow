import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import type { Capture } from '../shared/domain.js';
import type { Inference } from '../server/providers/inference.js';
import { narrationWindows, narrationSampleChunks, assertNarratedSelection, overviewLedger, validateOverviewInspection, runNarratedAgentStage, verifySavedNarration } from './narrated.js';
import { mapOverviewChapters, prepareOverviewChapters } from '../../experiments/game-overview/prepare-chapters.js';
import { runProcess } from '../server/media/process.js';
import { extractVideoFrames } from '../server/media/frames.js';
import { mediaExecutables } from '../server/media/probe.js';
import type { EvidenceWindow } from './windows.js';

const capture: Capture = { id: 'sample', runId: 'run', profileId: 'profile', game: { id: 'g', title: 'Example', titleSource: 'visible_text', url: 'https://example.com/game', metrics: [], observations: [] }, path: '/tmp/source.mp4', durationSeconds: 100, width: 720, height: 1280, createdAt: '2026-10-07',
  analysis: { usable: true, reason: 'Observed', mechanic: 'Choices change powers', visualScore: 4, events: [{ startSeconds: 2, endSeconds: 6, event: 'Flight', evidence: 'Actor rises', outcome: 'Lands on roof' }, { startSeconds: 25, endSeconds: 30, event: 'Wall', evidence: 'Wall rises', outcome: 'Barrier appears' }] } };
const windows: EvidenceWindow[] = [{ id: 'one', start: 0, end: 20, basis: 'source-review', observation: 'Flight evidence' }, { id: 'two', start: 30, end: 50, basis: 'source-review', observation: 'Building evidence' }];
const inspection = () => ({ usable: true, reason: 'Two useful mechanics', gameSummary: 'Choose different powers to move and build.', facts: [
  { id: 'flight', fact: 'The actor can fly.', windowId: 'one', start: 2, end: 4, observation: 'Actor rises from street to rooftop.' },
  { id: 'wall', fact: 'A wall can be created.', windowId: 'two', start: 32, end: 35, observation: 'Selected power produces a new wall.' },
], chapters: [{ id: 'opening', shots:[{start:0,end:16}], factIds: ['flight'], rationale: 'Introduce movement and choices.' }, { id: 'building', shots:[{start:30,end:46}], factIds: ['wall'], rationale: 'Show a genuinely different capability.' }], captionPosition: 'upper-middle' as const, exclusions: ['No completed mission demonstrated.'] });
const derived = { path: '/tmp/selected.mp4', sourceSha256: 'b'.repeat(64), provenancePath: '/tmp/provenance.json' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

test('narration candidate context stays inside capture and invalid analysis cannot become evidence', () => {
  const result = narrationWindows(capture);
  assert.deepEqual(result.map(w => [w.start, w.end]), [[0, 13], [20, 37]]);
  assert.throws(() => narrationWindows({ ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 110 }] } }), /invalid source bounds/);
});

test('selected narration cannot bridge unobserved gaps, reuse footage, or pad weak source', () => {
  assert.equal(assertNarratedSelection([{ start: 0, end: 16 }, { start: 30, end: 46 }], windows, 30, 45), 32);
  assert.throws(() => assertNarratedSelection([{ start: 10, end: 35 }], windows, 1, 60), /freshly inspected/);
  assert.throws(() => assertNarratedSelection([{ start: 0, end: 16 }, { start: 2, end: 18 }], windows, 1, 60), /chronological/);
  assert.throws(() => assertNarratedSelection([{ start: 1, end: 3 }], windows, 30, 45), /Do not pad or loop/);
});

test('whole-game overview facts retain original hash/time evidence and opening evidence is local', () => {
  const ledger = overviewLedger(capture, 'a'.repeat(64), inspection(), windows, derived);
  assert.equal(ledger.sourcePath, derived.path);
  assert.equal(ledger.sourceSha256, derived.sourceSha256);
  assert.equal(ledger.gameFacts[1]!.evidence.kind, 'gameplay');
  assert.equal(ledger.gameFacts[1]!.evidence.kind === 'gameplay' && ledger.gameFacts[1]!.evidence.sourceSha256, 'a'.repeat(64));
  const bad = inspection(); bad.chapters[0]!.factIds = ['wall'];
  assert.throws(() => validateOverviewInspection(capture, bad, windows), /actually appear/);
  const unseen = inspection(); unseen.facts[0]!.end = 25;
  assert.throws(() => validateOverviewInspection(capture, unseen, windows), /unseen source/);
  assert.throws(() => validateOverviewInspection(capture, { ...inspection(), usable: false }, windows), /Inadequate overview/);
});

test('a semantic rejection stops after one call and cannot turn into approval on resume', async () => {
  const out = await mkdtemp(join(tmpdir(), 'narrated-rejection-')); let calls = 0;
  const schema = z.object({ approved: z.boolean(), issues: z.array(z.string()) });
  const provider: Inference = { async json<T>(_prompt: string, responseSchema: z.ZodType<T>) { calls++; return responseSchema.parse({ approved: false, issues: ['Repeated failed obstacle'] }); }, async withVideo() { throw new Error('Unexpected video'); } };
  const invoke = () => runNarratedAgentStage(provider, out, 'Review evidence', schema, [], value => value.approved ? [] : value.issues);
  try { await assert.rejects(invoke, /Repeated failed/); assert.equal(calls, 1); await assert.rejects(invoke, /Saved editorial rejection/); assert.equal(calls, 1); }
  finally { await rm(out, { recursive: true, force: true }); }
});

test('one structural plan repair is bounded and keeps original rejected response', async () => {
  const out = await mkdtemp(join(tmpdir(), 'narrated-repair-')); let calls = 0;
  const schema = z.object({ start: z.number() });
  const provider: Inference = { async json<T>(_prompt: string, responseSchema: z.ZodType<T>) { return responseSchema.parse({ start: ++calls === 1 ? -1 : 2 }); }, async withVideo() { throw new Error('Unexpected video'); } };
  try { const result = await runNarratedAgentStage(provider, out, 'Choose window', schema, [], value => value.start < 0 ? ['Start outside source'] : []); assert.equal(result.start, 2); assert.equal(calls, 2); assert.deepEqual(JSON.parse(await readFile(join(out, 'accepted.json'), 'utf8')), { start: 2 }); }
  finally { await rm(out, { recursive: true, force: true }); }
});

test('speech resume rejects changed waveform even when the spoken script still matches', async () => {
  const out = await mkdtemp(join(tmpdir(), 'narrated-waveform-')), audio = join(out, 'voice.wav'), record = join(out, 'narration.json'), checkpoint = join(out, 'waveform.json');
  const script = 'This is the exact generated narration.';
  try {
    await writeFile(audio, 'original waveform');
    await writeFile(record, JSON.stringify({ path: audio, script, voiceLabel: 'Test', words: [{ text: 'This', start: 0, end: 1 }, { text: 'is', start: 1, end: 2 }], alignmentMethod: 'Real test boundaries' }));
    await writeFile(checkpoint, JSON.stringify({ path: audio, sha256: hash('original waveform'), scriptSha256: hash(script) }));
    await verifySavedNarration(record, checkpoint, script);
    await writeFile(audio, 'changed waveform');
    await assert.rejects(() => verifySavedNarration(record, checkpoint, script), /waveform or script changed/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('agent-selected multiple shots retain original chronology and exact derived chapter map',()=>{
 const mapping=mapOverviewChapters([{id:'first',shots:[{start:1,end:5},{start:10,end:16}]},{id:'second',shots:[{start:30,end:38}]}],50);
 assert.deepEqual(mapping.map(s=>[s.originalStart,s.originalEnd,s.derivedStart,s.derivedEnd]),[[1,5,0,4],[10,16,4,10],[30,38,10,18]]);
 assert.throws(()=>mapOverviewChapters([{id:'first',shots:[{start:1,end:5}]},{id:'second',shots:[{start:3,end:8}]}],50),/forward, unique/);
 assert.throws(()=>mapOverviewChapters([{id:'first',shots:[{start:1,end:5}]},{id:'second',shots:[{start:45,end:55}]}],50),/bounds/);
});

test('fractional-frame quantization preserves nominal evidence containment without allowing omitted facts', () => {
  const selected = inspection();
  selected.chapters[0]!.shots = [{ start: 0.05, end: 16 }];
  selected.facts[0]!.start = 0.05;
  selected.facts[0]!.end = 16;
  const chapters = validateOverviewInspection(capture, selected, windows);
  assert.ok(chapters[0]!.sourceShots[0]!.originalEnd < 16);
  assert.ok(16 - chapters[0]!.sourceShots[0]!.originalEnd < 1 / 30);
  selected.facts[0]!.end = 16.01;
  assert.throws(() => validateOverviewInspection(capture, selected, windows), /must actually appear/);
});

test('prepared chapter concatenation keeps the exact frame grid through the final sample', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'overview-grid-'));
  const sourcePath = join(folder, 'source.mp4');
  try {
    await runProcess(mediaExecutables().ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i',
      'testsrc2=size=160x240:rate=30:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
    ], { timeoutMs: 30_000 });
    const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
    const prepared = await prepareOverviewChapters({ sourcePath, sourceSha256, output: join(folder, 'prepared'), chapters: [
      { id: 'first', shots: [{ start: 0.05, end: 1.9 }, { start: 2.1, end: 3.8 }] },
      { id: 'second', shots: [{ start: 4.05, end: 5.8 }, { start: 6, end: 7.8 }] },
    ] });
    const end = prepared.mapping.at(-1)!.derivedEnd;
    assert.ok(Math.abs(prepared.durationSeconds - end) <= 1e-6);
    const frames = await extractVideoFrames(prepared.path, join(folder, 'frames'), { fps: 2, end_offset: `${end}s` });
    assert.ok(frames.frames.at(-1)!.sourceSeconds < end);
    assert.ok(frames.frames.at(-1)!.sourceSeconds >= end - 0.5);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('dense story review splits long selections without gaps, repeats or source-clock changes', () => {
  const chunks = narrationSampleChunks([{ start: 1.25, end: 57.75 }, { start: 70, end: 74 }]);
  assert.deepEqual(chunks, [
    { start: 1.25, end: 31.25, selectionIndex: 0 },
    { start: 31.25, end: 57.75, selectionIndex: 0 },
    { start: 70, end: 74, selectionIndex: 1 },
  ]);
  assert.equal(chunks.reduce((duration, chunk) => duration + chunk.end - chunk.start, 0), 60.5);
  assert.ok(chunks.every(chunk => (chunk.end - chunk.start) * 8 <= 360));
});

test('a concise story can use35seconds of proven progress but cannot pad34seconds', () => {
  const candidates: EvidenceWindow[] = [{ id: 'route', start: 0, end: 40, basis: 'source-review', observation: 'Actual complete progressing route' }];
  assert.equal(assertNarratedSelection([{ start: 1, end: 36 }], candidates, 35, 60), 35);
  assert.throws(() => assertNarratedSelection([{ start: 1, end: 35 }], candidates, 35, 60), /Do not pad or loop/);
});

test('chapter preparation retains the frame actually displayed across a sparse source seek', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'overview-sparse-'));
  try {
    const sourcePath = join(folder, 'sparse.mp4');
    await runProcess(mediaExecutables().ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i',
      'color=red:size=160x240:rate=1:duration=3', '-vf',
      "drawbox=color=blue:t=fill:enable='gte(t,1)'", '-c:v', 'libx264', '-g', '1', '-pix_fmt', 'yuv420p', sourcePath,
    ], { timeoutMs: 30_000 });
    const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
    const prepared = await prepareOverviewChapters({ sourcePath, sourceSha256, output: join(folder, 'prepared'), chapters: [
      { id: 'red', shots: [{ start: 0.2, end: 0.8 }] },
      { id: 'blue', shots: [{ start: 1.2, end: 1.8 }] },
    ] });
    const pixels = join(folder, 'pixels.rgb');
    await runProcess(mediaExecutables().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', prepared.path,
      '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', pixels], { timeoutMs: 30_000 });
    const bytes = await readFile(pixels);
    assert.equal(bytes.length, 36 * 3);
    for (let frame = 0; frame < 36; frame++) {
      const red = bytes[frame * 3]!, blue = bytes[frame * 3 + 2]!;
      assert.ok(frame < 18 ? red > 200 && blue < 30 : blue > 200 && red < 30, `Unexpected held source frame at ${frame}`);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
