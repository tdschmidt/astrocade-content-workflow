import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { z } from 'zod';
import type { Inference, MediaInput } from '../server/providers/inference.js';
import { Trace, traceInference } from './trace.js';

async function directoryFor(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-response-trace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('structured response tracing preserves binding, arguments and return identity without logging inputs', async t => {
  const directory = await directoryFor(t);
  const secret = 'fixture-"quoted"-key\\with\nnewline';
  const returned = { cuts: [{ startSeconds: 1, endSeconds: 4 }], evidence: `Configured value: ${secret}` };
  const schema = z.object({ cuts: z.array(z.object({ startSeconds: z.number(), endSeconds: z.number() })), evidence: z.string() });
  const media: MediaInput[] = [{ type: 'image', data: 'PRIVATE_BASE64_INPUT', mime_type: 'image/jpeg' }];
  const signal = new AbortController().signal;
  const source: Inference = {
    async json<T>(prompt: string, receivedSchema: z.ZodType<T>, receivedMedia?: MediaInput[], receivedSignal?: AbortSignal): Promise<T> {
      assert.equal(this, source);
      assert.equal(prompt, 'PRIVATE_PROMPT_INPUT');
      assert.equal(receivedSchema, schema);
      assert.equal(receivedMedia, media);
      assert.equal(receivedSignal, signal);
      return returned as T;
    },
    async withVideo(path, operation, receivedSignal) {
      assert.equal(this, source);
      assert.equal(receivedSignal, signal);
      return operation({ uri: path, mimeType: 'video/webm' });
    },
  };
  const provider = traceInference(source, new Trace(directory, true), 'fixture-provider', 'fixture-model', ['', secret]);
  const result = await provider.withVideo('PRIVATE_VIDEO_PATH', async video => {
    assert.equal(video.uri, 'PRIVATE_VIDEO_PATH');
    return provider.json('PRIVATE_PROMPT_INPUT', schema, media, signal);
  }, signal);
  assert.equal(result, returned, 'logging must not redact or clone the provider return value');
  const text = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  const record = JSON.parse(text);
  assert.equal(record.stage, 'provider.response');
  assert.equal(record.status, 'returned');
  assert.equal(record.data.provider, 'fixture-provider');
  assert.equal(record.data.model, 'fixture-model');
  assert.match(record.data.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(record.data.response, { ...returned, evidence: 'Configured value: [redacted]' });
  for (const privateValue of ['PRIVATE_PROMPT_INPUT', 'PRIVATE_BASE64_INPUT', 'PRIVATE_VIDEO_PATH', 'quoted']) {
    assert.equal(text.includes(privateValue), false);
  }
  assert.equal(returned.evidence, `Configured value: ${secret}`);
});

test('oversize structured responses produce a bounded omission record without changing the response', async t => {
  const directory = await directoryFor(t);
  const returned = { text: '🪐'.repeat(17000) };
  const source = { json: async () => returned, withVideo: async () => { throw new Error('unused'); } } as unknown as Inference;
  const result = await traceInference(source, new Trace(directory, true), 'fixture', 'fixture').json('not logged', z.object({ text: z.string() }));
  assert.equal(result, returned);
  const text = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  const { response } = JSON.parse(text).data;
  assert.equal(response.omitted, true);
  assert.ok(response.bytes > 64 * 1024, 'bound is measured in UTF-8 bytes, not string characters');
  assert.match(response.reason, /64 KB/);
  assert.ok(Buffer.byteLength(text) < 1024);
  assert.equal(text.includes('🪐'), false);
});

test('provider-internal failures remain unchanged and produce no invented structured response', async t => {
  const directory = await directoryFor(t);
  const failure = new Error('provider-internal schema rejection');
  const source = { json: async () => { throw failure; }, withVideo: async () => { throw new Error('unused'); } } as unknown as Inference;
  await assert.rejects(traceInference(source, new Trace(directory, true), 'fixture', 'fixture').json('not logged', z.object({})), error => error === failure);
  await assert.rejects(readFile(join(directory, 'trace.jsonl')), { code: 'ENOENT' });
});
