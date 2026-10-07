import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium, type Page } from 'playwright';
import type { Inference } from '../providers/inference.js';
import { learnFeedbackProfile } from './feedback.js';
import { InputExecutor } from './input.js';
import { inspectGamePage, learnGameProfile } from './learning.js';
import type { GameCandidate } from './schema.js';

const browserTest = { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 25000 };
const frameSelector = 'iframe[title="Astrocade Game"]';
const frameSurface = { selector: frameSelector, frames: [] };
const candidate: GameCandidate = { id: 'MenuFixture', title: 'Visible menu fixture', url: 'https://www.astrocade.com/games/menu-fixture/MenuFixture', titleSource: 'visible_text', metrics: [], observations: [] };
const styles = '<style>html,body{margin:0;width:100%;height:100%;background:#123;color:white;font:24px sans-serif}button{font:24px sans-serif;padding:15px}canvas{display:block}</style>';
const playing = { phase: 'playing', buttonIndex: null, point: null, label: '', reason: 'An active game board and gameplay controls are visible.' };

async function fixture(t: TestContext, body: string) {
  const outputDir = await mkdtemp(join(tmpdir(), 'astrocade-menu-learning-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const newPage = async () => {
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
    await page.setContent(`<style>body{margin:0}iframe{position:absolute;left:50px;top:100px;width:400px;height:600px;border:0}</style>
      <button aria-label="Start playing" onclick="document.body.dataset.opened=String(event.isTrusted);this.remove()">Open</button>
      <span id="outside"><button>Start</button><button>SUIT UP</button><button>NEXT</button><button>Choose</button></span>
      <iframe title="Astrocade Game"></iframe><script>document.querySelector('#outside').onclick=()=>{document.body.dataset.outsideClicked='true'}</script>`);
    await page.frames()[1]!.setContent(styles + body);
    return page;
  };
  const page = await newPage();
  return { outputDir, page, newPage };
}

async function pixel(page: Page, png: Buffer, x: number, y: number) {
  return page.evaluate(async ({ base64, x, y }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(x, y, 1, 1).data];
  }, { base64: png.toString('base64'), x, y });
}

test('inspection keeps HTML tools outside a small canvas in the full game-frame screenshot', browserTest, async t => {
  const { outputDir, page } = await fixture(t, `<button id="start">Start</button><script>
    document.querySelector('#start').onclick=e=>{document.body.dataset.started=String(e.isTrusted);document.querySelector('#start').remove();
      document.body.insertAdjacentHTML('beforeend','<canvas width="100" height="100" style="background:#f00"></canvas><button id="tool" style="position:absolute;left:270px;top:500px;width:100px;height:60px;background:#ff00ff;border:0">Brush</button>')};
    </script>`);
  let calls = 0;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async (_prompt: string, _schema: unknown, media: Array<{ data: string }>) => {
    calls++;
    assert.equal(await page.frameLocator(frameSelector).locator('body').getAttribute('data-started'), 'true', 'the observed DOM Start is native and precedes classification');
    assert.deepEqual(await pixel(page, Buffer.from(media[0]!.data, 'base64'), 280, 510), [255, 0, 255, 255]);
    return playing;
  } } as unknown as Pick<Inference, 'json'>);
  assert.equal(calls, 1, 'the screen after the DOM fast path still requires an observed playing classification');
  assert.deepEqual(inspection.surface, frameSurface);
  assert.equal(inspection.readyToPlay, true);
  const image = await readFile(inspection.imagePath);
  assert.equal(image.readUInt32BE(16), 400);
  assert.equal(image.readUInt32BE(20), 600);
  assert.deepEqual(await pixel(page, image, 280, 510), [255, 0, 255, 255]);
  assert.equal(await page.locator('body').getAttribute('data-outside-clicked'), null);
});

test('active gameplay question-mark help is opened once and closed before the current screenshot', browserTest, async t => {
  const { outputDir, page } = await fixture(t, `<button id="start">Start</button><script>
    document.querySelector('#start').onclick=event=>{document.querySelector('#start').remove();
      document.body.insertAdjacentHTML('beforeend','<h1>Quiet plaza</h1><button id="legend">?</button><div id="help" hidden>CONTROLS: F opens the dial; SPACE transforms.</div>');
      document.querySelector('#legend').onclick=e=>{const help=document.querySelector('#help');help.hidden=!help.hidden;e.target.textContent=help.hidden?'?':'✕';document.body.dataset.helpClicks=(document.body.dataset.helpClicks||'')+String(e.isTrusted)+','};
    };
    </script>`);
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async () => playing } as unknown as Pick<Inference, 'json'>);
  assert.equal(inspection.readyToPlay, true);
  assert.deepEqual(inspection.help?.opened, { selector: '#legend', label: '?' });
  assert.deepEqual(inspection.help?.returned, { selector: '#legend', label: '✕' });
  assert.match(inspection.help!.text, /F opens the dial; SPACE transforms/);
  assert.match(inspection.text, /Observed help panel/);
  assert.equal(await page.frameLocator(frameSelector).locator('body').getAttribute('data-help-clicks'), 'true,true,');
  assert.equal(await page.frameLocator(frameSelector).locator('#help').isVisible(), false);
  assert.equal(await page.frameLocator(frameSelector).getByRole('heading', { name: 'Quiet plaza' }).isVisible(), true);
  assert.equal(inspection.startTargets.some(target => target.label === '?'), true);
  assert.deepEqual((inspection.performedMenuSteps ?? []).filter(step => step.type !== 'wait'), [{ type: 'click', target: { selector: '#start', frames: [frameSelector] } }], 'help inspection must not become captured gameplay or replay navigation');
  assert.ok((await readFile(inspection.help!.imagePath)).length > 0);
  assert.equal(await page.locator('body').getAttribute('data-outside-clicked'), null);
});

test('a custom DOM entry and canvas tutorial are freshly observed and replayed in order', browserTest, async t => {
  const body = `<button id="suitUp" style="position:absolute;left:100px;top:250px">SUIT UP</button><script>
    const record=(label,event)=>{const events=JSON.parse(document.body.dataset.events||'[]');events.push({label,trusted:event.isTrusted});document.body.dataset.events=JSON.stringify(events)};
    document.querySelector('#suitUp').onclick=e=>{record('SUIT UP',e);document.querySelector('#suitUp').remove();
      const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;canvas.style='position:absolute;left:50px;top:150px';document.body.append(canvas);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#345';ctx.fillRect(0,0,300,200);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('Tutorial: move to the door',10,40);ctx.fillStyle='#187';ctx.fillRect(80,100,140,60);ctx.fillStyle='white';ctx.fillText('NEXT',115,140);
      canvas.onclick=event=>{if(event.offsetX<80||event.offsetX>220||event.offsetY<100||event.offsetY>160)return;record('NEXT',event);canvas.remove();document.body.insertAdjacentHTML('beforeend','<h1>Active board</h1><p>Move to the blue door.</p><button id="move">Move</button>')};
    };
    </script>`;
  const { outputDir, page, newPage } = await fixture(t, body);
  const screenshots: string[] = [];
  let calls = 0;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async (_prompt: string, _schema: unknown, media: Array<{ data: string }>) => {
    screenshots.push(media[0]!.data);
    calls++;
    if (calls === 1) return { phase: 'entry', buttonIndex: 0, point: null, label: 'SUIT UP', reason: 'The lone visible button enters the game.' };
    if (calls === 2) return { phase: 'tutorial', buttonIndex: null, point: { x: 0.5, y: 280 / 600 }, label: 'NEXT', reason: 'The canvas tutorial explicitly offers NEXT before gameplay.' };
    assert.match(await page.frameLocator(frameSelector).locator('body').innerText(), /Active board/);
    return playing;
  } } as unknown as Pick<Inference, 'json'>);
  assert.equal(calls, 3);
  assert.equal(new Set(screenshots).size, 3, 'each menu action must be followed by a fresh screenshot');
  assert.equal(inspection.readyToPlay, true);
  assert.deepEqual(inspection.surface, frameSurface);
  const steps = inspection.performedMenuSteps ?? [];
  assert.deepEqual(steps.filter(step => step.type !== 'wait'), [
    { type: 'click', target: { selector: '#suitUp', frames: [frameSelector] } },
    { type: 'tap', point: { x: 0.5, y: 280 / 600 } },
  ]);
  const expected = [{ label: 'SUIT UP', trusted: true }, { label: 'NEXT', trusted: true }];
  assert.deepEqual(JSON.parse(await page.frameLocator(frameSelector).locator('body').getAttribute('data-events') ?? '[]'), expected);
  const fresh = await newPage();
  const executor = new InputExecutor(fresh, inspection.surface);
  for (const step of [...inspection.setup, ...steps]) await executor.step(step);
  assert.deepEqual(JSON.parse(await fresh.frameLocator(frameSelector).locator('body').getAttribute('data-events') ?? '[]'), expected);
  assert.match(await fresh.frameLocator(frameSelector).locator('body').innerText(), /Active board/);
  for (const browserPage of [page, fresh]) assert.equal(await browserPage.locator('body').getAttribute('data-outside-clicked'), null);
});

test('an active quiz is never answered during inspection and both learners reject a stale start', browserTest, async t => {
  const { outputDir, page } = await fixture(t, `<h1>Round 1: choose the largest number</h1><button id="answer">Choose 9</button><button>Choose 4</button><script>
    document.querySelectorAll('button').forEach(button=>{button.onclick=()=>{document.body.dataset.answerClicked='true'}});
    </script>`);
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async () => playing } as unknown as Pick<Inference, 'json'>);
  assert.equal(inspection.readyToPlay, true);
  assert.deepEqual(inspection.surface, frameSurface);
  assert.deepEqual(inspection.performedMenuSteps ?? [], []);
  assert.equal(inspection.performedStart, undefined);
  assert.equal(await page.frameLocator(frameSelector).locator('body').getAttribute('data-answer-clicked'), null);
  assert.equal(await page.locator('body').getAttribute('data-outside-clicked'), null);
  const common = { supported: true, confidence: 'high', objective: 'Answer the visible round.', evidence: ['The visible quiz offers labeled answer buttons.'], limitations: [] };
  for (const mode of ['timed', 'feedback'] as const) {
    const directory = join(outputDir, mode);
    await mkdir(directory);
    const current = { ...inspection, outputDir: directory };
    const response = mode === 'timed'
      ? { ...common, actions: [{ type: 'tap', point: { x: 0.2, y: 0.2 } }] }
      : { ...common, latencyTolerant: true, instructions: 'Tap the labeled answer.', allowedKeys: [], allowPointer: true };
    const learn = mode === 'timed' ? learnGameProfile : learnFeedbackProfile;
    await assert.rejects(learn(current, candidate, { json: async () => ({ ...response, start: [{ type: 'button', index: 0 }] }) } as unknown as Pick<Inference, 'json'>), /unrecognized_keys|Unrecognized key|start/);
    const learned = await learn(current, candidate, { json: async () => response } as unknown as Pick<Inference, 'json'>);
    assert.ok(learned.profile, `${mode} accepts established ready-to-play controls without a start field`);
    assert.deepEqual(learned.profile.start, [], 'quiz answer buttons cannot be reinterpreted as entry actions');
  }
});

test('a splash that changes during inference is reobserved before a native tutorial action', browserTest, async t => {
  const { outputDir, page } = await fixture(t, '<h1>DRAGON KEEPER</h1>');
  let calls = 0;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async (_prompt: string, _schema: unknown, media: { data: string }[]) => {
    calls++;
    if (calls === 1) {
      assert.ok(media[0]!.data.length);
      // Simulate this fixture's natural splash transition while inference is pending.
      await page.frameLocator(frameSelector).locator('body').evaluate(body => {
        body.innerHTML = '<h1>Welcome, keeper</h1><p>Use ArrowRight to move.</p><button id="next">NEXT</button>';
        body.querySelector('button')!.addEventListener('click', event => {
          body.dataset.tutorialTrusted = String(event.isTrusted);
          body.innerHTML = '<h1>Active board</h1><p>Hatch your egg.</p>';
        });
      });
      return { phase: 'unsupported', buttonIndex: null, point: null, label: '', reason: 'Only a title splash was visible in the supplied screenshot.' };
    }
    if (calls === 2) return { phase: 'tutorial', buttonIndex: 0, point: null, label: 'NEXT', reason: 'The newly observed tutorial explains movement and offers NEXT.' };
    return playing;
  } } as unknown as Pick<Inference, 'json'>);
  assert.equal(calls, 3);
  assert.equal(inspection.readyToPlay, true);
  assert.match(inspection.text, /Observed tutorial 1:[\s\S]*Use ArrowRight/);
  assert.equal(inspection.tutorials?.length, 1);
  assert.ok((await readFile(inspection.tutorials![0]!.imagePath)).length > 100);
  assert.equal(await page.frameLocator(frameSelector).locator('body').getAttribute('data-tutorial-trusted'), 'true');
  assert.equal(await page.locator('body').getAttribute('data-outside-clicked'), null);
});

test('a semantic menu target must preserve the exact observed DOM label', browserTest, async t => {
  const { outputDir, page } = await fixture(t, '<button id="suitUp" onclick="document.body.dataset.clicked=String(event.isTrusted)">SUIT UP!</button>');
  await assert.rejects(inspectGamePage(page, candidate.url, outputDir, undefined, { json: async () => ({
    phase: 'entry', buttonIndex: 0, point: null, label: 'Start', reason: 'Incorrectly renamed the visible entry button.',
  }) } as unknown as Pick<Inference, 'json'>), /exactly match an observed in-frame button/);
  assert.equal(await page.frameLocator(frameSelector).locator('body').getAttribute('data-clicked'), null);
  assert.equal(await page.locator('body').getAttribute('data-outside-clicked'), null);
});

for (const scenario of ['became gameplay', 'animated entry'] as const) test(`a changed canvas menu is reclassified once when it ${scenario}`, browserTest, async t => {
  const { outputDir, page } = await fixture(t, `<canvas width="400" height="600"></canvas><script>
    const canvas=document.querySelector('canvas'), context=canvas.getContext('2d');
    window.draw=(x,color,label)=>{context.fillStyle=color;context.fillRect(0,0,400,600);context.fillStyle='white';context.font='28px sans-serif';context.fillText(label,x-35,310)};
    window.draw(200,'#123','PLAY');
    canvas.onclick=event=>{document.body.dataset.clicked=event.clientX+','+event.clientY;document.body.dataset.trusted=String(event.isTrusted);window.draw(200,'#185','BOARD')};
    </script>`);
  let calls = 0;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async () => {
    calls++;
    if (calls === 1) {
      await page.frameLocator(frameSelector).locator('body').evaluate((_, scenario) => {
        (window as unknown as { draw: (x: number, color: string, label: string) => void }).draw(260, '#456', scenario === 'became gameplay' ? 'ACTIVE BOARD' : 'PLAY');
      }, scenario);
      return { phase: 'entry', buttonIndex: null, point: { x: 0.5, y: 0.5 }, label: 'PLAY', reason: 'The supplied initial image shows a native Play entrance.' };
    }
    if (calls === 2 && scenario === 'animated entry') {
      // The background animates again during confirmation. A third identical
      // raster is not required; the same visible entrance uses fresh coordinates.
      await page.frameLocator(frameSelector).locator('body').evaluate(() => {
        (window as unknown as { draw: (x: number, color: string, label: string) => void }).draw(260, '#567', 'PLAY');
      });
      return { phase: 'entry', buttonIndex: null, point: { x: 0.65, y: 0.5 }, label: 'PLAY', reason: 'The current screenshot still shows Play at its new location.' };
    }
    return playing;
  } } as unknown as Pick<Inference, 'json'>);
  assert.equal(inspection.readyToPlay, true);
  assert.equal(calls, scenario === 'became gameplay' ? 2 : 3);
  const body = page.frameLocator(frameSelector).locator('body');
  assert.equal(await body.getAttribute('data-clicked'), scenario === 'became gameplay' ? null : '260,300');
  assert.equal(inspection.performedMenuSteps?.filter(step => step.type === 'tap').length, scenario === 'became gameplay' ? 0 : 1);
  if (scenario === 'animated entry') assert.equal(await body.getAttribute('data-trusted'), 'true');
  assert.equal(await page.locator('body').getAttribute('data-outside-clicked'), null);
});

test('one loading observation and three tutorial actions still leave a final gameplay observation', browserTest, async t => {
  const { outputDir, page } = await fixture(t, `<h1>Loading 50%</h1><script>
    window.pageNumber=0;window.showTutorial=()=>{window.pageNumber++;document.body.innerHTML='<h1>Keeper tutorial '+window.pageNumber+'</h1><p>Use ArrowRight to move.</p><button id="next">'+(window.pageNumber===3?"LET'S GO!":"NEXT")+'</button>';
      document.querySelector('button').onclick=event=>{document.body.dataset.lastTrusted=String(event.isTrusted);if(window.pageNumber<3)window.showTutorial();else document.body.innerHTML='<h1>Active board</h1><p>Hatch your egg.</p>'}};
    </script>`);
  let calls = 0;
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async () => {
    calls++;
    if (calls === 1) {
      await page.frameLocator(frameSelector).locator('body').evaluate(() => { (window as unknown as { showTutorial: () => void }).showTutorial(); });
      return { phase: 'loading', buttonIndex: null, point: null, label: 'Loading 50%', reason: 'The initial screen shows loading progress.' };
    }
    if (calls < 5) return { phase: 'tutorial', buttonIndex: 0, point: null, label: calls === 4 ? "LET'S GO!" : 'NEXT', reason: 'The visible tutorial page advances with its labeled native control.' };
    return playing;
  } } as unknown as Pick<Inference, 'json'>);
  assert.equal(calls, 5);
  assert.equal(inspection.readyToPlay, true);
  assert.equal(inspection.performedMenuSteps?.filter(step => step.type === 'click').length, 3);
  assert.equal(inspection.tutorials?.length, 3);
  assert.match(await page.frameLocator(frameSelector).locator('body').innerText(), /Active board/);
  assert.equal(await page.frameLocator(frameSelector).locator('body').getAttribute('data-last-trusted'), 'true');
  assert.equal(await page.locator('body').getAttribute('data-outside-clicked'), null);
});

test('menu indexes refer to the visible list rather than hidden DOM button ordinals', browserTest, async t => {
  const body = `${Array.from({ length: 9 }, () => '<button hidden>Hidden control</button>').join('')}
    <button>SKIP</button><button>LET'S GO!</button><script>
    document.querySelectorAll('button')[9].onclick=()=>{document.body.dataset.skipped='true'};
    document.querySelectorAll('button')[10].onclick=event=>{document.body.dataset.started=String(event.isTrusted);document.body.innerHTML='<h1>Active board</h1>'};
    </script>`;
  const { outputDir, page, newPage } = await fixture(t, body);
  let calls = 0;
  const chosen = { phase: 'tutorial', buttonIndex: 1, point: null, label: "LET'S GO!", reason: 'The visible final tutorial button enters gameplay.' };
  const inspection = await inspectGamePage(page, candidate.url, outputDir, undefined, { json: async (prompt: string, schema: { safeParse: (value: unknown) => { success: boolean } }) => {
    calls++;
    const line = prompt.split('\n').find(line => line.startsWith('Visible in-frame buttons'))!;
    const buttons = JSON.parse(line.slice(line.indexOf(': ') + 2));
    assert.doesNotMatch(prompt, /:nth-match|"selector"/);
    if (calls === 1) {
      assert.deepEqual(buttons, [{ index: 0, label: 'SKIP' }, { index: 1, label: "LET'S GO!" }]);
      assert.equal(schema.safeParse(chosen).success, true);
      assert.equal(schema.safeParse({ ...chosen, buttonIndex: 11 }).success, false, 'the real DOM ordinal is outside the visible-list schema');
      return chosen;
    }
    assert.deepEqual(buttons, []);
    assert.equal(schema.safeParse({ ...chosen, buttonIndex: 0 }).success, false, 'an empty visible list permits no DOM index');
    return playing;
  } } as unknown as Pick<Inference, 'json'>);
  assert.equal(calls, 2);
  assert.equal(inspection.readyToPlay, true);
  assert.deepEqual(inspection.performedMenuSteps?.[0], { type: 'click', target: { selector: ':nth-match(button, 11)', frames: [frameSelector] } });
  const fresh = await newPage();
  const executor = new InputExecutor(fresh, inspection.surface);
  for (const step of [...inspection.setup, ...inspection.performedMenuSteps!]) await executor.step(step);
  for (const current of [page, fresh]) {
    assert.equal(await current.frameLocator(frameSelector).locator('body').getAttribute('data-started'), 'true');
    assert.equal(await current.frameLocator(frameSelector).locator('body').getAttribute('data-skipped'), null);
    assert.equal(await current.locator('body').getAttribute('data-outside-clicked'), null);
  }
});
