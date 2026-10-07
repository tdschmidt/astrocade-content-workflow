import express, { type Request, type Response, type NextFunction } from 'express';
import cookieSession from 'cookie-session';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { Configuration, settingsPatchSchema } from './config.js';
import { JobRunner, BusyError, NeedsAttention } from './jobs.js';
import { Workflow } from './workflow.js';
import { doctor } from './doctor.js';
import { gameProfileSchema } from './games/schema.js';
import { runOptionsSchema, scriptSchema } from '../shared/domain.js';

const digest = (value: string) => createHash('sha256').update(value).digest();
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createApp(config: Configuration, workflow: Workflow, jobs: JobRunner) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieSession({ name: 'astrocade', keys: [randomBytes(32).toString('hex')], httpOnly: true, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000 }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin changes are not allowed.' });
      } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
    }
    next();
  });
  app.post('/api/login', (req, res) => {
    const password = z.object({ password: z.string().max(200) }).parse(req.body).password;
    const expected = config.get().workbenchPassword;
    if (!expected || !timingSafeEqual(digest(password), digest(expected))) return res.status(401).json({ error: 'The workbench password did not match.' });
    req.session = { version: digest(expected).toString('hex') };
    res.json({ ok: true });
  });
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const password = config.get().workbenchPassword;
    if (!password) {
      if (!localHosts.has(req.hostname)) return res.status(403).json({ error: 'Set a workbench password locally before sharing this app.' });
      return next();
    }
    if (req.session?.version !== digest(password).toString('hex')) return res.status(401).json({ error: 'Enter the workbench password.' });
    next();
  };
  app.use('/api', authenticate);
  app.use('/media', authenticate);
  app.get('/api/state', (_req, res) => res.json({ workspace: workflow.store.read(), jobs: jobs.list(), settings: config.publicSettings(), busy: jobs.busy }));
  app.get('/api/doctor', async (_req, res) => res.json(await doctor(config)));
  app.post('/api/settings', async (req, res) => {
    const patch = settingsPatchSchema.parse(req.body);
    res.json({ job: await jobs.start('Save settings', () => config.save(patch)) });
  });
  app.post('/api/discover', async (_req, res) => res.json({ job: await jobs.start('Discover games', async context => { await workflow.discover(context); }) }));
  app.post('/api/research', async (req, res) => {
    const { topic } = z.object({ topic: z.string().trim().min(1).max(500) }).parse(req.body);
    res.json({ job: await jobs.start('Refresh research', context => workflow.research(topic, context)) });
  });
  app.post('/api/profiles', async (req, res) => {
    const profile = gameProfileSchema.parse(req.body);
    res.json({ job: await jobs.start('Save game profile', () => workflow.saveProfile(profile), profile.id) });
  });
  app.post('/api/profiles/:id/probe', async (req, res) => res.json({ job: await jobs.start('Probe game profile', context => workflow.probeProfile(req.params.id as string, context), req.params.id as string) }));
  app.post('/api/runs', async (req, res) => {
    const options = runOptionsSchema.parse(req.body);
    const id = randomUUID();
    res.json({ runId: id, job: await jobs.start('Generate drafts', context => workflow.generate(id, options, context), id) });
  });
  app.post('/api/runs/:id/resume', async (req, res) => {
    const run = workflow.store.read().runs.find(item => item.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    res.json({ job: await jobs.start('Resume generation', context => workflow.generate(run.id, run.options, context), run.id) });
  });
  const revision = (req: Request) => z.coerce.number().int().positive().parse(req.params.revision);
  app.post('/api/drafts/:id/revisions/:revision/edit', async (req, res) => {
    const edits = scriptSchema.pick({ hook: true, narration: true, caption: true }).parse(req.body);
    const id = req.params.id as string, rev = revision(req);
    res.json({ job: await jobs.start('Revise draft', context => workflow.editDraft(id, rev, edits, context), id) });
  });
  app.post('/api/drafts/:id/revisions/:revision/approve', async (req, res) => {
    z.object({ reviewed: z.literal(true) }).parse(req.body);
    const id = req.params.id as string, rev = revision(req);
    res.json({ job: await jobs.start('Approve revision', () => workflow.approveDraft(id, rev), id) });
  });
  app.post('/api/drafts/:id/revisions/:revision/publish', async (req, res) => {
    const id = req.params.id as string, rev = revision(req);
    res.json({ job: await jobs.start('Publish approved video', context => workflow.publish(id, rev, context), id) });
  });
  app.post('/api/drafts/:id/revisions/:revision/reconcile', async (req, res) => {
    const id = req.params.id as string, rev = revision(req);
    res.json({ job: await jobs.start('Reconcile publication', context => workflow.publish(id, rev, context, true), id) });
  });
  app.post('/api/account/inbox', async (_req, res) => res.json({ job: await jobs.start('Set up mailbox', context => workflow.provisionInbox(context)) }));
  app.post('/api/account/signup', async (_req, res) => res.json({ job: await jobs.start('Create Instagram account', context => workflow.signup(context)) }));
  app.post('/api/account/readiness', async (_req, res) => res.json({ job: await jobs.start('Check account readiness', context => workflow.accountReadiness(context)) }));
  app.post('/api/jobs/:id/cancel', async (req, res) => { await jobs.cancel(req.params.id as string); res.json({ ok: true }); });
  app.get('/media/:name', (req, res) => {
    const state = workflow.store.read();
    const files = [...state.captures.map(capture => capture.path), ...state.drafts.flatMap(draft => [draft.videoPath, draft.audioPath])].filter((path): path is string => Boolean(path));
    const file = files.find(path => basename(path) === req.params.name && resolve(path).startsWith(config.mediaDir + '/'));
    if (!file) return res.status(404).json({ error: 'Media not found.' });
    res.sendFile(file);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof z.ZodError ? 400 : error instanceof BusyError ? 409 : error instanceof NeedsAttention ? 422 : 500;
    const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : 'Operation failed.';
    res.status(status).json({ error: message });
  });
  return app;
}
