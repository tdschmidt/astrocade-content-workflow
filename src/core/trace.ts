import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type TraceEvent = { at: string; stage: string; status: string; message: string; data?: unknown };

/** Observable evidence and concise decisions only; no credentials or internal model reasoning. */
export class Trace {
  constructor(readonly directory: string, private quiet = false) {}

  event(stage: string, status: string, message: string, data?: unknown) {
    const event: TraceEvent = { at: new Date().toISOString(), stage, status, message, data };
    appendFileSync(join(this.directory, 'trace.jsonl'), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    if (!this.quiet) process.stdout.write(`[${event.at.slice(11, 19)}] ${stage} · ${status} · ${message}\n`);
  }

  artifact(name: string, value: unknown) {
    writeFileSync(join(this.directory, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  }
}
