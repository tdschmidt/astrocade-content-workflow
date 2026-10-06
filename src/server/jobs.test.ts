import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
import { BusyError, JobRunner, NeedsAttention } from './jobs.js';

test('reserves the lane before persistence and waits for cancellation cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'astrocade-jobs-'));
  try {
    const jobs = await JobRunner.open(join(dir, 'jobs.json'));
    let cleaned = false;
    const first = jobs.start('capture', async ({ signal }) => {
      try { await setTimeout(10_000, undefined, { signal }); }
      finally { await setTimeout(20); cleaned = true; }
    });
    await assert.rejects(jobs.start('overlap', async () => {}), BusyError);
    const job = await first;
    const cancel = jobs.cancel(job.id);
    assert.equal(jobs.busy, true);
    await cancel;
    assert.equal(cleaned, true);
    assert.equal(jobs.busy, false);
    assert.equal(jobs.list()[0].status, 'cancelled');
    await jobs.start('checkpoint', async () => { throw new NeedsAttention('Complete verification'); });
    while (jobs.busy) await setTimeout(5);
    assert.equal(jobs.list()[1].status, 'needs_attention');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
