import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';

/** One local writer, atomic replacement, and validation on both disk boundaries. */
export class JsonStore<T> {
  private value: T;
  private pending: Promise<void> = Promise.resolve();

  private constructor(private path: string, private schema: ZodType<T>, initial: T) {
    this.value = initial;
  }

  static async open<T>(path: string, schema: ZodType<T>, initial: T): Promise<JsonStore<T>> {
    let value = initial;
    try {
      value = schema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return new JsonStore(path, schema, value);
  }

  read(): T { return structuredClone(this.value); }

  async update(change: (current: T) => void): Promise<T> {
    const operation = this.pending.then(async () => {
      const next = this.read();
      change(next);
      const validated = this.schema.parse(next);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, this.path);
        this.value = validated;
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.pending = operation.catch(() => {});
    await operation;
    return this.read();
  }
}
