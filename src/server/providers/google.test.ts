import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { settingsSchema } from '../config.js';
import { GoogleServices, seconds } from './google.js';

const settings = settingsSchema.parse({ geminiApiKey: 'fixture-key-never-sent' });

function mockInteraction(t: TestContext, content: unknown[], inspect: (request: Record<string, any>) => void = () => {}, status = 'completed') {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/[^/]+\/interactions(?:\?|$)/);
    const body = input instanceof Request ? await input.clone().text() : String(init?.body);
    inspect(JSON.parse(body));
    return Response.json({ id: 'fixture-interaction', status, steps: [{ type: 'model_output', content }] });
  });
}

function wave(): Buffer {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24); bytes.writeUInt32LE(48_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
  return bytes;
}

test('SDK wire contract: structured JSON and dense video metadata round-trip from actual model_output steps', async t => {
  let requests = 0;
  mockInteraction(t, [{ type: 'text', text: '{"usable":true}' }], request => {
    requests++;
    assert.equal(request.model, settings.reasoningModel);
    assert.equal(request.store, false);
    assert.equal(request.stream, false);
    assert.equal(request.generation_config.thinking_level, 'low');
    assert.equal(request.response_format.mime_type, 'application/json');
    assert.equal(request.response_format.schema.$schema, undefined);
    assert.equal(request.response_format.schema.properties.usable.type, 'boolean');
    assert.deepEqual(request.input[1], { type: 'video', uri: 'https://fixture.example/video', mime_type: 'video/webm', processing: { type: 'static', fps: 8, start_offset: '10s', end_offset: '20s' } });
  });
  const result = await new GoogleServices(settings).json('Analyze only this window.', z.object({ usable: z.boolean() }), [
    { type: 'video', uri: 'https://fixture.example/video', mime_type: 'video/webm', processing: { type: 'static', fps: 8, start_offset: '10s', end_offset: '20s' } },
  ]);
  assert.deepEqual(result, { usable: true });
  assert.equal(requests, 1);
});

test('SDK wire contract: speech explicitly requests inline WAV and writes the returned bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'google-speech-fixture-'));
  try {
    const bytes = wave();
    mockInteraction(t, [{ type: 'audio', mime_type: 'audio/wav', data: bytes.toString('base64') }], request => {
      assert.equal(request.model, settings.speechModel);
      assert.deepEqual(request.response_format, { type: 'audio', mime_type: 'audio/wav', delivery: 'inline' });
      assert.equal(request.input[0].text, 'The exact line.');
      assert.equal(request.input[0].annotations[0].type, 'speech_metadata');
      assert.equal(request.generation_config.speech_config[0].voice, settings.voice);
    });
    const path = join(directory, 'speech.wav');
    await new GoogleServices(settings).speak('The exact line.', path);
    assert.deepEqual(await readFile(path), bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SDK wire contract: verbatim transcription extracts word_info offsets from response steps', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'google-transcription-fixture-'));
  try {
    const bytes = wave();
    const path = join(directory, 'speech.wav');
    await writeFile(path, bytes);
    mockInteraction(t, [{ type: 'text', text: 'Hello world.', annotations: [
      { type: 'word_info', text: 'Hello', start_offset: '0.1s', end_offset: '0.4s' },
      { type: 'word_info', text: 'world.', start_offset: '0.5s', end_offset: '0.9s' },
    ] }], request => {
      assert.equal(request.model, settings.transcriptionModel);
      assert.deepEqual(request.generation_config.transcription_config, { mode: { type: 'verbatim', timestamp_granularities: ['word'] } });
      assert.equal(request.input[0].mime_type, 'audio/wav');
      assert.equal(request.input[0].data, bytes.toString('base64'));
    });
    assert.deepEqual(await new GoogleServices(settings).transcribe(path), {
      text: 'Hello world.', words: [{ text: 'Hello', startSeconds: 0.1, endSeconds: 0.4 }, { text: 'world.', startSeconds: 0.5, endSeconds: 0.9 }],
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('uploaded footage is deleted after an analysis failure and a failed file never enters analysis', async t => {
  const google = new GoogleServices(settings);
  const client = Reflect.get(google, 'client') as GoogleGenAI;
  const deleted: string[] = [];
  t.mock.method(client.files, 'upload', async () => ({ name: 'files/fixture', state: 'ACTIVE', uri: 'fixture-uri', mimeType: 'video/webm' }));
  t.mock.method(client.files, 'delete', async (input: { name: string }) => { deleted.push(input.name); return {}; });
  await assert.rejects(google.withVideo('/unused-fixture.webm', async () => { throw new Error('analysis failed'); }), /analysis failed/);
  assert.deepEqual(deleted, ['files/fixture']);
  t.mock.method(client.files, 'upload', async () => ({ name: 'files/failed', state: 'FAILED' }));
  await assert.rejects(google.withVideo('/unused-fixture.webm', async () => { throw new Error('must not analyze'); }), /could not process/);
  assert.deepEqual(deleted, ['files/fixture', 'files/failed']);
});

test('incomplete model responses and malformed timestamps fail explicitly', async t => {
  mockInteraction(t, [{ type: 'text', text: '{"usable":true}' }], undefined, 'incomplete');
  await assert.rejects(new GoogleServices(settings).json('fixture', z.object({ usable: z.boolean() })), /did not complete/);
  assert.equal(seconds('1.250s'), 1.25);
  assert.equal(seconds('0s'), 0);
  for (const value of ['', '-1s', 'NaN', '00:01.5', '1e3s']) assert.throws(() => seconds(value));
});
