import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { discoverGames } from './discovery.js';
import { gameBounds, InputExecutor, locate } from './input.js';
import { gameProfileSchema } from './schema.js';
import { resetGame, runCaptureAttempt, type ActionProgress } from './runner.js';

const frame = `<!doctype html><style>body{margin:0;background:#161b31}canvas{display:block}</style><button id="reset">Reset</button><canvas width="500" height="500" tabindex="0"></canvas><script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let moves=0,x=60;document.body.dataset.moves='0';document.body.dataset.held='false';
canvas.addEventListener('keydown',e=>{if(e.code==='ArrowRight'){moves++;x+=50;document.body.dataset.moves=String(moves);document.body.dataset.held='true';document.body.dataset.trusted=String(e.isTrusted)}});
canvas.addEventListener('keyup',()=>document.body.dataset.held='false');
canvas.addEventListener('pointerup',e=>document.body.dataset.pointer=String(Math.round(e.offsetX))+','+String(Math.round(e.offsetY)));
document.querySelector('#reset').onclick=()=>{moves=0;x=60;document.body.dataset.moves='0'};
function tick(t){ctx.fillStyle='#161b31';ctx.fillRect(0,0,500,500);ctx.fillStyle='#62dfca';ctx.fillRect(x,180+Math.sin(t/120)*20,70,70);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('LOCAL FIXTURE: moves '+moves,20,60);requestAnimationFrame(tick)}requestAnimationFrame(tick);
</script>`;

test('local browser fixture: discovery, frame controls, reset and two native captures', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 60000 }, async t => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/frame') response.end(frame);
    else if (request.url === '/hidden-frame') response.end(frame + '<style>canvas{display:none}</style><button id="start" onclick="document.querySelector(\'canvas\').style.display=\'block\';this.remove()">Play</button>');
    else if (request.url === '/hidden') response.end('<iframe id="game" src="/hidden-frame" width="500" height="560"></iframe>');
    else if (request.url === '/offline') response.end("<h1>You're Offline</h1>");
    else if (request.url === '/games') response.end(`<article><a href="https://www.astrocade.com/games/runner/id1"><h3>Runner</h3></a><p>1.2K plays</p><p>by Creator</p></article><article><a href="https://www.astrocade.com/games/sorter/id2"><h3>Sorter</h3></a><p>4 likes</p></article><a href="https://evil.example/games/fake/id3">Fake</a>`);
    else response.end('<!doctype html><style>body{margin:20px}iframe{border:0;margin-top:40px}</style><iframe id="game" src="/frame" width="500" height="560"></iframe>');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind.');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-games-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await t.test('live DOM extraction is distinct from an offline source', async () => {
    const result = await discoverGames({ browser, urls: [`${base}/games`, `${base}/offline`], allowLocalSources: true, timeoutMs: 300 });
    assert.equal(result.status, 'partial');
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0]!.title, 'Runner');
    assert.equal(result.candidates[0]!.metrics[0]!.value, 1200);
    assert.equal(result.candidates[0]!.creator, 'Creator');
    assert.equal(result.sources[1]!.status, 'offline');
    assert.equal(result.candidates.some(c => c.title === 'Fake'), false);
  });

  const profile = gameProfileSchema.parse({
    id: 'local-fixture', name: 'Local synthetic fixture', gameUrl: base, verification: 'verified', verificationNotes: 'Local test only; this is not an Astrocade game.',
    viewport: { width: 640, height: 800 }, surface: { selector: 'canvas', frames: ['#game'] }, ready: { selector: 'canvas', frames: ['#game'] },
    reset: [{ type: 'click', target: { selector: '#reset', frames: ['#game'] } }], objective: 'Move a square with a visible counter.', maxDurationMs: 4000,
    controller: { type: 'timed', actions: [{ type: 'key', key: 'ArrowRight', durationMs: 100 }, { type: 'wait', durationMs: 1000 }], repetitions: 2 },
  });

  await t.test('native events use the real iframe surface and reset its state', async () => {
    const page = await browser.newPage({ viewport: profile.viewport });
    try {
      await page.goto(base);
      await locate(page, profile.surface).click();
      const executor = new InputExecutor(page, profile.surface);
      await executor.execute({ type: 'key', key: 'ArrowRight', durationMs: 50 });
      const body = page.frameLocator('#game').locator('body');
      assert.equal(await body.getAttribute('data-moves'), '1');
      assert.equal(await body.getAttribute('data-held'), 'false');
      assert.equal(await body.getAttribute('data-trusted'), 'true');
      const bounds = await gameBounds(page, profile.surface);
      assert.ok(bounds.x > 0 && bounds.y > 0);
      await executor.execute({ type: 'tap', point: { x: 0.5, y: 0.5 } });
      assert.equal(await body.getAttribute('data-pointer'), '250,250');
      await resetGame(page, profile);
      assert.equal(await body.getAttribute('data-moves'), '0');
    } finally { await page.close(); }
  });

  await t.test('two actual native VP9 recordings complete from fresh attempts', async () => {
    for (const name of ['first', 'second']) {
      const result = await runCaptureAttempt({ profile, outputPath: join(directory, `${name}.webm`), allowLocalGame: true });
      assert.equal(result.artifact.codec, 'vp9');
      assert.equal(result.artifact.width, 640);
      assert.equal(result.artifact.height, 800);
      assert.ok(result.artifact.durationSeconds >= 2);
      assert.equal(result.actionsExecuted, 4);
      assert.equal(result.stopReason, 'actions_complete');
      assert.equal(result.gameUrl, base);
    }
  });

  await t.test('a DOM Start can reveal a hidden canvas after recording starts', async () => {
    const actions: ActionProgress[] = [];
    const hidden = gameProfileSchema.parse({ ...profile, gameUrl: `${base}/hidden`, focus: 'click',
      ready: { selector: '#start', frames: ['#game'] }, start: [{ type: 'click', target: { selector: '#start', frames: ['#game'] } }],
    });
    const result = await runCaptureAttempt({ profile: hidden, outputPath: join(directory, 'hidden.webm'), allowLocalGame: true, onAction: action => actions.push(action) });
    assert.equal(result.artifact.codec, 'vp9');
    assert.equal(result.surfaceBounds.width, 500);
    assert.ok(result.artifact.durationSeconds >= 2);
    assert.deepEqual(actions.filter(action => action.status === 'completed').map(action => action.phase), ['start', 'focus', 'control', 'control', 'control', 'control']);
    assert.ok(actions[0]!.recordingElapsedMs !== null, 'the Start click must be recorded');
  });
});
