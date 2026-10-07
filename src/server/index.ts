import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Configuration } from './config.js';
import { Workflow } from './workflow.js';
import { JobRunner } from './jobs.js';
import { createApp } from './app.js';

const config = await Configuration.open();
const workflow = await Workflow.open(config);
const jobs = await JobRunner.open(resolve(config.dataDir, 'jobs.json'));
const app = createApp(config, workflow, jobs);
const server = createServer(app);
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
if (process.env.NODE_ENV === 'production') {
  if (!existsSync('dist/index.html')) throw new Error('Run npm run build before starting in production mode.');
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  vite = await (await import('vite')).createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
server.listen(config.port, config.host, () => console.log(`Astrocade Studio: http://${config.host}:${config.port}`));

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await jobs.close();
  await workflow.close();
  await vite?.close();
  server.closeAllConnections();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void close().then(() => process.exit(0)); });
