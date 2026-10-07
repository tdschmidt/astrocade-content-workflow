import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createGameCapture } from './recorder.js';

test('invalid capture settings fail before launching a browser', async () => {
  await assert.rejects(createGameCapture({ outputPath: '/tmp/unused.webm', viewport: { width: 0, height: 720 }, maxDurationMs: 1000 }), /viewport/u);
});

const browserTests = process.env.RUN_BROWSER_MEDIA_TESTS === '1';
const scene = '<!doctype html><style>body{margin:0}</style><canvas width="720" height="1280"></canvas><script>const x=document.querySelector("canvas").getContext("2d");let n=0;function draw(){x.fillStyle=n%2?"#204070":"#206050";x.fillRect(0,0,720,1280);x.fillStyle="white";x.font="64px sans-serif";x.fillText(String(n++),100,300);x.fillRect((n*5)%600,700,80,80);requestAnimationFrame(draw)}draw()</script>';

test('native capture flushes before promotion and leaves the game open for cleanup', { skip: !browserTests, timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-recorder-test-'));
  const input = join(directory, 'scene.html');
  const output = join(directory, 'capture.webm');
  await writeFile(input, scene);
  const capture = await createGameCapture({ outputPath: output, viewport: { width: 720, height: 1280 }, maxDurationMs: 10_000 });
  try {
    await capture.page.goto(pathToFileURL(input).href);
    await capture.start();
    await new Promise(resolve => setTimeout(resolve, 2200));
    const artifact = await capture.finish();
    assert.equal(artifact.codec, 'vp9');
    assert.equal(artifact.width, 720);
    assert.ok(artifact.durationSeconds >= 2 && artifact.durationSeconds < 3);
    assert.ok((await stat(output)).size > 1000);
    assert.equal(capture.page.isClosed(), false);
    assert.deepEqual((await readdir(directory)).sort(), ['capture.webm', 'scene.html']);
  } finally { await capture.close(); await rm(directory, { recursive: true, force: true }); }
});

test('canceling a native capture leaves no ready or partial video', { skip: !browserTests, timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-recorder-cancel-test-'));
  const input = join(directory, 'scene.html');
  await writeFile(input, scene);
  const controller = new AbortController();
  const capture = await createGameCapture({ outputPath: join(directory, 'capture.webm'), viewport: { width: 720, height: 1280 }, maxDurationMs: 10_000, signal: controller.signal });
  try {
    await capture.page.goto(pathToFileURL(input).href);
    await capture.start();
    await new Promise(resolve => setTimeout(resolve, 1200));
    controller.abort();
    await capture.cancel();
    await assert.rejects(capture.finish(), { name: 'AbortError' });
    assert.deepEqual(await readdir(directory), ['scene.html']);
  } finally { await capture.close(); await rm(directory, { recursive: true, force: true }); }
});

test('closing the game unexpectedly cannot promote a partial recording', { skip: !browserTests, timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-recorder-close-test-'));
  const input = join(directory, 'scene.html');
  await writeFile(input, scene);
  const capture = await createGameCapture({ outputPath: join(directory, 'capture.webm'), viewport: { width: 720, height: 1280 }, maxDurationMs: 10_000 });
  try {
    await capture.page.goto(pathToFileURL(input).href);
    await capture.start();
    await new Promise(resolve => setTimeout(resolve, 1100));
    await capture.page.close();
    await assert.rejects(capture.finish(), /Game page closed/u);
    assert.deepEqual(await readdir(directory), ['scene.html']);
  } finally { await capture.close(); await rm(directory, { recursive: true, force: true }); }
});
