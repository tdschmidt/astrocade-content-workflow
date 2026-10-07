import { GoogleGenAI } from '@google/genai';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Configuration } from '../../src/server/config.js';
import { GoogleServices } from '../../src/server/providers/google.js';
import { mediaExecutables, probeMedia } from '../../src/server/media/probe.js';
import { runProcess } from '../../src/server/media/process.js';
import { canonicalSpeechTokens, speechTranscriptWarnings } from './speech-validation.js';
import { z } from 'zod';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface NarrationOptions { audioPath?: string; audioLabel?: string; transcriptPath?: string; tempo?: number; allowZeroLengthWords?:boolean; signal?:AbortSignal }
const SavedTranscript = z.object({provider:z.string().min(1),audioSha256:z.string().regex(/^[a-f0-9]{64}$/u),text:z.string(),words:z.array(z.object({text:z.string(),startSeconds:z.number(),endSeconds:z.number()})).min(1)}).passthrough();

export async function narrate(draftPath: string, output: string, options: NarrationOptions = {}) {
  options.signal?.throwIfAborted();
  const tempo = options.tempo ?? 1;
  if (!Number.isFinite(tempo) || tempo < 0.8 || tempo > 1.3) throw new Error('Narration tempo must be between 0.8 and 1.3');
  const raw = await readFile(draftPath, 'utf8'), draft = JSON.parse(raw);
  if (typeof draft.narration !== 'string' || !draft.narration.trim()) throw new Error('Draft needs narration');
  const reusedAudioPath = options.audioPath ? resolve(options.audioPath) : undefined;
  if (options.audioLabel && !reusedAudioPath) throw new Error('An audio label requires an existing source WAV');
  const reusedBytes = reusedAudioPath ? await readFile(reusedAudioPath) : undefined;
  if (reusedBytes && (reusedBytes.subarray(0, 4).toString() !== 'RIFF' || reusedBytes.subarray(8, 12).toString() !== 'WAVE')) throw new Error('Reused narration must be an existing WAV file');
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const cfg = await Configuration.open(), settings = cfg.get(), events: unknown[] = [];
  const voiceLabel = reusedAudioPath ? (options.audioLabel?.trim() || 'Reused WAV; see source audio provenance') : `${settings.voice} / ${settings.speechModel}`;
  const event = (value: unknown) => { events.push(value); process.stderr.write(JSON.stringify(value) + '\n'); };
  const audioPath = resolve(output, 'narration.wav');
  const inputAudioPath = resolve(output, 'input-narration.wav');
  const request = {
    createdAt: new Date().toISOString(), draftPath: resolve(draftPath), draftSha256: hash(raw),
    speechModel: settings.speechModel, transcriptionModel: settings.transcriptionModel, voice: settings.voice, script: draft.narration,
    synthesis: { mode: reusedAudioPath ? 'existing-wav' : 'configured-speech-provider', voiceLabel },
    savedTranscriptPath: options.transcriptPath ? resolve(options.transcriptPath) : null,
    resume: { reuseExistingAudio: !!reusedAudioPath, sourceAudioPath: reusedAudioPath ?? null, sourceAudioSha256: reusedBytes ? hash(reusedBytes) : null },
    tempo: { multiplier: tempo, method: 'FFmpeg atempo; preserves pitch', transcribeAfterTempoChange: true },
    captionTimingMode:options.allowZeroLengthWords?'phrase':'word',
  };
  await writeFile(resolve(output, 'request.json'), JSON.stringify(request, null, 2));
  try {
    if (reusedBytes) {
      await writeFile(inputAudioPath, reusedBytes, { flag: 'wx' });
      event({ stage: 'speech-reuse', status: 'completed', sourceAudioPath: reusedAudioPath, sha256: hash(reusedBytes), generatedNewSpeech: false });
    } else {
      // Unary speech returns inline WAV by default; this endpoint rejects the
      // shared provider's explicit delivery:'inline' setting.
      const speechClient = new GoogleGenAI({ apiKey: settings.geminiApiKey, httpOptions: { timeout: 90000, retryOptions: { attempts: 1 } } });
      const started = Date.now();
      event({ stage: 'speech', model: settings.speechModel, status: 'started' });
      const speech = await speechClient.interactions.create({
        model: settings.speechModel, store: false, stream: false,
        input: [{ type: 'user_input', content: [{ type: 'text', text: draft.narration, annotations: [{ type: 'speech_metadata', style: 'Conversational short story. Clear and engaged, brisk but easy to follow. Read exactly these words, with a small pause before the last sentence. Do not read extra headings or directions.' }] }] }],
        response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: settings.voice }] },
      }, { signal: options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000), timeout_ms: 90000, retries: { strategy: 'none' } });
      if (speech.status !== 'completed' || !speech.output_audio?.data) throw new Error('Speech generation did not produce complete audio');
      const bytes = Buffer.from(speech.output_audio.data, 'base64');
      if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new Error('Speech response is not WAV');
      await writeFile(inputAudioPath, bytes, { flag: 'wx' });
      event({ stage: 'speech', model: settings.speechModel, status: 'completed', durationMs: Date.now() - started, sha256: hash(bytes) });
    }
    const inputInfo = await probeMedia(inputAudioPath, cfg.mediaTools,options.signal);
    if (!inputInfo.audio) throw new Error('Narration input has no audio stream');
    event({ stage: 'tempo', status: 'started', multiplier: tempo, inputDurationSeconds: inputInfo.durationSeconds });
    if (tempo === 1) await writeFile(audioPath, await readFile(inputAudioPath), { flag: 'wx' });
    else await runProcess(mediaExecutables(cfg.mediaTools).ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', inputAudioPath, '-map', '0:a:0', '-af', `atempo=${tempo}`, '-c:a', 'pcm_s16le', audioPath], { timeoutMs: 120_000,signal:options.signal });
    const info = await probeMedia(audioPath, cfg.mediaTools,options.signal);
    if (!info.audio || info.durationSeconds < 5 || info.durationSeconds > 90) throw new Error('Speech must contain audio and last 5–90 seconds');
    const audioSha256 = hash(await readFile(audioPath));
    event({ stage: 'tempo', status: 'completed', multiplier: tempo, durationSeconds: info.durationSeconds, audioSha256 });
    await writeFile(resolve(output, 'audio-provenance.json'), JSON.stringify({ inputAudioPath, inputAudioSha256: hash(await readFile(inputAudioPath)), inputMedia: inputInfo, finalAudioPath: audioPath, finalAudioSha256: audioSha256, finalMedia: info, reusedFrom: reusedAudioPath ?? null, tempo }, null, 2));
    // Transcribe the actual retimed waveform. Never divide old timestamps or
    // regenerate speech to evade a transcript mismatch.
    const savedTranscript = options.transcriptPath ? SavedTranscript.parse(JSON.parse(await readFile(resolve(options.transcriptPath),'utf8'))) : undefined;
    if (savedTranscript && savedTranscript.audioSha256 !== audioSha256) throw new Error('Saved transcript does not match the final audio waveform');
    const transcript = savedTranscript ?? await new GoogleServices(settings, event).transcribe(audioPath,options.signal);
    const alignmentProvider = savedTranscript?.provider ?? settings.transcriptionModel;
    if(savedTranscript)event({stage:'transcription-reuse',status:'completed',provider:alignmentProvider,audioSha256,sourcePath:resolve(options.transcriptPath!)});
    await writeFile(resolve(output, 'transcript-1.json'), JSON.stringify(transcript, null, 2));
    const words = transcript.words.map(word => ({ text: word.text.trim(), start: word.startSeconds, end: word.endSeconds }));
    let end = 0;
    const issues = speechTranscriptWarnings(draft.narration, transcript.text);
    for (const word of words) {
      if (!/^\S+$/u.test(word.text) || ![word.start, word.end].every(Number.isFinite) || word.start < end - 1e-6 || word.end < word.start || (word.end===word.start&&!options.allowZeroLengthWords) || word.end > info.durationSeconds + 0.04) issues.push('Invalid or overlapping word timing');
      end = word.end;
    }
    if (!words.length) issues.push('No real word timestamps were returned');
    const validation = { audio: info, audioSha256, wordCount: words.length, transcriptWarnings: issues,
      transcriptComparison: 'Bounded English-number normalization before transcript comparison; no material mismatch flagged is not a listening review.',
      sourceScript: draft.narration, recognizedText: transcript.text, canonicalScriptTokens: canonicalSpeechTokens(draft.narration), canonicalTranscriptTokens: canonicalSpeechTokens(transcript.text), tempo,
      zeroLengthProviderWords:words.filter(w=>w.start===w.end),captionTimingMode:options.allowZeroLengthWords?'phrase':'word' };
    await writeFile(resolve(output, 'validation.json'), JSON.stringify(validation, null, 2));
    if (issues.length) {
      await writeFile(resolve(output, 'transcript-issues-1.json'), JSON.stringify(issues, null, 2));
      throw new Error('Narration/transcript mismatch or invalid timings; stopped for review of saved evidence.');
    }
    const result = { path: audioPath, script: draft.narration, voiceLabel: `${voiceLabel}${tempo === 1 ? '' : ` / ${tempo}× tempo (pitch preserved)`}`, words,
      alignmentMethod: `${alignmentProvider} final-audio timestamps; ${options.allowZeroLengthWords?'quantized zero-length words retained for phrase captions':'positive word spans'}; no estimated interpolation` };
    await writeFile(resolve(output, 'narration.json'), JSON.stringify(result, null, 2));
    return audioPath;
  } catch (error) {
    await writeFile(resolve(output, 'error.json'), JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
    throw error;
  } finally { await writeFile(resolve(output, 'provider-events.json'), JSON.stringify(events, null, 2)); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [draft, output, ...flags] = process.argv.slice(2);
  if (!draft || !output) throw new Error('Usage: node --import tsx experiments/story-background/narrate.ts DRAFT.json NEW_OUTPUT_DIR [--audio EXISTING.wav] [--tempo 1.16]');
  const options: NarrationOptions = {};
  for (let index = 0; index < flags.length;) {
    const flag = flags[index], value = flags[index + 1];
    if(flag==='--phrase-timing'){options.allowZeroLengthWords=true;index++;continue;}
    if (!value || !['--audio','--tempo','--audio-label','--transcript'].includes(flag!)) throw new Error('Expected --audio PATH, --audio-label LABEL, --transcript JSON or --tempo NUMBER');
    if (flag === '--audio') options.audioPath = resolve(value);
    else if (flag === '--audio-label') options.audioLabel = value;
    else if (flag === '--transcript') options.transcriptPath = resolve(value);
    else options.tempo = Number(value);
    index+=2;
  }
  narrate(resolve(draft), resolve(output), options).then(console.log).catch(error => { console.error(error instanceof Error ? error.message : 'Narration failed'); process.exitCode = 1; });
}
