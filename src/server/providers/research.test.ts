import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleServices } from './google.js';
import { refreshResearch } from './research.js';

function googleFixture(responses: unknown[]): GoogleServices {
  return { json: async () => { if (!responses.length) throw new Error('unexpected model call'); return responses.shift(); } } as unknown as GoogleServices;
}

test('research bounds calls, preserves source dates, and labels failed extraction honestly', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const google = googleFixture([
    { queries: ['topic original source', 'topic conflicting evidence', 'topic original source'] },
    { sourceIndices: [0, 1] },
    { summary: 'The first source supports the idea [S1]. The second is only a search excerpt [S2].', terms: ['Game', 'game'] },
  ]);
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const body = JSON.parse(String(init?.body)); calls.push({ url, body });
    if (url.endsWith('/search')) return Response.json({ results: [
      { title: 'Original source', url: 'https://creator.example/original', content: 'First excerpt', published_date: '2026-10-01' },
      { title: 'Other source', url: 'https://archive.example/record', content: 'Second excerpt' },
    ] });
    if (url.endsWith('/extract')) return Response.json({ results: [{ url: 'https://creator.example/original', raw_content: 'Original extracted evidence.' }], failed_results: [{ url: 'https://archive.example/record', error: 'unavailable' }] });
    throw new Error('No other endpoints permitted');
  }) as typeof fetch;
  const result = await refreshResearch('topic', 'fixture-key', google, undefined, http);
  assert.equal(calls.filter(call => call.url.endsWith('/search')).length, 2);
  assert.equal(calls.filter(call => call.url.endsWith('/extract')).length, 1);
  assert.ok(calls.every(call => !call.url.endsWith('/research')));
  assert.deepEqual(result.sources.map(source => source.observation), ['extracted_text', 'search_excerpt']);
  assert.ok(result.sources[0]!.content.includes('2026-10-01'));
  assert.ok(result.sources[1]!.content.includes('Publication date reported by search: unknown'));
  assert.ok(result.summary.includes('source videos were not watched'));
  assert.ok(result.summary.includes('[Original source](https://creator.example/original)'));
  assert.deepEqual(result.terms, ['game']);
});

test('invalid model source selection cannot trigger extraction', async () => {
  let extracts = 0;
  const http = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/extract')) extracts++;
    return Response.json({ results: [{ title: 'Source', url: 'https://source.example/page', content: 'Evidence' }] });
  }) as typeof fetch;
  await assert.rejects(refreshResearch('topic', 'fixture-key', googleFixture([{ queries: ['topic evidence'] }, { sourceIndices: [99] }]), undefined, http), /not retrieved/);
  assert.equal(extracts, 0);
});

test('missing API key fails before model or HTTP calls', async () => {
  await assert.rejects(refreshResearch('topic', '', googleFixture([]), undefined, async () => { throw new Error('unexpected network'); }), /Tavily API key/);
});
