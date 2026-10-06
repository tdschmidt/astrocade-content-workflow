import assert from 'node:assert/strict';
import test from 'node:test';
import { runProcess } from './process.js';

test('canceling a media subprocess waits for termination and reports cancellation', async () => {
  const controller = new AbortController();
  const running = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(running, { name: 'AbortError' });
});

test('media process failures retain diagnostic output', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', "process.stderr.write('bad input');process.exit(3)"]), /exited with 3: bad input/u);
});
