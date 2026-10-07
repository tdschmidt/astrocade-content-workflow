import { join } from 'node:path';
import { runProcess } from '../../src/server/media/process.js';

export type LoudnessMeasurement = Record<string, string>;

export async function measureEncodedAudio(ffmpeg: string, path: string, signal?: AbortSignal): Promise<LoudnessMeasurement> {
  const result = await runProcess(ffmpeg, ['-hide_banner', '-nostdin', '-i', path, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-'], { signal, timeoutMs: 90_000 });
  const match = result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/u);
  const measurement = match ? JSON.parse(match[0]) as LoudnessMeasurement : undefined;
  if (!measurement || !Number.isFinite(Number(measurement.input_i)) || !Number.isFinite(Number(measurement.input_tp))) {
    throw new Error(`Encoded audio has unusable loudness: ${JSON.stringify(measurement ?? null)}`);
  }
  return measurement;
}

/** AAC may overshoot a sample limiter. Correct the measured encode, preserving
 * video packets and relative sound timing, then measure the actual result again. */
export async function enforceEncodedAudioPeak(options: { ffmpeg: string; path: string; outputDirectory: string; signal?: AbortSignal }) {
  let path = options.path;
  let measurement = await measureEncodedAudio(options.ffmpeg, path, options.signal);
  const attempts: Array<{ gainDb: number; before: LoudnessMeasurement; after: LoudnessMeasurement }> = [];
  for (let attempt = 1; Number(measurement.input_tp) > -1 && attempt <= 2; attempt++) {
    const gainDb = -1.5 - Number(measurement.input_tp);
    const next = join(options.outputDirectory, `peak-corrected-${attempt}.mp4`);
    await runProcess(options.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', path,
      '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', `volume=${gainDb.toFixed(6)}dB`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', next], { signal: options.signal, timeoutMs: 90_000 });
    const after = await measureEncodedAudio(options.ffmpeg, next, options.signal);
    attempts.push({ gainDb, before: measurement, after });
    path = next;
    measurement = after;
  }
  if (Number(measurement.input_tp) > -1) throw new Error(`Encoded true peak remains above −1 dBTP: ${JSON.stringify(measurement)}`);
  return { path, measurement, attempts };
}
