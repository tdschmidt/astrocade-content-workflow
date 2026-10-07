import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { VerificationInbox, VerificationMessage } from './inbox.js';

export interface ImapInboxConfig {
  provider: 'imap';
  host: string;
  port?: number;
  username: string;
  password?: string;
  accessToken?: string;
  mailbox?: string;
}

export class ImapVerificationInbox implements VerificationInbox {
  constructor(private readonly config: ImapInboxConfig) {
    if (!config.host || !config.username || (!config.password && !config.accessToken)) throw new Error('IMAP host, username and credentials are required');
  }

  async listMessages(input: { recipient: string; since: string; signal?: AbortSignal }): Promise<VerificationMessage[]> {
    input.signal?.throwIfAborted();
    const client = new ImapFlow({
      host: this.config.host, port: this.config.port ?? 993, secure: true,
      auth: { user: this.config.username, ...(this.config.accessToken ? { accessToken: this.config.accessToken } : { pass: this.config.password! }) },
      logger: false, connectionTimeout: 15_000, socketTimeout: 15_000,
    });
    const abort = () => client.close();
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
      await client.connect();
      const lock = await client.getMailboxLock(this.config.mailbox ?? 'INBOX', { readOnly: true });
      try {
        const ids = await client.search({ since: new Date(input.since), to: input.recipient }, { uid: true });
        if (!ids || ids.length === 0) return [];
        const messages: VerificationMessage[] = [];
        for await (const header of client.fetch(ids.slice(-30), { uid: true, internalDate: true, size: true }, { uid: true })) {
          input.signal?.throwIfAborted();
          const receivedAt = header.internalDate instanceof Date ? header.internalDate : new Date(header.internalDate || 0);
          if (receivedAt.getTime() < Date.parse(input.since) || (header.size ?? 0) > 256_000) continue;
          // Do not issue another command inside ImapFlow's active fetch iterator.
          messages.push({ id: String(header.uid), receivedAt: receivedAt.toISOString(), from: '', to: [], subject: '', text: '' });
        }
        for (const message of messages) {
          const fetched = await client.fetchOne(Number(message.id), { source: true }, { uid: true });
          if (!fetched || !fetched.source) continue;
          const parsed = await simpleParser(fetched.source, { skipHtmlToText: true, skipTextToHtml: true });
          const recipients = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
          message.from = parsed.from?.value[0]?.address ?? '';
          message.to = recipients.flatMap(to => to.value.map(address => address.address ?? ''));
          message.subject = parsed.subject ?? '';
          message.text = parsed.text ?? '';
        }
        return messages;
      } finally { lock.release(); }
    } finally {
      input.signal?.removeEventListener('abort', abort);
      await client.logout().catch(() => client.close());
    }
  }
}
