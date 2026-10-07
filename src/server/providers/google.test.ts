import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { settingsSchema } from '../config.js';
import { inputActionSchema } from '../games/schema.js';
import { GoogleServices, retryDelayMs, seconds, type GoogleProgressEvent } from './google.js';

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
  const events: GoogleProgressEvent[] = [];
  const google = new GoogleServices(settings, event => events.push(event));
  const client = Reflect.get(google, 'client') as GoogleGenAI;
  const deleted: string[] = [];
  t.mock.method(client.files, 'upload', async () => ({ name: 'files/fixture', state: 'ACTIVE', uri: 'fixture-uri', mimeType: 'video/webm' }));
  t.mock.method(client.files, 'delete', async (input: { name: string }) => { deleted.push(input.name); return {}; });
  await assert.rejects(google.withVideo('/unused-fixture.webm', async () => { throw new Error('analysis failed'); }), /analysis failed/);
  assert.deepEqual(deleted, ['files/fixture']);
  assert.deepEqual(events.map(event => `${event.stage}:${event.status}`), ['upload:started', 'upload:completed', 'processing:started', 'processing:completed', 'ready:completed', 'cleanup:started', 'cleanup:completed']);
  events.length = 0;
  t.mock.method(client.files, 'upload', async () => ({ name: 'files/failed', state: 'FAILED' }));
  await assert.rejects(google.withVideo('/unused-fixture.webm', async () => { throw new Error('must not analyze'); }), /could not process/);
  assert.deepEqual(deleted, ['files/fixture', 'files/failed']);
  assert.ok(events.some(event => event.stage === 'processing' && event.status === 'failed'));
  assert.ok(!events.some(event => event.stage === 'ready'));
});

test('incomplete model responses and malformed timestamps fail explicitly', async t => {
  mockInteraction(t, [{ type: 'text', text: '{"usable":true}' }], undefined, 'incomplete');
  await assert.rejects(new GoogleServices(settings).json('fixture', z.object({ usable: z.boolean() })), /did not complete/);
  assert.equal(seconds('1.250s'), 1.25);
  assert.equal(seconds('0s'), 0);
  for (const value of ['', '-1s', 'NaN', '00:01.5', '1e3s']) assert.throws(() => seconds(value));
});

test('JSON, speech, and transcription never retry an authentication error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'google-retry-fixture-'));
  try {
    const path = join(directory, 'speech.wav');
    await writeFile(path, wave());
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return Response.json({ error: { code: 401, message: 'Fixture unauthorized', status: 'UNAUTHENTICATED' } }, { status: 401 });
    });
    const google = new GoogleServices(settings);
    await assert.rejects(google.json('fixture', z.object({ usable: z.boolean() })));
    assert.equal(requests, 1);
    await assert.rejects(google.speak('fixture', join(directory, 'unused.wav')));
    assert.equal(requests, 2);
    await assert.rejects(google.transcribe(path));
    assert.equal(requests, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('upload handshake and body each receive the 45-second deadline and no HTTP retries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'google-upload-fixture-'));
  try {
    const path = join(directory, 'synthetic.webm');
    await writeFile(path, 'LOCAL TRANSPORT FIXTURE, NOT A VIDEO');
    t.mock.method(globalThis, 'fetch', async () => assert.fail('A canceled upload must not start a request'));
    await assert.rejects(new GoogleServices(settings).withVideo(path, async () => assert.fail('Canceled analysis'), AbortSignal.abort()));
    for (const failAt of [1, 2]) {
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        requests++;
        const request = input instanceof Request ? input : new Request(input, init);
        assert.equal(request.headers.get('x-server-timeout'), '45');
        if (requests < failAt) return new Response('', { headers: { 'x-goog-upload-url': 'https://fixture.invalid/upload' } });
        return Response.json({ error: { code: 503, message: 'Fixture unavailable' } }, { status: 503 });
      });
      await assert.rejects(new GoogleServices(settings).withVideo(path, async () => assert.fail('Failed uploads must not enter analysis')));
      assert.equal(requests, failAt);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('explicit transient retries succeed on the third request and emit safe progress', async t => {
  const events: GoogleProgressEvent[] = [];
  const bodies: string[] = [];
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    bodies.push(input instanceof Request ? await input.clone().text() : String(init?.body));
    if (bodies.length < 3) {
      const status = bodies.length === 1 ? 503 : 429;
      return Response.json({ error: { code: status, message: settings.geminiApiKey } }, { status });
    }
    return Response.json({ id: 'fixture', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"usable":true}' }] }] });
  });
  assert.deepEqual(await new GoogleServices(settings, event => events.push(event)).json('fixture', z.object({ usable: z.boolean() })), { usable: true });
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(body => body === bodies[0]));
  assert.deepEqual(events.map(event => `${event.attempt}:${event.status}`), ['1:started', '1:retrying', '2:started', '2:retrying', '3:started', '3:completed']);
  assert.deepEqual(events.filter(event => event.status === 'retrying').map(event => event.retryAfterMs), [750, 1500]);
  assert.ok(events.every(event => event.model === settings.reasoningModel && event.stage === 'json'));
  assert.ok(!JSON.stringify(events).includes(settings.geminiApiKey));
});

test('overload stops after three total attempts, with no hidden SDK retries', async t => {
  let requests = 0;
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: { code: 503, message: 'Fixture overloaded' } }, { status: 503 }); });
  await assert.rejects(new GoogleServices(settings).json('fixture', z.object({ usable: z.boolean() })));
  assert.equal(requests, 3);
});

test('Retry-After can exceed 15 seconds but cannot exceed the shared deadline', async t => {
  const error = (value: string, status = 503) => ({ status, headers: new Headers({ 'retry-after': value }) });
  assert.equal(retryDelayMs(error('10'), 1, 0, 0), 10_000);
  assert.equal(retryDelayMs(error('Thu, 01 Jan 1970 00:00:10 GMT'), 1, 0, 0), 10_000);
  assert.equal(retryDelayMs(error('Thu, 01 Jan 1970 00:00:00 GMT'), 1, 1000, 0), 750);
  for (const value of ['invalid', '-1', '1.5']) assert.equal(retryDelayMs(error(value), 1, 0, 0), 750);
  assert.equal(retryDelayMs(error('60'), 1, 0, 0), 60_000);
  assert.equal(retryDelayMs(error('90'), 1, 0, 0), 90_000);
  assert.equal(retryDelayMs(error('1'), 3, 0, 0), undefined);
  assert.equal(retryDelayMs(error('1', 403), 1, 0, 0), undefined);
  let requests = 0;
  const events: GoogleProgressEvent[] = [];
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: { code: 429, message: 'Fixture quota' } }, { status: 429, headers: { 'retry-after': '120' } }); });
  await assert.rejects(new GoogleServices(settings, event => events.push(event)).json('fixture', z.object({ usable: z.boolean() })));
  assert.equal(requests, 1);
  assert.equal(events.at(-1)?.retryAfterMs, 120_000);
  assert.match(events.at(-1)!.message!, /remaining deadline/);
});

test('a 60-second Retry-After enters cancellable backoff instead of failing immediately', async t => {
  const controller = new AbortController();
  const events: GoogleProgressEvent[] = [];
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ error: { code: 503, message: 'Fixture overloaded' } }, { status: 503, headers: { 'retry-after': '60' } });
  });
  const google = new GoogleServices(settings, event => {
    events.push(event);
    if (event.status === 'retrying') controller.abort();
  });
  await assert.rejects(google.json('fixture', z.object({ usable: z.boolean() }), [], controller.signal));
  assert.equal(requests, 1);
  assert.equal(events.find(event => event.status === 'retrying')?.retryAfterMs, 60_000);
});

test('wire schema omits nested maxItems while local bounds still reject oversized model output', async t => {
  const schema = z.object({ plans: z.array(z.object({ actions: z.array(z.object({ seconds: z.number().min(0).max(2) })).min(1).max(2) })).max(1) });
  const valid = { plans: [{ actions: [{ seconds: 1 }] }] };
  let output: unknown = valid;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests++;
    const body = JSON.parse(input instanceof Request ? await input.clone().text() : String(init?.body));
    const plans = body.response_format.schema.properties.plans;
    assert.equal(plans.maxItems, undefined);
    assert.equal(plans.items.properties.actions.maxItems, undefined);
    assert.equal(plans.items.properties.actions.minItems, 1);
    assert.equal(plans.items.properties.actions.items.properties.seconds.maximum, 2);
    return Response.json({ id: 'fixture', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(output) }] }] });
  });
  const google = new GoogleServices(settings);
  assert.deepEqual(await google.json('fixture', schema), valid);
  output = { plans: [{ actions: [{ seconds: 1 }, { seconds: 1 }, { seconds: 1 }] }] };
  await assert.rejects(google.json('fixture', schema), z.ZodError);
  output = { plans: [valid.plans[0], valid.plans[0]] };
  await assert.rejects(google.json('fixture', schema), z.ZodError);
  assert.equal(requests, 3, 'invalid structured responses must not be retried');
});

test('literal action types use singleton enums on the wire and invalid aliases still fail locally', async t => {
  const schema = z.object({ actions: z.array(inputActionSchema).max(2) });
  const valid = { actions: [{ type: 'key', key: 'ArrowLeft', durationMs: 250 }] };
  let output: unknown = valid;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests++;
    const body = JSON.parse(input instanceof Request ? await input.clone().text() : String(init?.body));
    const alternatives = body.response_format.schema.properties.actions.items.oneOf;
    assert.deepEqual(alternatives.map((branch: any) => branch.properties.type.enum), [['key'], ['tap'], ['drag'], ['wait']]);
    assert.ok(alternatives.every((branch: any) => branch.properties.type.const === undefined));
    assert.equal(alternatives[0].properties.durationMs.maximum, 2000);
    return Response.json({ id: 'fixture', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(output) }] }] });
  });
  const google = new GoogleServices(settings);
  assert.deepEqual(await google.json('fixture', schema), valid);
  output = { actions: [{ type: 'keydown', key: 'ArrowLeft', durationMs: 250 }] };
  await assert.rejects(google.json('fixture', schema), z.ZodError);
  output = { actions: [{ type: 'tap', index: 0 }] };
  await assert.rejects(google.json('fixture', schema), z.ZodError);
  assert.equal(requests, 3);
});

test('cancellation during backoff prevents another attempt', async t => {
  let requests = 0;
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: { code: 503, message: 'Fixture overloaded' } }, { status: 503 }); });
  const google = new GoogleServices(settings, event => { if (event.status === 'retrying') controller.abort(); });
  await assert.rejects(google.json('fixture', z.object({ usable: z.boolean() }), [], controller.signal));
  assert.equal(requests, 1);
});

test('retries share the original deadline and schema failures are never retried', async t => {
  let now = 1000;
  let requests = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    requests++; now += 119_900;
    return Response.json({ error: { code: 503, message: 'Fixture overloaded' } }, { status: 503 });
  });
  await assert.rejects(new GoogleServices(settings).json('fixture', z.object({ usable: z.boolean() })));
  assert.equal(requests, 1);
  mockInteraction(t, [{ type: 'text', text: '{"usable":"wrong type"}' }], () => { requests++; });
  await assert.rejects(new GoogleServices(settings).json('fixture', z.object({ usable: z.boolean() })));
  assert.equal(requests, 2);
});
