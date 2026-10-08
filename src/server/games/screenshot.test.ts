import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { gameBounds, InputExecutor } from './input.js';
import { gameScreenshot } from './screenshot.js';

test('local screenshot cropping preserves device pixels, source colors and requested encoding', async () => {
  const fullImage = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ff0000' } })
    .composite([{ input: await sharp({ create: { width: 200, height: 160, channels: 3, background: '#0000ff' } }).png().toBuffer(), left: 100, top: 80 }]).png().toBuffer();
  const page = {
    viewportSize: () => ({ width: 400, height: 300 }),
    screenshot: async (options: Record<string, unknown>) => {
      assert.equal(options.clip, undefined, 'the browser must never receive a crop');
      assert.equal(options.fullPage, false, 'capturing must not resize the viewport');
      return fullImage;
    },
  } as unknown as Page;
  const clip = { x: 50, y: 40, width: 100, height: 80 };
  const png = await gameScreenshot(page, clip);
  const decoded = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 200);
  assert.equal(decoded.info.height, 160);
  assert.ok(decoded.data.every((channel, index) => channel === (index % 3 === 2 ? 255 : 0)));
  const jpeg = await sharp(await gameScreenshot(page, clip, { type: 'jpeg', quality: 70 })).metadata();
  assert.equal(jpeg.format, 'jpeg');
  assert.equal(jpeg.width, 200);
  assert.equal(jpeg.height, 160);
  await assert.rejects(gameScreenshot(page, { ...clip, x: -1 }), /outside/);
  await assert.rejects(gameScreenshot(page, { ...clip, width: Number.NaN }), /finite/);
});

type EventRecord = { type: string; target: string; x: number; y: number; buttons: number; trusted: boolean };
const fixtureHtml = `<!doctype html><style>
  html,body{margin:0;width:100%;height:100%}#surface{position:absolute;inset:0;background:#14263c}
  #choice{position:absolute;left:80px;top:390px;width:240px;height:60px;border:0;background:#357aff}
  </style><div id="surface"><button id="choice">Choose</button></div><script>
  window.fixtureEvents=[];
  for(const type of ['pointerdown','pointermove','pointerup','click'])document.addEventListener(type,event=>{
    window.fixtureEvents.push({type,target:event.target.id||event.target.tagName,x:event.clientX,y:event.clientY,buttons:event.buttons,trusted:event.isTrusted});
  },true);
  </script>`;

for (const scaled of [false, true]) test(`cross-origin native input stays aligned before, during and after screenshots${scaled ? ' with a scaled iframe and DPR 2' : ''}`, {
  skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000,
}, async t => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: scaled ? 2 : 1 });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).hostname === 'game.fixture.invalid' ? fixtureHtml : `<!doctype html><style>
    body{margin:0}iframe{position:absolute;left:${scaled ? 40 : 50}px;top:${scaled ? 60 : 100}px;width:400px;height:600px;border:${scaled ? '4px solid black' : '0'};${scaled ? 'transform:scale(.75);transform-origin:top left' : ''}}
    </style><iframe id="game" src="https://game.fixture.invalid/play"></iframe>` }));
  await page.goto('https://outer.fixture.invalid/');
  const frame = page.frameLocator('#game');
  await frame.locator('#choice').waitFor();
  const surface = scaled ? { selector: '#surface', frames: ['#game'] } : { selector: '#game', frames: [] };
  const bounds = await gameBounds(page, surface);
  assert.deepEqual(bounds, scaled ? { x: 43, y: 63, width: 300, height: 450 } : { x: 50, y: 100, width: 400, height: 600 });
  const executor = new InputExecutor(page, surface);
  const first = await gameScreenshot(page, bounds);
  const image = await sharp(first).metadata();
  assert.equal(image.width, scaled ? 600 : 400);
  assert.equal(image.height, scaled ? 900 : 600);
  const pixel = await sharp(first).extract({ left: 5, top: 5, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixel], [20, 38, 60], 'the crop begins in the game, excluding the outer page and border');
  await executor.execute({ type: 'tap', point: { x: 0.5, y: 0.7 } });

  let actionComplete = false, sampledDuringAction = 0;
  const drag = executor.execute({ type: 'drag', from: { x: 0.3, y: 0.7 }, to: { x: 0.7, y: 0.7 }, durationMs: 1600 })
    .finally(() => { actionComplete = true; });
  const samples = (async () => {
    await frame.locator('body').evaluate(() => new Promise<void>(resolve => {
      document.addEventListener('pointermove', event => { if ((event as PointerEvent).buttons === 1) resolve(); });
    }));
    for (let index = 0; index < 3; index++) {
      await gameScreenshot(page, bounds, { type: 'jpeg', quality: 70, timeout: 1000 });
      if (!actionComplete) sampledDuringAction++;
    }
  })();
  await Promise.all([drag, samples]);
  assert.ok(sampledDuringAction > 0, 'at least one full screenshot and local crop completed during held native input');
  await gameScreenshot(page, bounds, { type: 'jpeg', quality: 70 });
  await executor.execute({ type: 'tap', point: { x: 0.5, y: 0.7 } });
  const events = await frame.locator('body').evaluate(() => (window as unknown as { fixtureEvents: EventRecord[] }).fixtureEvents);
  const downs = events.filter(event => event.type === 'pointerdown'), ups = events.filter(event => event.type === 'pointerup');
  assert.equal(downs.length, 3);
  assert.equal(ups.length, 3);
  assert.ok(events.every(event => event.trusted));
  assert.ok([...downs, ...ups].every(event => event.target === 'choice' && Math.abs(event.y - 420) < 1));
  assert.deepEqual(downs.map(event => Math.round(event.x)), [200, 120, 200]);
  assert.deepEqual(ups.map(event => Math.round(event.x)), [200, 280, 200]);
  assert.ok(events.filter(event => event.type === 'pointermove' && event.buttons === 1).every(event => event.x >= 119 && event.x <= 281 && Math.abs(event.y - 420) < 1));
  assert.equal(events.filter(event => event.type === 'click' && event.target === 'choice').length, 3);
  assert.deepEqual(await gameBounds(page, surface), bounds);
});
