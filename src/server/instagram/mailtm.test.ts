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
  await provisionMailTmInbox({ http, persistCredentials: async () => { throw new Error('disk full'); } });
  assert.equal(creates, 0);
});
