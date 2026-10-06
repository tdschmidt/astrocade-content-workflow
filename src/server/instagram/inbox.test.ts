import assert from 'node:assert/strict';
import test from 'node:test';
import { matchVerificationCode, waitForVerificationCode, type VerificationMessage } from './inbox.js';

const criteria = {
  recipient: 'project@example.com',
  since: '2026-10-06T12:00:00Z',
  allowedSenders: ['verify@mail.instagram.com'],
};
const message: VerificationMessage = {
  id: 'new-message', receivedAt: '2026-10-06T12:00:01Z',
  to: ['project@example.com'], from: 'verify@mail.instagram.com',
  subject: '123456 is your Instagram code', text: 'Confirm your account with code 123456.',
};

test('finds a fresh code without guessing aliases or accepting spoofed sender suffixes', () => {
  const irrelevant = [
    { ...message, id: 'old', receivedAt: '2026-10-06T11:59:59Z' },
    { ...message, id: 'wrong-recipient', to: ['other@example.com'] },
    { ...message, id: 'wrong-sender', from: 'verify@mail.instagram.com.evil.test' },
    { ...message, id: 'used' },
  ];
  assert.deepEqual(matchVerificationCode(irrelevant, { ...criteria, usedMessageIds: ['used'] }), { status: 'none' });
  assert.deepEqual(matchVerificationCode([...irrelevant, message], { ...criteria, usedMessageIds: ['used'] }), {
    status: 'found', code: '123456', messageId: 'new-message',
  });
});

test('rejects ambiguous messages and stale codes after a resend watermark', () => {
  assert.deepEqual(matchVerificationCode([{ ...message, text: 'Instagram codes 123456 and 654321' }], criteria), { status: 'ambiguous' });
  assert.deepEqual(matchVerificationCode([message, { ...message, id: 'second', subject: 'Instagram code 654321', text: '654321' }], criteria), { status: 'ambiguous' });
  assert.deepEqual(matchVerificationCode([message], { ...criteria, since: '2026-10-06T12:01:00Z' }), { status: 'none' });
});

test('ignores malformed timestamps and unrecognized content', () => {
  assert.deepEqual(matchVerificationCode([{ ...message, receivedAt: 'invalid' }, { ...message, subject: 'Receipt', text: '123456' }], criteria), { status: 'none' });
  assert.throws(() => matchVerificationCode([message], { ...criteria, since: 'invalid' }));
});

test('polling terminates with an explicit no-code result and supports cancellation', async () => {
  assert.deepEqual(await waitForVerificationCode({ listMessages: async () => [] }, criteria, { timeoutMs: 0 }), { status: 'none' });
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(waitForVerificationCode({ listMessages: async () => [] }, criteria, { signal: controller.signal }), /stopped/);
});
