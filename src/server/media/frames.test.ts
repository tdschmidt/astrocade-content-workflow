import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { extractVideoFrames } from './frames.js';
import { mediaExecutables } from './probe.js';
import { runProcess } from './process.js';

const integration = { skip: process.env.RUN_FRAME_TESTS !== '1', timeout: 30_000 };
async function fixture(t: TestContext, rate = 30, duration = 2) {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-frames-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.mkv');
  await runProcess(mediaExecutables().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=${rate}`, '-t', String(duration), '-c:v', 'ffv1', source]);
  return { directory, source };
}

test('invalid sampling inputs and prior cancellation fail before accessing media', async () => {
  await assert.rejects(extractVideoFrames('/missing', '/unused', { fps: 4 as 1 }), /only 1 or 8/);
  await assert.rejects(extractVideoFrames('/missing', '/unused', { fps: 8, start_offset: '-1s' }), /nonnegative seconds/);
  await assert.rejects(extractVideoFrames('/missing', '/unused', { fps: 8, end_offset: '1;rm' }), /nonnegative seconds/);
  await assert.rejects(extractVideoFrames('/missing', '/unused', { fps: 8 }, {}, AbortSignal.abort(new Error('Stop now'))), /Stop now/);
});

test('8 FPS windows retain actual frame times, nonzero offsets, and an exclusive end', integration, async t => {
  const { directory, source } = await fixture(t);
  const sampled = await extractVideoFrames(source, join(directory, 'aligned'), { fps: 8, start_offset: '0.5s', end_offset: '1.5s' });
  assert.equal(sampled.frames.length, 8);
  assert.equal(sampled.startSeconds, 0.5);
  assert.equal(sampled.endSeconds, 1.5);
  for (const [index, frame] of sampled.frames.entries()) {
    assert.ok(isAbsolute(frame.path));
    assert.ok(Math.abs(frame.windowSeconds - (frame.sourceSeconds - 0.5)) < 1e-9);
    assert.ok(frame.windowSeconds >= index / 8 && frame.windowSeconds < index / 8 + 0.034);
    assert.ok(frame.sourceSeconds < 1.5, 'the frame exactly at the window end is excluded');
    assert.deepEqual([...(await readFile(frame.path)).subarray(0, 2)], [0xff, 0xd8]);
  }
  assert.equal(sampled.frames[0]!.sourceSeconds, 0.5);
  const betweenFrames = await extractVideoFrames(source, join(directory, 'offset'), { fps: 1, start_offset: '0.53', end_offset: '1.53' });
  assert.equal(betweenFrames.frames.length, 1);
  assert.equal(betweenFrames.frames[0]!.sourceSeconds, 0.533);
  assert.ok(Math.abs(betweenFrames.frames[0]!.windowSeconds - 0.003) < 1e-9, 'first decoded frame is not falsely labeled window t=0');
  await assert.rejects(extractVideoFrames(source, join(directory, 'outside'), { fps: 8, end_offset: '3s' }), /inside the source/);
});

test('sampling does not pad low-FPS footage, and rejects over 360 requested frames', integration, async t => {
  const { directory, source } = await fixture(t, 1, 46);
  const sampled = await extractVideoFrames(source, join(directory, 'sparse'), { fps: 8, start_offset: '0', end_offset: '2' });
  assert.deepEqual(sampled.frames.map(frame => frame.sourceSeconds), [0, 1]);
  const boundary = await extractVideoFrames(source, join(directory, 'boundary'), { fps: 8, end_offset: '45' });
  assert.equal(boundary.frames.length, 45, '360 requested slots are allowed, without manufacturing missing source frames');
  const excessive = join(directory, 'excessive');
  await assert.rejects(extractVideoFrames(source, excessive, { fps: 8 }), /360-frame limit/);
  await assert.rejects(stat(excessive), { code: 'ENOENT' });
  const marker = join(directory, 'sparse', 'preserve.txt');
  await writeFile(marker, 'existing evidence');
  await assert.rejects(extractVideoFrames(source, join(directory, 'sparse'), { fps: 1 }), { code: 'EEXIST' });
  assert.equal(await readFile(marker, 'utf8'), 'existing evidence');
  const empty = join(directory, 'empty');
  await assert.rejects(extractVideoFrames(source, empty, { fps: 8, start_offset: '0.25', end_offset: '0.5' }), /timestamp map/);
  assert.ok(!(await readdir(directory)).includes('empty'), 'a failed extraction removes only its newly created output directory');
});
