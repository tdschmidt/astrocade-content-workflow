import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { gameBounds, InputExecutor } from './input.js';

test('scaled iframe bounds, native controls and screenshots share the displayed coordinate space', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.setContent('<style>body{margin:0}iframe{position:absolute;left:40px;top:60px;width:720px;height:960px;border:4px solid black;transform:scale(.75);transform-origin:top left}</style><iframe id="game"></iframe>');
  const frame = page.frames()[1]!;
  await frame.setContent(`<style>body{margin:0}canvas{display:block;background:#234}button{position:absolute;left:100px;top:600px;width:300px;height:80px}</style><canvas width="720" height="960"></canvas><button id="start">Start</button><script>document.querySelector('button').onclick=e=>{document.body.dataset.clicked=String(e.isTrusted);document.querySelector('button').remove()};document.querySelector('canvas').onpointerup=e=>{document.body.dataset.point=e.clientX+','+e.clientY}</script>`);
  const surface = { selector: 'canvas', frames: ['#game'] };
  const executor = new InputExecutor(page, surface);
  const bounds = await gameBounds(page, surface);
  assert.deepEqual(bounds, { x: 43, y: 63, width: 540, height: 720 });
  await executor.step({ type: 'click', target: { selector: '#start', frames: ['#game'] } });
  assert.equal(await frame.locator('body').getAttribute('data-clicked'), 'true');
  await executor.execute({ type: 'tap', point: { x: 0.5, y: 0.5 } });
  const point = (await frame.locator('body').getAttribute('data-point'))!.split(',').map(Number);
  assert.ok(Math.abs(point[0]! - 360) < 1);
  assert.ok(Math.abs(point[1]! - 480) < 1);
  const screenshot = await page.screenshot({ clip: bounds });
  assert.equal(screenshot.readUInt32BE(16), 540);
  assert.equal(screenshot.readUInt32BE(20), 720);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await frame.evaluate(() => scrollY), 0);
  assert.deepEqual(await gameBounds(page, surface), bounds);

  await page.evaluate(() => { const cover = document.createElement('div'); cover.id = 'cover'; cover.style.cssText = 'position:fixed;inset:0;background:white;z-index:10'; document.body.append(cover); });
  await assert.rejects(executor.step({ type: 'click', target: surface }), /covered/);
  await page.locator('#cover').evaluate(element => element.remove());
  await page.locator('iframe').evaluate(element => { element.style.top = '-100px'; });
  await assert.rejects(gameBounds(page, surface), /clipped|outside/);
});
