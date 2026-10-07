import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mediaExecutables, probeMedia, type MediaTools } from './probe.js';
import { runProcess } from './process.js';
import { renderPortrait } from './render.js';

test('portrait renderer produces validated video, captions, and complete audio', { skip: process.env.RUN_RENDER_TESTS !== '1', timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-render-test-'));
  const source = join(directory, 'source.mp4');
  const audio = join(directory, 'narration.wav');
  const output = join(directory, 'portrait.mp4');
  const tools: MediaTools = { fontPath: fileURLToPath(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)) };
  const { ffmpeg } = mediaExecutables(tools);
  try {
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', source]);
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2.5', '-af', 'volume=0.05', audio]);
    const result = await renderPortrait({
      outputPath: output,
      cuts: [{ path: source, startSeconds: 0, endSeconds: 2 }, { path: source, startSeconds: 2, endSeconds: 4 }],
      hook: 'Can this tiny runner survive?',
      attribution: 'SYNTHETIC TEST · not Astrocade gameplay',
      subtitles: [{ startSeconds: 0.5, endSeconds: 1.8, text: 'Readable phrase captions' }, { startSeconds: 2.1, endSeconds: 3.5, text: 'Whole game frame preserved' }],
      narrationPath: audio,
      ffmpeg: tools,
    });
    const info = await probeMedia(output);
    assert.equal(result.hasAudio, true);
    assert.equal(info.video?.codec, 'h264');
    assert.equal(info.video?.width, 1080);
    assert.equal(info.video?.height, 1920);
    assert.equal(info.video?.frameRate, 30);
    assert.equal(info.audio?.codec, 'aac');
    assert.ok(info.durationSeconds >= 3.95 && info.durationSeconds <= 4.1);
    assert.ok(!(await readdir(directory)).some(name => name.startsWith('.render-')));
    await assert.rejects(renderPortrait({ outputPath: output, cuts: [{ path: source, startSeconds: 0, endSeconds: 4 }], hook: 'Existing output' }), /already exists/u);
    if (process.env.KEEP_MEDIA_TEST_OUTPUT === '1') console.log(`Media QA artifact: ${output}`);
  } finally {
    if (process.env.KEEP_MEDIA_TEST_OUTPUT !== '1') await rm(directory, { recursive: true, force: true });
  }
});

test('portrait game edges remain visible between reserved hook and footer regions', { skip: process.env.RUN_RENDER_TESTS !== '1', timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-layout-test-'));
  const source = join(directory, 'source.mp4'), output = join(directory, 'portrait.mp4'), frame = join(directory, 'frame.rgb');
  const tools: MediaTools = { fontPath: fileURLToPath(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)) };
  const { ffmpeg } = mediaExecutables(tools);
  try {
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x18A060:size=720x1280:rate=30', '-vf', 'drawbox=x=0:y=0:w=720:h=64:color=red:t=fill,drawbox=x=0:y=1216:w=720:h=64:color=blue:t=fill', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', source]);
    await renderPortrait({ outputPath: output, cuts: [{ path: source, startSeconds: 0, endSeconds: 2 }], hook: 'The complete game stays visible', attribution: 'Layout fixture', ffmpeg: tools });
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame]);
    const pixels = await readFile(frame);
    const pixel = (x: number, y: number) => [...pixels.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
    const [topR, topG, topB] = pixel(540, 240), [bottomR, bottomG, bottomB] = pixel(540, 1680);
    assert.ok(topR! > 200 && topG! < 40 && topB! < 40, 'top HUD marker remains below the hook header');
    assert.ok(bottomB! > 200 && bottomR! < 40 && bottomG! < 40, 'bottom controls marker remains above the footer');
    for (const y of [100, 1850]) assert.ok(pixel(10, y).every(channel => channel < 40), 'text regions are reserved dark bands');
    if (process.env.KEEP_MEDIA_TEST_OUTPUT === '1') console.log(`Layout QA artifact: ${output}`);
  } finally {
    if (process.env.KEEP_MEDIA_TEST_OUTPUT !== '1') await rm(directory, { recursive: true, force: true });
  }
});
