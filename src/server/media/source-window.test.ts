import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { mediaExecutables } from './probe.js';
import { runProcess } from './process.js';
import { sourceFreezeVideoFilter, sourceSeekArgs, sourceWindowVideoFilter } from './source-window.js';

// Fast synthetic media regression runs in normal CI, where FFmpeg is installed.
const integration = { timeout: 30_000 };

async function sparseFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-source-clock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { ffmpeg, ffprobe } = mediaExecutables();
  for (const [name, rgb] of [['red', [238, 0, 0]], ['green', [0, 238, 0]], ['blue', [0, 0, 238]]] as const) {
    const pixels = Buffer.alloc(32 * 32 * 3);
    for (let offset = 0; offset < pixels.length; offset += 3) pixels.set(rgb, offset);
    await writeFile(join(directory, `${name}.ppm`), Buffer.concat([Buffer.from('P6\n32 32\n255\n'), pixels]));
  }
  await writeFile(join(directory, 'frames.ffconcat'),
    'ffconcat version 1.0\nfile red.ppm\nduration 2\nfile green.ppm\nduration 1\nfile blue.ppm\nduration 1\nfile blue.ppm\n');
  const source = join(directory, 'sparse.webm');
  await runProcess(ffmpeg, ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(directory, 'frames.ffconcat'),
    '-fps_mode', 'vfr', '-c:v', 'libvpx-vp9', '-lossless', '1', '-g', '999', '-keyint_min', '999', source]);
  const frames = JSON.parse((await runProcess(ffprobe, ['-v', 'error', '-show_entries', 'frame=pts_time,key_frame', '-of', 'json', source])).stdout).frames as Array<{ pts_time: string; key_frame: number }>;
  assert.deepEqual(frames.map(frame => Number(frame.pts_time)), [0, 2, 3, 4], 'The fixture must really contain long VFR holds.');
  assert.deepEqual(frames.map(frame => frame.key_frame), [1, 0, 0, 0], 'Cuts must recover the displayed frame from keyframe pre-roll.');
  return { directory, source, ffmpeg };
}

async function decodeColors(ffmpeg: string, source: string, directory: string, start: number, filter: string, duration: number) {
  const output = join(directory, 'window.mp4');
  await runProcess(ffmpeg, ['-v', 'error', ...sourceSeekArgs(start), '-i', source, '-vf', filter,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(duration), output]);
  const raw = join(directory, 'colors.rgb');
  await runProcess(ffmpeg, ['-v', 'error', '-i', output, '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', raw]);
  const pixels = await readFile(raw);
  return Array.from({ length: pixels.length / 3 }, (_, index) => {
    const rgb = [...pixels.subarray(index * 3, index * 3 + 3)];
    const channel = rgb.indexOf(Math.max(...rgb));
    assert.ok(rgb[channel]! > 200 && rgb.every((value, i) => i === channel || value < 20), 'Every decoded frame retains an unambiguous source marker.');
    return ['red', 'green', 'blue'][channel]!;
  });
}

for (const speed of [1, 2]) {
  test(`sparse source cuts preserve the held frame and transition clock at ${speed}× without an end-frame leak`, integration, async t => {
    const { directory, source, ffmpeg } = await sparseFixture(t);
    // Source [0.5, 3) is red for 1.5 seconds, then green for 1 second.
    // Accurate input seeking would discard red; rebasing the next packet
    // would also advance green and let the excluded blue frame enter.
    const duration = 2.5 / speed;
    const colors = await decodeColors(ffmpeg, source, directory, 0.5, sourceWindowVideoFilter(2.5, speed), duration);
    assert.equal(colors[0], 'red', 'The already displayed frame must survive a cut inside its hold.');
    const transition = colors.indexOf('green') / 30;
    assert.ok(Math.abs(transition - 1.5 / speed) <= 1 / 30 + 1e-9, `Green transition ${transition}s must follow the source clock.`);
    assert.ok(colors.slice(0, colors.indexOf('green')).every(color => color === 'red'));
    assert.ok(colors.slice(colors.indexOf('green')).every(color => color === 'green'), 'Blue at the exclusive source end must never appear.');
    assert.ok(Math.abs(colors.length / 30 - duration) <= 1 / 30 + 1e-9, 'The output must retain the requested window length.');
  });
}

test('freezing inside a sparse hold uses the displayed frame rather than the next future frame', integration, async t => {
  const { directory, source, ffmpeg } = await sparseFixture(t);
  const colors = await decodeColors(ffmpeg, source, directory, 0.5, sourceFreezeVideoFilter(1.2), 1.2);
  assert.equal(colors.length, 36);
  assert.ok(colors.every(color => color === 'red'), 'A source 0.5s freeze must not show the future green frame at 2s.');
});
