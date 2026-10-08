import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { mediaExecutables, probeMedia } from '../../src/server/media/probe.js';
import { runProcess } from '../../src/server/media/process.js';
import { narrate } from './narrate.js';

// Synthetic tone and explicit fixture timestamps test local validation only.
// This is not generated speech or a real recognition result; no service is used.
async function fixture(t: TestContext, duration: number) {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-chapter-speech-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const audioPath = join(directory, 'synthetic-tone.wav');
  await runProcess(mediaExecutables().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
    `sine=frequency=440:sample_rate=48000:duration=${duration}`, '-c:a', 'pcm_s16le', audioPath]);
  const bytes = await readFile(audioPath);
  const audioSha256 = createHash('sha256').update(bytes).digest('hex');
  const draftPath = join(directory, 'draft.json');
  const transcriptPath = join(directory, 'synthetic-transcript.json');
  const words = [{ text: 'Synthetic.', startSeconds: 0.1, endSeconds: 0.2 }];
  await writeFile(draftPath, JSON.stringify({ narration: 'Synthetic.' }));
  await writeFile(transcriptPath, JSON.stringify({ provider: 'Synthetic test fixture; not speech recognition',
    audioSha256, text: 'Synthetic.', words }));
  return { directory, audioPath, draftPath, transcriptPath, bytes, audioSha256, words,
    options: { audioPath, transcriptPath, audioLabel: 'Synthetic local duration-policy fixture' } };
}

test('a real four-second WAV is valid as a chapter while standalone keeps its five-second minimum', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 4);
  const chapterOutput = join(f.directory, 'chapter');
  const result = await narrate(f.draftPath, chapterOutput, { ...f.options, unit: 'chapter' });
  assert.deepEqual(await readFile(result), f.bytes, 'Chapter validation must preserve the exact waveform.');
  assert.equal((await probeMedia(result)).durationSeconds, 4);
  const narration = JSON.parse(await readFile(join(chapterOutput, 'narration.json'), 'utf8'));
  assert.deepEqual(narration.words, [{ text: 'Synthetic.', start: 0.1, end: 0.2 }]);
  for (const name of ['request.json', 'audio-provenance.json', 'validation.json']) {
    const record = JSON.parse(await readFile(join(chapterOutput, name), 'utf8'));
    assert.deepEqual(record.durationPolicy, { unit: 'chapter', minimumSeconds: 1, maximumSeconds: 90 });
  }
  const provenance = JSON.parse(await readFile(join(chapterOutput, 'audio-provenance.json'), 'utf8'));
  assert.equal(provenance.finalAudioSha256, f.audioSha256);
  await assert.rejects(narrate(f.draftPath, join(f.directory, 'default-standalone'), f.options), /5–90 seconds \(standalone\)/u);
  await assert.rejects(narrate(f.draftPath, join(f.directory, 'explicit-standalone'), { ...f.options, unit: 'standalone' }), /5–90 seconds \(standalone\)/u);
});

test('chapter mode still rejects audio shorter than one second', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 0.5);
  await assert.rejects(narrate(f.draftPath, join(f.directory, 'too-short'), { ...f.options, unit: 'chapter' }), /1–90 seconds \(chapter\)/u);
});

test('chapter duration policy does not bypass the retained-waveform transcript check', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 4);
  const transcript = JSON.parse(await readFile(f.transcriptPath, 'utf8'));
  await writeFile(f.transcriptPath, JSON.stringify({ ...transcript, audioSha256: '0'.repeat(64) }));
  await assert.rejects(narrate(f.draftPath, join(f.directory, 'wrong-waveform'), { ...f.options, unit: 'chapter' }), /Saved transcript does not match the final audio waveform/u);
});
