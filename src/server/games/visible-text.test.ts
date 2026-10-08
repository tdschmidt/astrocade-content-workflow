import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chromium } from 'playwright';
import { readVisibleText } from './visible-text.js';

const browserTest = { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 };
async function fixture(t: TestContext) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  return browser.newPage({ viewport: { width: 800, height: 700 } });
}

test('DOM observation excludes inactive ancestors without filtering legitimate terminal words', browserTest, async t => {
  const page = await fixture(t);
  await page.setContent(`<style>body{margin:0;font:16px sans-serif}</style>
    <p>Active score: 414</p><p>Visible Time's Up!</p>
    <section style="opacity:0"><div style="opacity:1">HIDDEN TRANSPARENT GAME OVER</div></section>
    <section hidden><p>HIDDEN ATTRIBUTE</p></section>
    <section style="display:none"><p>HIDDEN DISPLAY</p></section>
    <section style="visibility:hidden"><p>HIDDEN VISIBILITY</p><span style="visibility:visible">Visible override</span></section>
    <section style="content-visibility:hidden"><p>HIDDEN CONTENT</p></section>
    <section style="display:contents">Visible contents</section>
    <script>window.hiddenState = 'HIDDEN SCRIPT';</script>`);
  const text = await readVisibleText(page.locator('body'));
  assert.match(text, /Active score: 414/);
  assert.match(text, /Visible Time's Up!/);
  assert.match(text, /Visible override/);
  assert.match(text, /Visible contents/);
  assert.doesNotMatch(text, /HIDDEN/);
});

test('DOM observation uses the current frame viewport and clips scroll containers', browserTest, async t => {
  const page = await fixture(t);
  await page.setContent(`<p>OUTER PAGE</p><iframe id="game" style="position:absolute;left:550px;top:400px;width:200px;height:180px;border:0"></iframe>`);
  const frame = page.frameLocator('#game');
  await frame.locator('body').evaluate(body => { body.innerHTML = `<style>body{margin:0;font:16px sans-serif}</style>
    <p>Visible frame text</p><p style="position:absolute;top:210px">OFFSCREEN BELOW FRAME</p>
    <p style="position:absolute;left:-300px;width:200px">OFFSCREEN LEFT</p>
    <div style="position:absolute;top:50px;height:25px;width:180px;overflow:hidden"><span>Visible clipped box</span><p style="margin-top:50px">CLIPPED DESCENDANT</p></div>
    <p style="position:absolute;top:130px">Visible near bottom</p>`; });
  const text = await readVisibleText(frame.locator('body'));
  assert.match(text, /Visible frame text/);
  assert.match(text, /Visible clipped box/);
  assert.match(text, /Visible near bottom/);
  assert.doesNotMatch(text, /OUTER|OFFSCREEN|CLIPPED DESCENDANT/);
});

test('DOM observation bounds output and reads frame text for a canvas surface', browserTest, async t => {
  const page = await fixture(t);
  await page.setContent('<canvas width="1" height="1"></canvas><p>' + 'visible '.repeat(2000) + '</p>');
  const surface = page.locator('canvas');
  const short = await readVisibleText(surface, 83);
  assert.equal(short.length, 83);
  assert.equal(short, ('visible '.repeat(2000)).slice(0, 83));
  assert.equal((await readVisibleText(surface, 100000)).length, 6000);
  assert.equal(await readVisibleText(surface, 0), '');
});
