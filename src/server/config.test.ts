import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Configuration } from './config.js';

test('public setup status excludes credentials and private identity data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-config-'));
  try {
    const config = await Configuration.open(directory);
    await config.save({ geminiApiKey: 'private-key', instagramPassword: 'private-password', instagramBirthday: '1990-01-01' });
    const serialized = JSON.stringify(config.publicSettings());
    assert.equal(serialized.includes('private-key'), false);
    assert.equal(serialized.includes('private-password'), false);
    assert.equal(serialized.includes('1990-01-01'), false);
    assert.equal(config.publicSettings().geminiApiKeyConfigured, true);
    assert.equal((await stat(join(directory, 'settings.json'))).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
