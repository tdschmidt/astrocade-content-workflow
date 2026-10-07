import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { Draft } from '../shared/domain.js';
import { Configuration, settingsSchema } from './config.js';
import { fileSha256 } from './instagram/index.js';
import type { JobContext } from './jobs.js';
import { Workflow } from './workflow.js';

const context = (): JobContext => ({ signal: new AbortController().signal, progress: async () => {} });

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-workflow-'));
  const config = await Configuration.open(directory);
  // Test-only settings isolate these state transitions from the developer's environment.
  t.mock.method(config, 'get', () => settingsSchema.parse(config.store.read()));
  await config.save({ instagramUsername: 'fixture_account' });
  const workflow = await Workflow.open(config);
  t.after(async () => { await workflow.close(); await rm(directory, { recursive: true, force: true }); });
  const videoPath = join(config.mediaDir, 'draft-r1.mp4');
  // Approval tests concern byte identity. Codec validity is tested in media integration tests.
  await writeFile(videoPath, 'immutable fixture video bytes');
  const draft: Draft = {
    id: 'draft', runId: 'run', revision: 1, captureId: 'capture',
    createdAt: '2026-10-06T00:00:00.000Z', format: 'highlight', status: 'ready',
    hook: 'An observed moment', narration: '', caption: 'Original caption',
    cuts: [{ startSeconds: 0, endSeconds: 5 }], rationale: 'Fixture',
    subtitles: [], warnings: [], shorteningAttempts: 0, videoPath,
    assetSha256: await fileSha256(videoPath),
  };
  await workflow.store.update(state => { state.drafts.push(draft); });
  const browserSentinel = new Error('TEST_BROWSER_BOUNDARY');
  let browserAttempts = 0;
  // Fail before any actual Instagram/browser interaction, including accidental regressions.
  Object.defineProperty(workflow, 'instagramPage', { value: async () => { browserAttempts++; throw browserSentinel; } });
  return { workflow, config, draft, browserSentinel, browserAttempts: () => browserAttempts };
}

test('approval binds the rendered bytes, caption, revision, account and disclosure', async t => {
  const { workflow, config, draft } = await fixture(t);
  await workflow.approveDraft(draft.id, draft.revision);
  const approved = workflow.getDraft(draft.id, 1).approval!;
  assert.equal(approved.assetSha256, draft.assetSha256);
  assert.equal(approved.caption, draft.caption);
  assert.equal(approved.accountUsername, config.get().instagramUsername);
  assert.equal(approved.revision, 1);
  assert.equal(approved.requiresAiDisclosure, false);
  await writeFile(draft.videoPath!, 'changed bytes');
  await assert.rejects(workflow.approveDraft(draft.id, 1), /file changed/i);
});

test('a caption edit reuses immutable media but requires new approval and blocks the old revision', async t => {
  const { workflow, draft, browserAttempts } = await fixture(t);
  await workflow.approveDraft(draft.id, 1);
  await workflow.editDraft(draft.id, 1, { hook: draft.hook, narration: '', caption: 'Revised caption' }, context());
  const next = workflow.getDraft(draft.id, 2);
  assert.equal(next.videoPath, draft.videoPath);
  assert.equal(next.assetSha256, draft.assetSha256);
  assert.equal(next.status, 'ready');
  assert.equal(next.approval, undefined);
  await assert.rejects(workflow.approveDraft(draft.id, 1), /latest/i);
  await assert.rejects(workflow.publish(draft.id, 1, context()), /latest|superseded/i);
  assert.equal(browserAttempts(), 0);
});

test('an unresolved Share on another revision blocks a new publication before browser access', async t => {
  const { workflow, draft, browserAttempts } = await fixture(t);
  await workflow.approveDraft(draft.id, 1);
  const approval = workflow.getDraft(draft.id, 1).approval!;
  await workflow.store.update(state => {
    state.drafts.push({ ...draft, revision: 2, caption: 'Second caption', approval: { ...approval, revision: 2, caption: 'Second caption' } });
    state.publications.push({
      draftId: draft.id, revision: 1,
      intent: { ...approval, attemptId: 'uncertain-attempt', attemptedAt: approval.approvedAt, previousPermalinks: [] },
      result: { status: 'unknown', stage: 'publication_unknown', attemptId: 'uncertain-attempt' },
    });
  });
  await assert.rejects(workflow.publish(draft.id, 2, context()), /reconcil|unresolved|uncertain/i);
  assert.equal(browserAttempts(), 0);
});

test('an unresolved Share prevents edits that would hide the original reconciliation action', async t => {
  const { workflow, draft, browserAttempts } = await fixture(t);
  await workflow.approveDraft(draft.id, 1);
  const approval = workflow.getDraft(draft.id, 1).approval!;
  await workflow.store.update(state => {
    state.publications.push({ draftId: draft.id, revision: 1, intent: { ...approval, attemptId: 'uncertain-attempt', attemptedAt: approval.approvedAt, previousPermalinks: [] } });
  });
  await assert.rejects(workflow.editDraft(draft.id, 1, { hook: draft.hook, narration: '', caption: 'Changed caption' }, context()), /reconcil|uncertain/i);
  assert.equal(workflow.store.read().drafts.length, 1);
  assert.equal(workflow.getDraft(draft.id, 1).caption, draft.caption);
  assert.equal(browserAttempts(), 0);
});

test('reconciliation can inspect an original intent even when a newer revision exists', async t => {
  const { workflow, draft, browserSentinel, browserAttempts } = await fixture(t);
  await workflow.approveDraft(draft.id, 1);
  const approval = workflow.getDraft(draft.id, 1).approval!;
  await workflow.store.update(state => {
    state.drafts.push({ ...draft, revision: 2, caption: 'Second caption', approval: undefined });
    state.publications.push({ draftId: draft.id, revision: 1, intent: { ...approval, attemptId: 'uncertain-attempt', attemptedAt: approval.approvedAt, previousPermalinks: [] } });
  });
  await assert.rejects(workflow.publish(draft.id, 1, context(), true), error => error === browserSentinel);
  assert.equal(browserAttempts(), 1);
});

test('a confirmed repeat returns without reopening the browser', async t => {
  const { workflow, draft, browserAttempts } = await fixture(t);
  await workflow.approveDraft(draft.id, 1);
  const approval = workflow.getDraft(draft.id, 1).approval!;
  await workflow.store.update(state => {
    state.publications.push({
      draftId: draft.id, revision: 1,
      intent: { ...approval, attemptId: 'confirmed-attempt', attemptedAt: approval.approvedAt, previousPermalinks: [] },
      result: { status: 'ready', stage: 'published', attemptId: 'confirmed-attempt', permalink: 'https://www.instagram.com/reel/FIXTURE/' },
    });
  });
  await workflow.publish(draft.id, 1, context());
  assert.equal(browserAttempts(), 0);
});

test('reopening a workspace parks interrupted work while preserving completed artifacts', async t => {
  const { workflow, config, draft } = await fixture(t);
  await workflow.store.update(state => {
    state.runs.push({ id: 'run', createdAt: draft.createdAt, options: { mode: 'balanced', formats: ['highlight'], comparison: 'same-game', profileIds: [], topic: '' }, status: 'generating', captureIds: ['capture'], draftIds: [draft.id] });
    state.drafts.push({ ...draft, revision: 2, status: 'rendering', approval: undefined });
    state.signup.checkpoint = { phase: 'submitted', username: 'fixture_account', verificationRequestedAt: draft.createdAt };
  });
  const reopened = await Workflow.open(config);
  assert.equal(reopened.store.read().runs[0]?.status, 'needs_attention');
  assert.equal(reopened.getDraft(draft.id, 1).videoPath, draft.videoPath);
  assert.equal(reopened.getDraft(draft.id, 2).status, 'planned');
  assert.equal(reopened.store.read().signup.checkpoint?.phase, 'submitted');
  assert.deepEqual(reopened.store.read().runs[0]?.captureIds, ['capture']);
  await reopened.close();
});
