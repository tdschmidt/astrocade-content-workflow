import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
import { discoverGames } from './discovery.js';

test('discovery reads current image-alt titles without treating unlabeled badges as metrics', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const observed = await readFile(new URL('./fixtures/discovery-live-cards.html', import.meta.url), 'utf8');
  // Extra synthetic variants prove explicitly labeled metrics are still usable.
  const variants = `<article><a href="/games/accessible-runner/fixture-plays"><img alt="Accessible Runner"><span aria-label="2.1K plays">2.1K</span></a></article>
    <article><a href="/games/accessible-likes/fixture-likes"><h3>Accessible Likes</h3><span data-slot="badge" aria-label="Likes">14</span></a><p>by Fixture Creator</p></article>
    <article><a href="/games/number-puzzle/fixture-number"><h3>2048</h3></a><p>12 players</p></article>
    <article><a href="/games/slug-fallback/fixture-slug"><span>92K</span></a></article>`;
  const html = observed.replace('<html>', '<html><head><base href="https://www.astrocade.com/"></head>').replace('</body>', `${variants}</body>`);
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const result = await discoverGames({ browser, urls: [`http://127.0.0.1:${address.port}/cards`], allowLocalSources: true });
  assert.equal(result.status, 'ok');
  assert.equal(result.candidates.length, 8);
  assert.deepEqual(result.candidates.slice(0, 4).map(candidate => ({ title: candidate.title, creator: candidate.creator, titleSource: candidate.titleSource, metrics: candidate.metrics })), [
    { title: 'Steal A Anime', creator: 'Tupakiin', titleSource: 'image_alt', metrics: [] },
    { title: 'Jungle_ Mission', creator: 'Suaibx_yt', titleSource: 'image_alt', metrics: [] },
    { title: 'The journey begins', creator: 'DeathBlast', titleSource: 'image_alt', metrics: [] },
    { title: 'Pickaxe Swing Escape', creator: 'Laxci', titleSource: 'image_alt', metrics: [] },
  ]);
  assert.match(result.candidates[0]!.observations[0]!.cardText, /Image alt: Steal A Anime by Tupakiin/);
  assert.deepEqual(result.candidates[4]!.metrics, [{ label: 'plays', raw: '2.1K plays', value: 2100, approximate: true }]);
  assert.equal(result.candidates[4]!.title, 'Accessible Runner');
  assert.deepEqual(result.candidates[5]!.metrics, [{ label: 'likes', raw: '14 Likes', value: 14, approximate: false }]);
  assert.equal(result.candidates[5]!.creator, 'Fixture Creator');
  assert.equal(result.candidates[6]!.title, '2048');
  assert.equal(result.candidates[6]!.titleSource, 'visible_text');
  assert.equal(result.candidates[6]!.metrics[0]!.label, 'players');
  assert.equal(result.candidates[7]!.title, 'slug fallback');
  assert.equal(result.candidates[7]!.titleSource, 'url_slug');
  assert.deepEqual(result.candidates[7]!.metrics, []);
});
