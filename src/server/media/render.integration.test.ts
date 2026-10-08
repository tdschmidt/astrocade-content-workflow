import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mediaExecutables, probeMedia, type MediaTools } from './probe.js';
import { runProcess } from './process.js';
import { presenterVideoDuration, renderPortrait } from './render.js';

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
      subtitles: [{ startSeconds: 1, endSeconds: 1.35, text: 'Done.' }, { startSeconds: 2.1, endSeconds: 3.5, text: 'Whole game frame preserved' }],
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

test('split-screen keeps complete gameplay, labels its presenter, and refuses insufficient video', { skip: process.env.RUN_RENDER_TESTS !== '1', timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-presenter-test-'));
  const source = join(directory, 'game.mp4'), presenter = join(directory, 'synthetic-test-card.mp4'), shortPresenter = join(directory, 'short-video-long-audio.mp4');
  const output = join(directory, 'split.mp4'), rejected = join(directory, 'rejected.mp4'), frame = join(directory, 'frame.rgb');
  const tools: MediaTools = { fontPath: fileURLToPath(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)) };
  const { ffmpeg } = mediaExecutables(tools);
  try {
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x18A060:size=720x1280:rate=30:duration=2.4', '-vf', 'drawbox=x=0:y=0:w=720:h=64:color=red:t=fill,drawbox=x=0:y=1216:w=720:h=64:color=blue:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', source]);
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:size=640x360:rate=30:duration=2.4', '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000:duration=2.4', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', presenter]);
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:size=640x360:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000:duration=2.4', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', shortPresenter]);
    assert.ok(Math.abs(await presenterVideoDuration(presenter, tools) - 2.4) < 0.001);
    assert.ok((await probeMedia(shortPresenter, tools)).durationSeconds >= 2.4);
    assert.ok(Math.abs(await presenterVideoDuration(shortPresenter, tools) - 1) < 0.001, 'the editor receives actual video duration even when audio extends the container');
    const options = { outputPath: output, cuts: [{ path: source, startSeconds: 0, endSeconds: 2.4 }], hook: 'One spot left', overlays: [{ startSeconds: 0, endSeconds: 1.2, text: 'One spot left', position: 'upper' as const }], presenter: { path: presenter }, ffmpeg: tools };
    await assert.rejects(renderPortrait({ ...options, outputPath: rejected, presenter: { path: shortPresenter } }), /Presenter video is too short: 1.00s/u);
    await assert.rejects(access(rejected), /ENOENT/u);
    await assert.rejects(renderPortrait({ ...options, outputPath: rejected, presenter: { path: join(directory, 'missing.mp4') } }), /ENOENT/u);
    await assert.rejects(access(rejected), /ENOENT/u);
    const artifact = await renderPortrait(options);
    assert.equal(artifact.hasAudio, false, 'presenter sound is not treated as narration');
    assert.equal((await probeMedia(output)).audio, undefined);
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame]);
    const pixels = await readFile(frame);
    const pixel = (x: number, y: number) => [...pixels.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
    const top = pixel(540, 80), gameTop = pixel(540, 500), gameBottom = pixel(540, 1900);
    assert.ok(top[0]! > 230 && top[1]! > 230 && top[2]! < 30, 'synthetic presenter card occupies the top panel');
    assert.ok(gameTop[0]! > 230 && gameTop[1]! < 30 && gameTop[2]! < 30, 'complete game begins immediately below host');
    assert.ok(gameBottom[2]! > 230 && gameBottom[0]! < 30 && gameBottom[1]! < 30, 'bottom gameplay marker survives fitting');
    const whiteCount = (x0: number, y0: number, x1: number, y1: number) => {
      let count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (pixel(x, y).every(value => value > 230)) count++;
      return count;
    };
    assert.ok(whiteCount(70, 350, 500, 420) > 500, 'the host panel visibly contains the permanent AI disclosure');
    assert.ok(whiteCount(120, 660, 900, 900) > 1000, 'upper caption is mapped into gameplay rather than covering the host');
    const narration = join(directory, 'narration.wav'), narrated = join(directory, 'narrated.mp4');
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=48000:duration=2', narration]);
    await assert.rejects(renderPortrait({ ...options, outputPath: rejected, presenter: { path: narration } }), /Presenter source has no usable video/u);
    await assert.rejects(access(rejected), /ENOENT/u);
    const narratedArtifact = await renderPortrait({ ...options, outputPath: narrated, narrationPath: narration });
    assert.equal(narratedArtifact.hasAudio, true);
    assert.equal((await probeMedia(narrated)).audio?.sampleRate, 48000);
    assert.ok(!(await readdir(directory)).some(name => name.startsWith('.render-')));
    if (process.env.KEEP_MEDIA_TEST_OUTPUT === '1') {
      await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', join(directory, 'split.png')]);
      console.log(`Split-screen synthetic fixture: ${output}`);
    }
  } finally {
    if (process.env.KEEP_MEDIA_TEST_OUTPUT !== '1') await rm(directory, { recursive: true, force: true });
  }
});

test('full-height gameplay preserves its edges and receives timed text without reserved bands', { skip: process.env.RUN_RENDER_TESTS !== '1', timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-layout-test-'));
  const source = join(directory, 'source.mp4'), output = join(directory, 'portrait.mp4'), frame = join(directory, 'frame.rgb');
  const tools: MediaTools = { fontPath: fileURLToPath(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)) };
  const { ffmpeg } = mediaExecutables(tools);
  try {
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x18A060:size=720x1280:rate=30', '-vf', 'drawbox=x=0:y=0:w=720:h=64:color=red:t=fill,drawbox=x=0:y=1216:w=720:h=64:color=blue:t=fill', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', source]);
    await renderPortrait({ outputPath: output, cuts: [{ path: source, startSeconds: 0, endSeconds: 3 }], hook: 'Unused legacy hook', overlays: [
      { startSeconds: 0, endSeconds: 1.2, text: 'That last stubborn spot', position: 'upper' },
      { startSeconds: 1.4, endSeconds: 2.6, text: 'Finally spotless', position: 'lower' },
    ], ffmpeg: tools });
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame]);
    const pixels = await readFile(frame);
    const pixel = (x: number, y: number) => [...pixels.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
    const [topR, topG, topB] = pixel(540, 20), [bottomR, bottomG, bottomB] = pixel(540, 1900);
    assert.ok(topR! > 200 && topG! < 40 && topB! < 40, 'top HUD marker is preserved at the top of the output');
    assert.ok(bottomB! > 200 && bottomR! < 40 && bottomG! < 40, 'bottom controls marker is preserved at the bottom');
    for (const y of [200, 1750]) {
      const [red, green, blue] = pixel(10, y);
      assert.ok(green! > 120 && red! < 60 && blue! < 130, 'gameplay fills the former dark header/footer bands');
    }
    const whiteBounds = (rgb: Buffer) => {
      const points: Array<[number, number]> = [];
      for (let y = 0; y < 1920; y++) for (let x = 0; x < 1080; x++) {
        const index = (y * 1080 + x) * 3;
        if (rgb[index]! > 230 && rgb[index + 1]! > 230 && rgb[index + 2]! > 230) points.push([x, y]);
      }
      return { count: points.length, minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) };
    };
    const upper = whiteBounds(pixels);
    assert.ok(upper.count > 1000, 'the actual rendered frame contains readable white text');
    assert.ok(upper.minX >= 120 && upper.maxX <= 900 && upper.minY >= 240 && upper.maxY < 480, 'upper phrase is safely inset directly over the gameplay');
    const lowerFrame = join(directory, 'lower.rgb'), noTextFrame = join(directory, 'no-text.rgb');
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1.8', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', lowerFrame]);
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '2.8', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', noTextFrame]);
    const lower = whiteBounds(await readFile(lowerFrame));
    assert.ok(lower.count > 1000 && lower.minY > 1300 && lower.maxY <= 1536, 'later phrase moves to the requested lower location');
    assert.equal(whiteBounds(await readFile(noTextFrame)).count, 0, 'text clears before the clean ending');
    if (process.env.KEEP_MEDIA_TEST_OUTPUT === '1') {
      await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', join(directory, 'upper.png')]);
      await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1.8', '-i', output, '-frames:v', '1', join(directory, 'lower.png')]);
      console.log(`Layout QA artifact: ${output}`);
    }
  } finally {
    if (process.env.KEEP_MEDIA_TEST_OUTPUT !== '1') await rm(directory, { recursive: true, force: true });
  }
});

test('multiple cuts survive source resolution changes without losing either sequence', { skip: process.env.RUN_RENDER_TESTS !== '1', timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-render-resize-'));
  const source = join(directory, 'resized.webm'), output = join(directory, 'portrait.mp4');
  const tools: MediaTools = { fontPath: fileURLToPath(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)) };
  const { ffmpeg, ffprobe } = mediaExecutables(tools);
  try {
    for (const [index, [size, color]] of [['320x240', 'red'], ['256x192', 'green'], ['320x240', 'blue']].entries()) {
      await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:size=${size}:rate=30:duration=1`, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', join(directory, `${index}.webm`)]);
    }
    await writeFile(join(directory, 'segments.txt'), "file '0.webm'\nfile '1.webm'\nfile '2.webm'\n");
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-i', join(directory, 'segments.txt'), '-c', 'copy', source]);
    const decoded = JSON.parse((await runProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=width,height', '-of', 'json', source])).stdout).frames as Array<{ width: number; height: number }>;
    assert.deepEqual([...new Set(decoded.map(frame => `${frame.width}x${frame.height}`))], ['320x240', '256x192']);
    const artifact = await renderPortrait({ outputPath: output, cuts: [
      { path: source, startSeconds: 0.2, endSeconds: 0.8, crop: { x: 0, y: 0, width: 256, height: 192 } },
      { path: source, startSeconds: 2.2, endSeconds: 2.8, crop: { x: 0, y: 0, width: 256, height: 192 } },
    ], hook: '', overlays: [], ffmpeg: tools, signal: AbortSignal.timeout(20_000) });
    assert.ok(Math.abs(artifact.durationSeconds - 1.2) < 0.05);
    for (const [index, seconds] of [0.3, 0.9].entries()) {
      const frame = join(directory, `${index}.rgb`);
      await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', output, '-frames:v', '1', '-vf', 'crop=2:2:540:960', '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame]);
      const rgb = await readFile(frame);
      assert.ok(rgb[index === 0 ? 0 : 2]! > 230 && rgb[index === 0 ? 2 : 0]! < 30, 'the first cut stays red and the later cut stays blue');
    }
    assert.ok(!(await readdir(directory)).some(name => name.startsWith('.render-')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
