import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { JsonStore } from './store.js';

test('serializes updates without lost writes and preserves the last valid state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-store-'));
  try {
    const file = join(directory, 'state.json');
    const schema = z.object({ count: z.number().nonnegative() });
    const store = await JsonStore.open(file, schema, { count: 0 });
    await Promise.all(Array.from({ length: 12 }, () => store.update(state => { state.count++; })));
    assert.equal(store.read().count, 12);
    await assert.rejects(store.update(state => { state.count = -1; }));
    assert.equal(JSON.parse(await readFile(file, 'utf8')).count, 12);
    const snapshot = store.read();
    snapshot.count = 999;
    assert.equal(store.read().count, 12);
    const reopened = await JsonStore.open(file, schema, { count: 0 });
    assert.equal(reopened.read().count, 12);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
