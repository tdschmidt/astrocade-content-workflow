import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runProcess } from '../../src/server/media/process.js';
import { probeMedia } from '../../src/server/media/probe.js';
import { enforceEncodedAudioPeak, measureEncodedAudio } from './audio-peak.js';
import { experimentTools } from './render.js';

test('measured AAC overshoot is attenuated without changing video packets or soundtrack timing', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'encoded-peak-'));
  const tools = experimentTools(), ffmpeg = tools.ffmpegPath ?? 'ffmpeg';
  try {
    const path = join(outputDirectory, 'loud.mp4');
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=30:d=3',
      '-f', 'lavfi', '-i', 'sine=frequency=733:sample_rate=48000:duration=3', '-af', 'volume=12',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', path]);
    assert.ok(Number((await measureEncodedAudio(ffmpeg, path)).input_tp) > -1, 'Fixture exercises the actual encoded peak failure');
    const result = await enforceEncodedAudioPeak({ ffmpeg, path, outputDirectory });
    assert.ok(result.attempts.length >= 1 && result.attempts.length <= 2);
    assert.ok(Number(result.measurement.input_tp) <= -1);
    assert.ok(result.attempts.every(attempt => attempt.gainDb < 0));
    const frameHashes = async (input: string) => (await runProcess(ffmpeg, ['-v', 'error', '-i', input, '-map', '0:v:0', '-f', 'framemd5', '-'])).stdout;
    assert.equal(await frameHashes(path), await frameHashes(result.path), 'Every decoded video frame and timestamp stays identical');
    const before = await probeMedia(path, tools), after = await probeMedia(result.path, tools);
    assert.ok(Math.abs(before.durationSeconds - after.durationSeconds) <= 1 / 30);
    const accepted = await enforceEncodedAudioPeak({ ffmpeg, path: result.path, outputDirectory });
    assert.equal(accepted.path, result.path);
    assert.deepEqual(accepted.attempts, []);
  } finally { await rm(outputDirectory, { recursive: true, force: true }); }
});
