import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { inputActionSchema } from '../games/schema.js';
import { codexEnvironment, CodexServices, executeCodex, type CodexExecutor } from './codex.js';
import type { InferenceProgressEvent } from './inference.js';

const schema = z.object({ usable: z.boolean() });
const options = { reasoningModel: 'fixture-model' };
const login = { stdout: '', stderr: 'Logged in using ChatGPT\n' };
const completed = { stdout: '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}', stderr: '' };
const outputFile = (args: string[]) => args[args.indexOf('--output-last-message') + 1]!;

test('Codex uses ChatGPT, isolated input files and schema output, retaining only safe usage totals', async () => {
  const events: InferenceProgressEvent[] = [];
  let directory = ''; let calls = 0;
  const execute: CodexExecutor = async command => {
    calls++; directory = command.cwd;
    if (command.args[0] === 'login') return login;
    assert.ok(command.args.includes('--ignore-user-config'));
    assert.ok(command.args.includes('--ephemeral'));
    assert.ok(command.args.includes('read-only'));
    assert.ok(command.args.includes('forced_login_method="chatgpt"'));
    assert.ok(command.args.includes('model_provider="openai"'));
    assert.ok(command.args.includes('web_search="disabled"'));
    assert.ok(command.args.includes('model_reasoning_effort="low"'));
    assert.ok(!command.args.some(argument => argument.startsWith('service_tier=')));
    assert.ok(command.args.includes('shell_tool'));
    assert.equal(command.env.OPENAI_API_KEY, undefined);
    assert.equal(command.env.CODEX_API_KEY, undefined);
    const imagePath = command.args[command.args.indexOf('--image') + 1]!;
    assert.equal(await readFile(imagePath, 'utf8'), 'fixture-image');
    const wire = JSON.parse(await readFile(command.args[command.args.indexOf('--output-schema') + 1]!, 'utf8'));
    assert.equal(wire.properties.usable.type, 'boolean');
    assert.equal(wire.additionalProperties, false);
    assert.match(command.stdin!, /Image 1: supplied screenshot/);
    await writeFile(outputFile(command.args), '{"usable":true}');
    return { stdout: 'not-json\n{"type":"reasoning","text":"do not retain this"}\n{"type":"turn.completed","usage":{"input_tokens":24,"output_tokens":9}}', stderr: '' };
  };
  const provider = new CodexServices(options, event => events.push(event), execute);
  assert.deepEqual(await provider.json('Inspect this.', schema, [{ type: 'image', mime_type: 'image/png', data: Buffer.from('fixture-image').toString('base64') }]), { usable: true });
  assert.equal(calls, 2);
  assert.equal(events.at(-1)?.inputTokens, 24);
  assert.equal(events.at(-1)?.outputTokens, 9);
  assert.ok(!JSON.stringify(events).includes('do not retain'));
  await assert.rejects(access(directory));
});

test('Codex clears API overrides without changing the parent environment or credential-store location', () => {
  const source = { PATH: '/fixture/bin', HOME: '/fixture/home', CODEX_HOME: '/fixture/codex', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', CODEX_ACCESS_TOKEN: 'secret', OPENAI_BASE_URL: 'https://fixture.invalid' };
  const clean = codexEnvironment(source);
  assert.deepEqual(clean, { PATH: source.PATH, HOME: source.HOME, CODEX_HOME: source.CODEX_HOME });
  assert.equal(source.OPENAI_API_KEY, 'secret');
});

test('Codex rejects API-key login before inference and rechecks login on every request', async () => {
  let loggedIn = true; let inferenceCalls = 0; const directories: string[] = [];
  const provider = new CodexServices(options, undefined, async command => {
    directories.push(command.cwd);
    if (command.args[0] === 'login') return loggedIn ? login : { stdout: '', stderr: 'Logged in using an API key' };
    inferenceCalls++;
    await writeFile(outputFile(command.args), '{"usable":true}');
    return completed;
  });
  await provider.json('First request', schema);
  loggedIn = false;
  await assert.rejects(provider.json('Second request', schema), error => error instanceof Error && Reflect.get(error, 'status') === 401 && /ChatGPT/.test(error.message));
  assert.equal(inferenceCalls, 1);
  for (const directory of directories) await assert.rejects(access(directory));
});

test('malformed JSON and invalid schema values fail explicitly and remove temporary inputs', async () => {
  for (const output of ['not JSON', '{"usable":"yes"}']) {
    let directory = '';
    const provider = new CodexServices(options, undefined, async command => {
      directory = command.cwd;
      if (command.args[0] === 'login') return login;
      await writeFile(outputFile(command.args), output);
      return completed;
    });
    await assert.rejects(provider.json('Fixture', schema), output === 'not JSON' ? /complete JSON/ : z.ZodError);
    await assert.rejects(access(directory));
  }
});

test('nested tagged action unions use supported anyOf while invalid actions still fail local validation', async () => {
  const actionsSchema = z.object({ actions: z.array(inputActionSchema) });
  let output: unknown = { actions: [{ type: 'key', key: 'Space', durationMs: 200 }] };
  const provider = new CodexServices(options, undefined, async command => {
    if (command.args[0] === 'login') return login;
    const wire = JSON.parse(await readFile(command.args[command.args.indexOf('--output-schema') + 1]!, 'utf8'));
    assert.equal(wire.properties.actions.items.oneOf, undefined);
    assert.equal(wire.properties.actions.items.anyOf.length, inputActionSchema.options.length);
    assert.ok(!JSON.stringify(wire).includes('"oneOf"'));
    await writeFile(outputFile(command.args), JSON.stringify(output));
    return completed;
  });
  assert.deepEqual(await provider.json('Fixture', actionsSchema), output);
  output = { actions: [{ type: 'execute', command: 'unapproved action' }] };
  await assert.rejects(provider.json('Fixture', actionsSchema), z.ZodError);
});

test('a saved JSON result requires turn completion and cancellation still wins after output', async () => {
  for (const terminal of ['', '{"type":"turn.failed"}', 'cancel']) {
    const controller = new AbortController();
    let directory = '';
    const provider = new CodexServices({ reasoningModel: 'default' }, undefined, async command => {
      directory = command.cwd;
      if (command.args[0] === 'login') return login;
      assert.ok(!command.args.includes('--model'));
      await writeFile(outputFile(command.args), '{"usable":true}');
      if (terminal === 'cancel') controller.abort(new Error('cancel after output'));
      return terminal === 'cancel' ? completed : { stdout: terminal, stderr: '' };
    });
    await assert.rejects(provider.json('Fixture', schema, [], controller.signal), terminal === 'cancel' ? /cancel after output/ : terminal ? /inference failed/ : /completed turn/);
    await assert.rejects(access(directory));
  }
});

test('request cancellation and shared deadline stop the executor and clean temporary files', async () => {
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    let directory = ''; let inferenceStarted!: () => void;
    const started = new Promise<void>(resolve => { inferenceStarted = resolve; });
    const provider = new CodexServices({ ...options, timeoutMs: cancel ? 5000 : 500 }, undefined, async command => {
      directory = command.cwd;
      if (command.args[0] === 'login') return login;
      inferenceStarted();
      return new Promise((_, reject) => {
        command.signal!.addEventListener('abort', () => reject(command.signal!.reason), { once: true });
        if (command.signal!.aborted) reject(command.signal!.reason);
      });
    });
    const result = provider.json('Fixture', schema, [], controller.signal);
    const rejected = assert.rejects(result, cancel ? /cancel fixture/ : /deadline/);
    await started;
    if (cancel) controller.abort(new Error('cancel fixture'));
    await rejected;
    await assert.rejects(access(directory));
  }
  await assert.rejects(new CodexServices(options, undefined, async () => assert.fail('Cancelled request started')).json('Fixture', schema, [], AbortSignal.abort()));
});

test('subprocess transport kills timed-out and cancelled children and redacts failure output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-transport-fixture-'));
  try {
    const base = { executable: process.execPath, cwd: directory, env: codexEnvironment(), timeoutMs: 1000 };
    await assert.rejects(executeCodex({ ...base, args: ['-e', 'process.stderr.write("secret-fixture-token");process.exit(2)'] }), error => error instanceof Error && /exit 2/.test(error.message) && !error.message.includes('secret-fixture-token'));
    const pidPath = join(directory, 'pid');
    const args = ['-e', 'require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)', pidPath];
    await assert.rejects(executeCodex({ ...base, args, timeoutMs: 1000 }), /deadline/);
    const pid = Number(await readFile(pidPath, 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    const controller = new AbortController();
    const pending = executeCodex({ ...base, args: ['-e', 'setInterval(()=>{},1000)'], signal: controller.signal });
    const rejected = assert.rejects(pending, /cancel fixture/);
    controller.abort(new Error('cancel fixture'));
    await rejected;
    await assert.rejects(executeCodex({ ...base, executable: join(directory, 'nonexistent'), args: [] }), /not found/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('JSONL backend failures identify schema, tier and model problems without exposing their raw text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-error-fixture-'));
  try {
    const cases = [
      ['Invalid schema for response_format: required and additionalProperties invalid; secret-fixture-token', /JSON schema.*required, additionalProperties/],
      ['service_tier default is unsupported; secret-fixture-token', /service-tier setting/],
      ['The model fixture is not supported with ChatGPT; secret-fixture-token', /model is unavailable/],
    ] as const;
    for (const [message, expected] of cases) {
      const event = JSON.stringify({ type: 'turn.failed', error: { message } });
      await assert.rejects(executeCodex({
        executable: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1]);process.exit(1)', event],
        cwd: directory, env: codexEnvironment(), timeoutMs: 1000,
      }), error => error instanceof Error && expected.test(error.message) && Reflect.get(error, 'status') === 400 && !error.message.includes('secret-fixture-token'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('withVideo preserves the local source and passes its absolute marker without uploading', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-local-video-fixture-'));
  const path = join(directory, 'source.webm');
  try {
    await writeFile(path, 'video fixture');
    const provider = new CodexServices(options, undefined, async () => assert.fail('withVideo must not call a provider'));
    assert.equal(await provider.withVideo(path, async video => { assert.deepEqual(video, { uri: path, mimeType: 'video/webm' }); return 42; }), 42);
    assert.equal(await readFile(path, 'utf8'), 'video fixture');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
