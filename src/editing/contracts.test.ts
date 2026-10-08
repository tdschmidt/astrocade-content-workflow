import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { editorSettingsSchema, prepareEditor, verifyEditorInputs } from './contracts.js';

test('a reviewed audio subset is bound to the saved run and cannot change on resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'editor-catalog-'));
  try {
    const audioCatalogPath = join(dir, 'catalog.json');
    await writeFile(audioCatalogPath, JSON.stringify({ assets: [{ id: 'reviewed-music' }] }));
    const settings = await prepareEditor({ format: 'meme', audioCatalogPath });
    const restored = editorSettingsSchema.parse(JSON.parse(JSON.stringify(settings)));
    assert.equal(restored.audioCatalog?.path, audioCatalogPath);
    await verifyEditorInputs(restored);
    await writeFile(audioCatalogPath, JSON.stringify({ assets: [{ id: 'unreviewed-replacement' }] }));
    await assert.rejects(verifyEditorInputs(restored), /saved editorial input changed/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('audio catalog options cannot silently disappear into a narrated or legacy edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'editor-catalog-format-'));
  try {
    const audioCatalogPath = join(dir, 'catalog.json');
    await writeFile(audioCatalogPath, '{}');
    for (const format of ['overview', 'legacy'] as const) {
      await assert.rejects(prepareEditor({ format, audioCatalogPath }), /only applies to meme/u);
    }
    assert.equal((await prepareEditor({ format: 'meme' })).audioCatalog, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
