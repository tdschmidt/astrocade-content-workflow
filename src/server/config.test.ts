import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Configuration } from './config.js';

test('legacy account settings are ignored without changing existing local data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-config-'));
  try {
    const path = join(directory, 'settings.json');
    const original = JSON.stringify({ reasoningModel: 'saved-model', instagramPassword: 'retired-secret', mailtm: { old: 'data' } });
    await writeFile(path, original, { mode: 0o600 });
    const config = await Configuration.open(directory);
    assert.equal(config.get().reasoningModel, 'saved-model');
    assert.equal('instagramPassword' in config.get(), false);
    assert.equal('mailtm' in config.get(), false);
    assert.equal(await readFile(path, 'utf8'), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local inference settings persist privately and reject retired account fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-config-'));
  try {
    const config = await Configuration.open(directory);
    await config.save({ geminiApiKey: 'private-key', voice: 'saved-voice' });
    const reopened = await Configuration.open(directory);
    assert.equal(reopened.store.read().geminiApiKey, 'private-key');
    assert.equal(reopened.get().voice, 'saved-voice');
    assert.equal((await stat(join(directory, 'settings.json'))).mode & 0o777, 0o600);
    await assert.rejects(config.save({ instagramPassword: 'retired-secret' } as never), /Unrecognized key/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
