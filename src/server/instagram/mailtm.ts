import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { VerificationInbox, VerificationMessage } from './inbox.js';

export interface MailTmCredentials {
  provider: 'mailtm';
  address: string;
  password: string;
  accountId?: string;
  provisioning: 'pending' | 'created';
}

export type MailTmProvisionResult = {
  status: 'ready' | 'needs_attention' | 'unknown';
  credentials?: MailTmCredentials;
  reason?: string;
};

type Fetch = typeof fetch;
type MailTmMessage = {
  id: string; createdAt: string; from: { address: string }; to: Array<{ address: string }>;
  subject: string; text?: string; size?: number;
};
type Collection<T> = { 'hydra:member': T[]; 'hydra:view'?: { 'hydra:next'?: string } };

class MailboxHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds?: number) {
    super(`Mailbox API returned HTTP ${status}`);
  }
}

async function request<T>(http: Fetch, path: string, init: RequestInit = {}): Promise<T> {
  if (!/^\/[a-z]+(?:\/[a-zA-Z0-9_-]+)?(?:\?page=\d+)?$/.test(path)) throw new Error('Unexpected mailbox API path');
  init.signal?.throwIfAborted();
  const response = await http(`https://api.mail.tm${path}`, {
    ...init,
    headers: { Accept: 'application/ld+json', 'Content-Type': 'application/json', ...init.headers },
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const seconds = retryAfter && /^\d{1,5}$/.test(retryAfter) ? Number(retryAfter) : undefined;
    // Service error bodies may echo addresses or credentials; only expose the status and numeric retry hint.
    await response.body?.cancel();
    throw new MailboxHttpError(response.status, seconds);
  }
  return response.json() as Promise<T>;
}

async function authenticate(http: Fetch, credentials: MailTmCredentials, signal?: AbortSignal): Promise<{ id: string; token: string }> {
  const auth = await request<{ id: string; token: string }>(http, '/token', {
    method: 'POST', body: JSON.stringify({ address: credentials.address, password: credentials.password }), signal,
  });
  if (!auth.token || !auth.id) throw new Error('Mailbox authentication returned an incomplete result');
  return auth;
}

/** Creates at most one mailbox, retaining owner credentials before the external mutation. */
export async function provisionMailTmInbox(options: {
  existing?: MailTmCredentials;
  persistCredentials: (credentials: MailTmCredentials) => Promise<void>;
  http?: Fetch;
  signal?: AbortSignal;
}): Promise<MailTmProvisionResult> {
  options.signal?.throwIfAborted();
  const http = options.http ?? fetch;
  let credentials = options.existing;
  let stage: 'domain discovery' | 'saving credentials' | 'account creation' | 'mailbox authentication' | 'saving verified credentials' = 'domain discovery';
  try {
    if (!credentials) {
      const domains = await request<Collection<{ domain: string; isActive: boolean; isPrivate: boolean }>>(http, '/domains', { signal: options.signal });
      const domain = domains['hydra:member'].find(domain => domain.isActive && !domain.isPrivate);
      if (!domain || !/^[a-z0-9.-]+$/i.test(domain.domain)) return { status: 'needs_attention', reason: 'No public mail.tm domain is available. Configure an existing IMAP inbox.' };
      credentials = {
        provider: 'mailtm', address: `astrocade.${randomBytes(8).toString('hex')}@${domain.domain}`,
        password: randomBytes(24).toString('base64url'), provisioning: 'pending',
      };
      stage = 'saving credentials';
      await options.persistCredentials(credentials);
      options.signal?.throwIfAborted();
      stage = 'account creation';
      const created = await request<{ id: string; address: string }>(http, '/accounts', {
        method: 'POST', body: JSON.stringify({ address: credentials.address, password: credentials.password }), signal: options.signal,
      });
      if (!created.id || created.address !== credentials.address) throw new Error('Mailbox creation could not be verified');
      credentials = { ...credentials, accountId: created.id, provisioning: 'created' };
      stage = 'saving verified credentials';
      await options.persistCredentials(credentials);
    }
    // A pending record may represent a lost creation response. Login reconciles it without POSTing another account.
    stage = 'mailbox authentication';
    const auth = await authenticate(http, credentials, options.signal);
    credentials = { ...credentials, accountId: auth.id, provisioning: 'created' };
    stage = 'saving verified credentials';
    await options.persistCredentials(credentials);
    options.signal?.throwIfAborted();
    return { status: 'ready', credentials };
  } catch (error) {
    // Cancellation must reach the job runner; it is not an ordinary mailbox checkpoint.
    options.signal?.throwIfAborted();
    let detail: string;
    if (stage === 'saving credentials') detail = 'Could not save mailbox credentials. No account creation request was sent.';
    else if (stage === 'saving verified credentials') detail = 'The mailbox service responded, but its verified state could not be saved locally.';
    else if (error instanceof MailboxHttpError) {
      detail = `Mailbox ${stage} failed (HTTP ${error.status}).`;
      if (stage === 'mailbox authentication' && error.status === 401) detail += ' The service rejected the saved address/password; this does not establish whether the earlier creation succeeded.';
      else if (error.status === 429) detail += ` The service rate limit was reached.${error.retryAfterSeconds === undefined ? '' : ` Retry after at least ${error.retryAfterSeconds} seconds.`}`;
      else if (error.status === 422) detail += ' The service rejected the submitted mailbox details.';
    } else if (error instanceof Error && error.name === 'TimeoutError') detail = `Mailbox ${stage} timed out before its result could be verified.`;
    else detail = `Mailbox ${stage} failed before a valid response was verified.`;
    return {
      status: credentials && stage !== 'saving credentials' ? 'unknown' : 'needs_attention',
      ...(credentials ? { credentials } : {}),
      reason: `${detail}${credentials && stage !== 'saving credentials' ? ' Saved credentials are retained; resume only verifies this same mailbox. No replacement account will be created.' : ''} Check the connection or configure an owner-controlled IMAP inbox.`,
    };
  }
}

export class MailTmInbox implements VerificationInbox {
  private token?: string;
  constructor(private readonly credentials: MailTmCredentials, private readonly http: Fetch = fetch) {}

  async listMessages(input: { recipient: string; since: string; signal?: AbortSignal }): Promise<VerificationMessage[]> {
    if (input.recipient.toLowerCase() !== this.credentials.address.toLowerCase()) throw new Error('Verification recipient differs from the configured mailbox');
    if (!this.token) this.token = (await authenticate(this.http, this.credentials, input.signal)).token;
    const headers = { Authorization: `Bearer ${this.token}` };
    const messages: VerificationMessage[] = [];
    let path: string | undefined = '/messages';
    for (let page = 0; path && page < 3; page++) {
      const collection: Collection<MailTmMessage> = await request(this.http, path, { headers, signal: input.signal });
      for (const entry of collection['hydra:member']) {
        if (Date.parse(entry.createdAt) < Date.parse(input.since) || (entry.size ?? 0) > 256_000) continue;
        if (!entry.to.some(to => to.address.toLowerCase() === input.recipient.toLowerCase())) continue;
        // Keep requests comfortably below the documented 8 QPS quota; no message mutation endpoints.
        await setTimeout(150, undefined, { signal: input.signal });
        const detail = await request<MailTmMessage>(this.http, `/messages/${encodeURIComponent(entry.id)}`, { headers, signal: input.signal });
        messages.push({
          id: detail.id, receivedAt: detail.createdAt, from: detail.from.address,
          to: detail.to.map(to => to.address), subject: detail.subject, text: detail.text ?? '',
        });
      }
      path = collection['hydra:view']?.['hydra:next'];
      if (path && !/^\/messages\?page=\d+$/.test(path)) throw new Error('Unexpected mailbox pagination path');
    }
    return messages;
  }
}
