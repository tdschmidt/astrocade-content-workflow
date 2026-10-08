import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Inference } from '../server/providers/inference.js';

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

/** Save returned JSON before workflow validation; provider-internal parse failures are unavailable. */
export function traceInference(source: Inference, trace: Trace, provider: string, model: string, secrets: string[] = []): Inference {
  const redactions = secrets.filter(Boolean).sort((a, b) => b.length - a.length);
  return {
    withVideo: source.withVideo.bind(source),
    json: async (...args) => {
      const requestId = randomUUID();
      const value = await source.json(...args);
      // Only the structured return value is serialized, never prompt/media args
      // or the provider's transport/CLI output. Redaction never mutates it.
      const json = JSON.stringify(value, (_key, item) => typeof item === 'string'
        ? redactions.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), item) : item) ?? 'null';
      const bytes = Buffer.byteLength(json);
      const response = bytes <= 64 * 1024 ? JSON.parse(json) : { omitted: true, reason: 'Structured response exceeds 64 KB.', bytes };
      trace.event('provider.response', 'returned', 'Structured response saved before workflow validation.', { requestId, provider, model, response });
      return value;
    },
  };
}
