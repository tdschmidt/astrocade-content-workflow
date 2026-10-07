import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { approvalMatches, publishInstagramReel, type PublicationApproval, type PublicationDraft, type PublicationIntent } from './publish.js';

const draft: PublicationDraft = { id: 'draft', revision: 1, accountUsername: 'project', assetPath: '/unused.mp4', assetSha256: 'abc', caption: 'A specific caption', requiresAiDisclosure: true };
const approval: PublicationApproval = { draftId: draft.id, revision: draft.revision, accountUsername: draft.accountUsername, assetSha256: draft.assetSha256, caption: draft.caption, requiresAiDisclosure: draft.requiresAiDisclosure, approvedAt: '2026-10-06T12:00:00Z' };
const forbiddenPage = new Proxy({}, { get: () => { throw new Error('Browser must not be accessed'); } }) as Page;

test('approval binds account, file, caption, disclosure and revision', () => {
  assert.ok(approvalMatches(draft, approval));
  for (const change of [{ caption: 'changed' }, { revision: 2 }, { accountUsername: 'other' }, { assetSha256: 'changed' }, { requiresAiDisclosure: false }]) {
    assert.equal(approvalMatches({ ...draft, ...change }, approval), false);
  }
});

test('unapproved publication cannot reach the browser', async () => {
  const result = await publishInstagramReel(forbiddenPage, draft, {
    persistIntent: async () => { throw new Error('unexpected intent'); }, persistResult: async () => {},
  });
  assert.equal(result.status, 'needs_attention');
  assert.equal(result.stage, 'approval');
});

test('cancelled approved publication cannot reach the browser', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await publishInstagramReel(forbiddenPage, draft, {
    approval, signal: controller.signal,
    persistIntent: async () => { throw new Error('unexpected intent'); }, persistResult: async () => {},
  });
  assert.equal(result.stage, 'cancelled');
});

test('a completed publication is returned without another browser operation', async () => {
  const intent: PublicationIntent = { ...approval, attemptId: 'attempt', attemptedAt: approval.approvedAt, previousPermalinks: [] };
  const published = { status: 'ready' as const, stage: 'published', attemptId: 'attempt', permalink: 'https://www.instagram.com/reel/proof/' };
  assert.deepEqual(await publishInstagramReel(forbiddenPage, draft, {
    existingIntent: intent, existingResult: published,
    persistIntent: async () => { throw new Error('must not re-create intent'); }, persistResult: async () => {},
  }), published);
});

test('changed draft cannot reuse an unresolved publication intent', async () => {
  const result = await publishInstagramReel(forbiddenPage, { ...draft, caption: 'new caption' }, {
    existingIntent: { ...approval, attemptId: 'attempt', attemptedAt: approval.approvedAt, previousPermalinks: [] },
    persistIntent: async () => { throw new Error('must not replace intent'); }, persistResult: async () => {},
  });
  assert.equal(result.status, 'needs_attention');
});
