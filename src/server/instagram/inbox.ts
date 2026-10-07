export interface VerificationMessage {
  id: string;
  /** Provider receipt time, not the untrusted Date header. */
  receivedAt: string;
  to: string[];
  from: string;
  subject: string;
  text: string;
}

/** Implement one provider adapter once the owner's existing access is known. */
export interface VerificationInbox {
  listMessages(input: {
    recipient: string;
    since: string;
    signal?: AbortSignal;
  }): Promise<VerificationMessage[]>;
}

export interface VerificationCriteria {
  recipient: string;
  since: string;
  /** Exact addresses observed/configured for the selected signup flow. */
  allowedSenders: string[];
  usedMessageIds?: string[];
  /** Six is the conservative supported format; an unfamiliar format needs a checkpoint. */
  codeLength?: 4 | 5 | 6 | 7 | 8;
}

export type CodeMatch =
  | { status: 'found'; code: string; messageId: string }
  | { status: 'none' }
  | { status: 'ambiguous' };

const normalizeAddress = (value: string) => value.trim().toLowerCase();

export function matchVerificationCode(
  messages: VerificationMessage[],
  criteria: VerificationCriteria,
): CodeMatch {
  const since = Date.parse(criteria.since);
  if (!Number.isFinite(since)) throw new Error('Invalid verification watermark');
  const allowed = new Set(criteria.allowedSenders.map(normalizeAddress));
  const used = new Set(criteria.usedMessageIds ?? []);
  const candidates: Array<{ code: string; messageId: string }> = [];
  for (const message of messages) {
    const received = Date.parse(message.receivedAt);
    if (!Number.isFinite(received) || received < since || used.has(message.id)) continue;
    if (!message.to.some(to => normalizeAddress(to) === normalizeAddress(criteria.recipient))) continue;
    if (!allowed.has(normalizeAddress(message.from))) continue;
    // Parse normalized text supplied by the adapter; never render email HTML.
    const text = `${message.subject}\n${message.text}`.slice(0, 32_768);
    if (!/\binstagram\b/i.test(text) || !/\b(code|confirm|verification)\b/i.test(text)) continue;
    const pattern = new RegExp(`(?<!\\d)(\\d{${criteria.codeLength ?? 6}})(?!\\d)`, 'g');
    const codes = new Set(Array.from(text.matchAll(pattern), match => match[1]));
    if (codes.size > 1) return { status: 'ambiguous' };
    const code = codes.values().next().value;
    if (code) candidates.push({ code, messageId: message.id });
  }
  if (candidates.length === 0) return { status: 'none' };
  if (new Set(candidates.map(candidate => candidate.code)).size !== 1) return { status: 'ambiguous' };
  return { status: 'found', ...candidates[candidates.length - 1]! };
}

export async function waitForVerificationCode(
  inbox: VerificationInbox,
  criteria: VerificationCriteria,
  options: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<CodeMatch> {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  do {
    options.signal?.throwIfAborted();
    const result = matchVerificationCode(await inbox.listMessages({
      recipient: criteria.recipient,
      since: criteria.since,
      ...(options.signal ? { signal: options.signal } : {}),
    }), criteria);
    if (result.status !== 'none') return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { options.signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(finish, Math.min(options.pollMs ?? 3_000, remaining));
      const abort = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        reject(options.signal?.reason ?? new Error('Verification cancelled'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
    });
  } while (Date.now() < deadline);
  return { status: 'none' };
}
