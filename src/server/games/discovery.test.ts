import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
import { balanceDiscoverySources, discoverGames } from './discovery.js';

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

test('discovery balances sources without losing repeated-source evidence', () => {
  const candidate = (id: string, sources: string[]) => ({ id, title: id, titleSource: 'visible_text' as const, url: `https://www.astrocade.com/games/${id}/${id}`, metrics: [], observations: sources.map(sourceUrl => ({ sourceUrl, observedAt: '2026-10-07T00:00:00Z', cardText: id })) });
  const games = [candidate('a', ['first', 'second']), candidate('b', ['first']), candidate('c', ['first']), candidate('d', ['second']), candidate('e', ['third'])];
  const balanced = balanceDiscoverySources(games, ['first', 'second', 'third'], 3);
  assert.deepEqual(balanced.map(game => game.id), ['a', 'd', 'e']);
  assert.equal(balanced[0]!.observations.length, 2);
  assert.equal(balanceDiscoverySources(games, ['empty', 'first', 'second', 'third'], 20).length, 5);
});

test('discovery waits for visible hydration and scrolls the inner catalog past an unchanged viewport', { skip: process.env.RUN_BROWSER_TESTS !== '1', timeout: 20000 }, async t => {
  const html = `<html><head><base href="https://www.astrocade.com/"><style>
    body{margin:0;overflow:hidden}#catalog{margin-left:100px;width:600px;height:600px;overflow-y:auto}
    article{height:180px}.animate-pulse{width:200px;height:80px;background:#ccc}
  </style></head><body><div id="catalog">
    <article><a href="/games/initial/initial"><h3>Initial game</h3><div class="animate-pulse"></div></a></article>
    <div id="pending" class="animate-pulse"></div><div style="height:2400px"></div>
  </div><script>
    const catalog=document.getElementById('catalog');
    function card(id,title){const node=document.createElement('article');node.innerHTML='<a href="/games/'+id+'/'+id+'"><h3>'+title+'</h3></a>';catalog.append(node)}
    setTimeout(()=>{card('hydrated','Hydrated rhythm');document.getElementById('pending').remove()},1600);
    let added=false;catalog.addEventListener('scroll',()=>{if(!added&&catalog.scrollTop>1000){added=true;card('later','Later strategy')}});
  </script></body></html>`;
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const result = await discoverGames({ browser, urls: [`http://127.0.0.1:${address.port}/`], allowLocalSources: true, scrollPages: 2 });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.candidates.map(candidate => candidate.title), ['Initial game', 'Hydrated rhythm', 'Later strategy']);
  assert.equal(result.sources[0]!.candidateCount, 3);
});
