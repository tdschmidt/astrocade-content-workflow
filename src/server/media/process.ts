import { spawn } from 'node:child_process';

export function abortError(): Error {
  return Object.assign(new Error('Operation canceled'), { name: 'AbortError' });
}

export async function runProcess(
  executable: string,
  args: readonly string[],
  options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const limit = options.maxOutputBytes ?? 4 * 1024 * 1024;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2_000);
    };
    const onAbort = () => stop(abortError());
    const timer = setTimeout(() => stop(new Error(`${executable} timed out`)), options.timeoutMs ?? 30_000);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const clean = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length + chunk.length > limit) stop(new Error('Media process output exceeded its limit'));
      else stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      // Keep the useful tail of FFmpeg diagnostics without accumulating progress output.
      stderr = (stderr + chunk).slice(-64 * 1024);
    });
    child.once('error', error => { clean(); reject(error); });
    child.once('close', code => {
      clean();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${executable} exited with ${code}: ${stderr.trim()}`));
      else resolve({ stdout, stderr });
    });
  });
}
