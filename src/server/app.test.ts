import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Draft } from '../shared/domain.js';
import { createApp } from './app.js';
import { Configuration, settingsSchema } from './config.js';
import { JobRunner, NeedsAttention } from './jobs.js';
import { Workflow } from './workflow.js';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-app-'));
  const config = await Configuration.open(directory);
  t.mock.method(config, 'get', () => settingsSchema.parse(config.store.read()));
  const workflow = await Workflow.open(config);
  const jobs = await JobRunner.open(join(directory, 'jobs.json'));
  const server = createServer(createApp(config, workflow, jobs));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await jobs.close(); await workflow.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { config, workflow, jobs, base, post, directory };
}

async function settled(jobs: JobRunner) {
  const deadline = Date.now() + 2000;
  while (jobs.busy && Date.now() < deadline) await setTimeout(5);
  assert.equal(jobs.busy, false, 'operation must release its lane');
}

test('async settings reserve the mutation lane, while reads and checkpoint recovery stay available', async t => {
  const { config, workflow, jobs, base, post } = await fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = config.save.bind(config);
  t.mock.method(config, 'save', async (patch: Parameters<Configuration['save']>[0]) => { await gate; await save(patch); });
  try {
    const first = await post('/api/settings', { instagramDisplayName: 'Saved after persistence' });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).job.status, 'running');
    assert.equal(config.get().instagramDisplayName, '');
    assert.equal((await post('/api/discover')).status, 409);
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.busy, true);
    assert.equal(state.settings.instagramDisplayName, '');
  } finally { release(); }
  await settled(jobs);
  assert.equal(config.get().instagramDisplayName, 'Saved after persistence');
  t.mock.method(workflow, 'discover', async () => { throw new NeedsAttention('Complete the fixture checkpoint'); });
  assert.equal((await post('/api/discover')).status, 200);
  await settled(jobs);
  assert.equal(jobs.list().at(-1)?.status, 'needs_attention');
  assert.equal((await post('/api/settings', { instagramDisplayName: 'Next operation' })).status, 200);
  await settled(jobs);
  assert.equal(config.get().instagramDisplayName, 'Next operation');
});

test('authentication protects state and media, and state redacts configured secrets', async t => {
  const { config, base, post } = await fixture(t);
  const secrets = {
    workbenchPassword: 'fixture-workbench-secret', geminiApiKey: 'fixture-gemini-secret', tavilyApiKey: 'fixture-tavily-secret',
    instagramPassword: 'fixture-instagram-secret', instagramBirthday: '1985-08-24', imapPassword: 'fixture-imap-secret', imapAccessToken: 'fixture-imap-token',
  };
  await config.save(secrets);
  await config.store.update(settings => { settings.mailtm = { provider: 'mailtm', address: 'fixture@example.com', password: 'fixture-mailtm-secret', provisioning: 'created' }; });
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/media/anything.mp4')).status, 401);
  assert.equal((await post('/api/login', { password: 'wrong' })).status, 401);
  const login = await post('/api/login', { password: secrets.workbenchPassword });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const response = await fetch(base + '/api/state', { headers: { cookie } });
  assert.equal(response.status, 200);
  const stateText = await response.text();
  for (const secret of [...Object.values(secrets), 'fixture-mailtm-secret']) assert.equal(stateText.includes(secret), false);
  const state = JSON.parse(stateText);
  assert.equal(state.settings.geminiApiKeyConfigured, true);
  assert.deepEqual(state.settings.mailtm, { address: 'fixture@example.com', provisioning: 'created' });
  assert.equal((await post('/api/settings', { instagramDisplayName: 'Cross-site change' }, { cookie, origin: 'https://unrelated.example' })).status, 403);
  await config.save({ workbenchPassword: 'replacement-secret' });
  assert.equal((await fetch(base + '/api/state', { headers: { cookie } })).status, 401);
});

test('media access requires a registered artifact inside the media directory', async t => {
  const { config, workflow, directory, base } = await fixture(t);
  const inside = join(config.mediaDir, 'registered.mp4');
  const outside = join(directory, 'outside.mp4');
  await Promise.all([writeFile(inside, 'registered-media'), writeFile(outside, 'private-file'), writeFile(join(config.mediaDir, 'unregistered.mp4'), 'unregistered-media')]);
  const draft: Draft = { id: 'draft', runId: 'run', revision: 1, captureId: 'capture', createdAt: '2026-10-06T00:00:00.000Z', format: 'highlight', status: 'ready', hook: 'Fixture', narration: '', caption: 'Fixture', cuts: [{ startSeconds: 0, endSeconds: 1 }], rationale: '', subtitles: [], warnings: [], shorteningAttempts: 0, videoPath: inside };
  await workflow.store.update(state => { state.drafts.push(draft, { ...draft, id: 'outside', videoPath: outside }); });
  const response = await fetch(base + '/media/registered.mp4');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'registered-media');
  assert.equal((await fetch(base + '/media/unregistered.mp4')).status, 404);
  assert.equal((await fetch(base + '/media/outside.mp4')).status, 404);
});

test('an unconfigured shared host cannot read state', async t => {
  const { base } = await fixture(t);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(base + '/api/state', { headers: { Host: 'public-workbench.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 403);
});
