import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JsonStore } from './store.js';

export const jobSchema = z.object({
  id: z.string(), kind: z.string(), targetId: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted', 'needs_attention']),
  step: z.string(), createdAt: z.string(), updatedAt: z.string(), error: z.string().optional(),
});
export type Job = z.infer<typeof jobSchema>;
const jobsSchema = z.object({ jobs: z.array(jobSchema) });
export class NeedsAttention extends Error {}
export class BusyError extends Error {}
export interface JobContext { signal: AbortSignal; progress(step: string): Promise<void> }

export class JobRunner {
  private active?: { id: string; controller: AbortController; settled: Promise<void> };
  private constructor(private store: JsonStore<z.infer<typeof jobsSchema>>) {}

  static async open(path: string) {
    const store = await JsonStore.open(path, jobsSchema, { jobs: [] });
    await store.update(state => {
      for (const job of state.jobs) if (job.status === 'running') {
        job.status = 'interrupted';
        job.step = 'Interrupted by restart. Resume from saved artifacts.';
        job.updatedAt = new Date().toISOString();
      }
    });
    return new JobRunner(store);
  }

  list() { return this.store.read().jobs; }
  get busy() { return Boolean(this.active); }
  assertIdle() { if (this.active) throw new BusyError('Another operation is running. Wait or cancel it first.'); }

  async start(kind: string, operation: (context: JobContext) => Promise<void>, targetId?: string): Promise<Job> {
    this.assertIdle();
    const now = new Date().toISOString();
    const job: Job = { id: randomUUID(), kind, targetId, status: 'running', step: 'Starting', createdAt: now, updatedAt: now };
    const controller = new AbortController();
    // Reserve synchronously before the first write so simultaneous requests cannot both start.
    const active = { id: job.id, controller, settled: Promise.resolve() };
    this.active = active;
    try { await this.store.update(state => { state.jobs.push(job); }); }
    catch (error) { this.active = undefined; throw error; }
    const update = async (values: Partial<Job>) => {
      await this.store.update(state => {
        Object.assign(state.jobs.find(item => item.id === job.id)!, values, { updatedAt: new Date().toISOString() });
      });
    };
    active.settled = (async () => {
      try {
        controller.signal.throwIfAborted();
        await operation({ signal: controller.signal, progress: step => update({ step }) });
        await update({ status: controller.signal.aborted ? 'cancelled' : 'completed', step: controller.signal.aborted ? 'Cancelled' : 'Complete' });
      } catch (error) {
        const status = controller.signal.aborted ? 'cancelled' : error instanceof NeedsAttention ? 'needs_attention' : 'failed';
        await update({ status, error: error instanceof Error ? error.message : 'Operation failed', step: status === 'needs_attention' ? 'Needs your attention' : status });
      } finally { if (this.active?.id === job.id) this.active = undefined; }
    })();
    // A disk failure while recording the outcome must not become an unhandled rejection.
    void active.settled.catch(error => console.error('Unable to save operation status:', error instanceof Error ? error.message : 'write failed'));
    return job;
  }

  async cancel(id: string) {
    if (this.active?.id !== id) throw new Error('This operation is no longer running.');
    const active = this.active;
    active.controller.abort(new Error('Cancelled by user'));
    await active.settled;
  }

  async close() { if (this.active) await this.cancel(this.active.id); }
}
