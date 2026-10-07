import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionMailTmInbox, type MailTmCredentials } from './mailtm.js';

test('mailbox credentials are durable before creation and a lost response cannot create another account', async () => {
  let saved: MailTmCredentials | undefined;
  let creates = 0;
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/domains')) return Response.json({ 'hydra:member': [{ domain: 'example.test', isActive: true, isPrivate: false }] });
    if (url.endsWith('/accounts')) {
      creates++;
      assert.ok(saved, 'credentials saved before network mutation');
      assert.equal(JSON.parse(String(init?.body)).address, saved.address);
      throw new Error('response lost after account creation');
    }
    if (url.endsWith('/token')) return Response.json({ id: 'account-1', token: 'test-token' });
    throw new Error('unexpected request');
  }) as typeof fetch;
  const persistCredentials = async (credentials: MailTmCredentials) => { saved = credentials; };
  assert.equal((await provisionMailTmInbox({ http, persistCredentials })).status, 'unknown');
  assert.equal(saved?.provisioning, 'pending');
  assert.equal((await provisionMailTmInbox({ http, persistCredentials, existing: saved! })).status, 'ready');
  assert.equal(creates, 1);
  assert.equal(saved?.provisioning, 'created');
});

test('does not create an account if durable credential storage fails', async () => {
  let creates = 0;
  const http = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/accounts')) creates++;
    return Response.json({ 'hydra:member': [{ domain: 'example.test', isActive: true, isPrivate: false }] });
  }) as typeof fetch;
  const result = await provisionMailTmInbox({ http, persistCredentials: async () => { throw new Error('disk full'); } });
  assert.equal(creates, 0);
  assert.equal(result.status, 'needs_attention');
  assert.match(result.reason!, /save mailbox credentials.*No account creation request was sent/);
});

const pending: MailTmCredentials = { provider: 'mailtm', address: 'saved@example.test', password: 'saved-password-secret', provisioning: 'pending' };

test('failed authentication retains the pending identity and exposes status without service secrets', async () => {
  const paths: string[] = [];
  const http = (async (input: string | URL | Request) => {
    paths.push(new URL(String(input)).pathname);
    return Response.json({ message: `Invalid credentials: ${pending.address} ${pending.password}`, token: 'echoed-token-secret' }, { status: 401 });
  }) as typeof fetch;
  let persisted = false;
  const result = await provisionMailTmInbox({ existing: pending, http, persistCredentials: async () => { persisted = true; } });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.credentials, pending);
  assert.equal(persisted, false);
  assert.deepEqual(paths, ['/token']);
  assert.match(result.reason!, /authentication failed \(HTTP 401\)/);
  assert.match(result.reason!, /resume only verifies this same mailbox/);
  for (const secret of [pending.address, pending.password, 'echoed-token-secret']) assert.equal(result.reason!.includes(secret), false);
});

test('rate-limit errors give a bounded numeric retry hint without creating another mailbox', async () => {
  const http = (async () => Response.json({ message: 'Too many requests' }, { status: 429, headers: { 'retry-after': '30' } })) as typeof fetch;
  const result = await provisionMailTmInbox({ existing: pending, http, persistCredentials: async () => { assert.fail('not authenticated'); } });
  assert.equal(result.status, 'unknown');
  assert.match(result.reason!, /HTTP 429/);
  assert.match(result.reason!, /at least 30 seconds/);
});

test('an account-creation rejection reports its stage and keeps the original durable intent', async () => {
  let saved: MailTmCredentials | undefined;
  const paths: string[] = [];
  const http = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === '/domains') return Response.json({ 'hydra:member': [{ domain: 'example.test', isActive: true, isPrivate: false }] });
    return Response.json({ detail: `Rejected ${saved?.password}` }, { status: 422 });
  }) as typeof fetch;
  const result = await provisionMailTmInbox({ http, persistCredentials: async credentials => { saved = credentials; } });
  assert.equal(result.status, 'unknown');
  assert.match(result.reason!, /account creation failed \(HTTP 422\)/);
  assert.equal(saved?.provisioning, 'pending');
  assert.equal(result.reason!.includes(saved!.password), false);
  assert.deepEqual(paths, ['/domains', '/accounts']);
});

test('pre-cancelled provisioning makes no request and propagates cancellation', async () => {
  const signal = AbortSignal.abort(new Error('Fixture cancelled'));
  const http = (async () => { assert.fail('No request after cancellation'); }) as typeof fetch;
  await assert.rejects(provisionMailTmInbox({ signal, http, persistCredentials: async () => { assert.fail('No persistence before operation starts'); } }), /Fixture cancelled/);
});

test('cancellation after durable intent prevents the external creation request', async () => {
  const controller = new AbortController();
  let saved: MailTmCredentials | undefined;
  const paths: string[] = [];
  const http = (async (input: string | URL | Request) => {
    paths.push(new URL(String(input)).pathname);
    return Response.json({ 'hydra:member': [{ domain: 'example.test', isActive: true, isPrivate: false }] });
  }) as typeof fetch;
  await assert.rejects(provisionMailTmInbox({
    http, signal: controller.signal,
    persistCredentials: async credentials => { saved = credentials; controller.abort(new Error('Fixture cancelled after save')); },
  }), /Fixture cancelled after save/);
  assert.equal(saved?.provisioning, 'pending');
  assert.deepEqual(paths, ['/domains']);
});

test('cancellation interrupts authentication and does not replace saved credentials', async () => {
  const controller = new AbortController();
  const http = (async (_input: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.signal);
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      controller.abort(new Error('Fixture cancelled in flight'));
    });
  }) as typeof fetch;
  await assert.rejects(provisionMailTmInbox({ existing: pending, http, signal: controller.signal, persistCredentials: async () => { assert.fail('Authentication did not complete'); } }), /Fixture cancelled in flight/);
});
