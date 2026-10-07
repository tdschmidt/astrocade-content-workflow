import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Capture } from '../shared/domain.js';
import type { ContentBrief } from '../shared/content.js';
import { CodexServices } from '../server/providers/codex.js';
import type { Inference, MediaInput } from '../server/providers/inference.js';
import { extractVideoFrames, type VideoFrames } from '../server/media/frames.js';
import { probeMedia } from '../server/media/probe.js';
import { runProcess } from '../server/media/process.js';
import { reviewedWindows, type EvidenceWindow } from './windows.js';
import { LedgerSchema, GeneratedDraftSchema, draftIssues, type Ledger } from '../../experiments/game-overview/contracts.js';
import { writeOverview } from '../../experiments/game-overview/agent.js';
import { assembleOverview } from '../../experiments/game-overview/assemble.js';
import { mapOverviewChapters, prepareOverviewChapters } from '../../experiments/game-overview/prepare-chapters.js';
import { writeStory } from '../../experiments/story-background/agent.js';
import { reviewStory } from '../../experiments/story-background/review.js';
import { narrate } from '../../experiments/story-background/narrate.js';
import { assemble } from '../../experiments/story-background/assemble.js';
import { ProgressionReviewSchema, assertProgressionReview, readReviewedBackground } from '../../experiments/story-background/background-quality.js';
import { StoryPlanSchema, validateStoryPlan } from '../../experiments/story-background/schema.js';
import { renderStory, storyTools } from '../../experiments/story-background/render.js';

export interface NarratedOptions {
  format: 'overview' | 'story'; capture: Capture; sourceSha256: string; runPath: string; output: string; model: string;
  brief?: ContentBrief; feedbackPath?: string; windowsPath?: string; storySourcePath?: string; narration: 'local' | 'gemini'; signal?: AbortSignal;
}
export interface NarratedResult { videoPath: string; videoSha256: string; planPath: string; caption: string; durationSeconds: number }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function fileHash(path: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
const exists = async (path: string) => access(path).then(() => true, () => false);
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;
const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const Id = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/u);
const Review = z.object({ approved: z.boolean(), issues: z.array(z.string()), rationale: z.string().min(10) });
const SpeechRecord = StoryPlanSchema.shape.narration;

/** Analysis is a search lead; context is decoded again before any claim or cut. */
export function narrationWindows(capture: Capture): EvidenceWindow[] {
  if (!capture.analysis?.usable) throw new Error('Narrated editing requires usable source analysis.');
  const windows = capture.analysis.events.map((event, index) => {
    if (!Number.isFinite(event.startSeconds) || !Number.isFinite(event.endSeconds) || event.startSeconds < 0 || event.endSeconds <= event.startSeconds || event.endSeconds > capture.durationSeconds) throw new Error('Analysis has invalid source bounds.');
    return { id: `event-${index + 1}`, start: Math.max(0, event.startSeconds - 5), end: Math.min(capture.durationSeconds, event.endSeconds + 7), basis: 'core-analysis' as const,
      observation: `${event.event}. Evidence lead: ${event.evidence}. Reported outcome: ${event.outcome}` };
  }).sort((a, b) => a.start - b.start);
  const merged: EvidenceWindow[] = [];
  for (const window of windows) {
    const prior = merged.at(-1);
    if (prior && window.start <= prior.end && Math.max(prior.end, window.end) - prior.start <= 30) { prior.end = Math.max(prior.end, window.end); prior.observation += ` ${window.observation}`; }
    else {
      // Bound sampling and model payload even when an analysis event spans a long run.
      for (let start = window.start; start < window.end; start += 30) merged.push({ ...window, id: `${window.id}-${merged.length + 1}`, start, end: Math.min(start + 30, window.end) });
    }
  }
  if (!merged.length || merged.length > 12 || merged.reduce((sum, w) => sum + w.end - w.start, 0) > 180) throw new Error('Narrated source needs 1–12 focused candidate windows totaling at most 180 seconds; supply reviewed windows.');
  return merged;
}

const Range = z.object({ start: z.number().nonnegative(), end: z.number().positive() });
/** Prevent a model from bridging unseen gaps or recycling productive-looking retries. */
export function assertNarratedSelection(ranges: Array<{ start: number; end: number }>, candidates: EvidenceWindow[], minimum: number, maximum: number): number {
  let previous = 0, duration = 0;
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start || range.start < previous - 1e-6 || !candidates.some(w => range.start >= w.start - 1e-6 && range.end <= w.end + 1e-6)) throw new Error('Narrated selection must be chronological, unique, and wholly within freshly inspected windows.');
    duration += range.end - range.start; previous = range.end;
  }
  if (duration < minimum || duration > maximum) throw new Error(`Narrated selection needs ${minimum}–${maximum}s of actual useful footage; received ${duration.toFixed(2)}s. Do not pad or loop inadequate source.`);
  return duration;
}

const Inspection = z.object({ usable: z.boolean(), reason: z.string(), gameSummary: z.string(),
  facts: z.array(z.object({ id: Id, fact: z.string().min(5), windowId: z.string(), start: z.number().nonnegative(), end: z.number().positive(), observation: z.string().min(10) })).max(20),
  chapters: z.array(z.object({ id: Id, shots: z.array(Range).min(1).max(5), factIds: z.array(Id).min(1), rationale: z.string().min(10) })).max(4),
  captionPosition: z.enum(['upper-middle', 'lower-middle', 'middle']), exclusions: z.array(z.string()),
});
const BackgroundSelection = z.object({ usable: z.boolean(), reason: z.string(), segments: z.array(Range.extend({ evidence: z.string().min(10) })).max(12),
  captionPosition: z.enum(['upper-middle', 'lower-middle', 'middle']), exclusions: z.array(z.string()), continuity: z.string().min(10) });
const StoryLedger = z.object({ id: Id, source_type: z.enum(['public_reddit_post', 'primary_informational_source']), title: z.string().min(1), url: z.url().startsWith('https://'),
  grounded_beats: z.array(z.object({ id: z.string().min(1), fact: z.string().min(1) })).min(1), forbidden_inventions: z.array(z.string()).default([]) }).passthrough();

/** Keep every dense-review interval under the decoder cap without skipping source time. */
export function narrationSampleChunks(ranges: Array<{ start: number; end: number }>) {
  return ranges.flatMap((range, index) => {
    const chunks: Array<{ start: number; end: number; selectionIndex: number }> = [];
    for (let start = range.start; start < range.end; start += 30) {
      chunks.push({ start, end: Math.min(start + 30, range.end), selectionIndex: index });
    }
    return chunks;
  });
}

async function samples(source: string, ranges: Array<{ start: number; end: number }>, output: string, fps: 2 | 8, signal?: AbortSignal) {
  await mkdir(output, { recursive: true });
  const media: MediaInput[] = [], descriptions: string[] = [], records: VideoFrames[] = [];
  let timeline = 0;
  for (const [index, range] of narrationSampleChunks(ranges).entries()) {
    const path = join(output, `window-${index}.json`);
    // Reusing images is allowed only inside an input-fingerprinted run, and keeps retries from decoding again.
    const record: VideoFrames = await exists(path) ? JSON.parse(await readFile(path, 'utf8')) as VideoFrames : await extractVideoFrames(source, join(output, `window-${index}`), { fps, start_offset: `${range.start}s`, end_offset: `${range.end}s` }, storyTools(), signal);
    if (record.sourcePath !== resolve(source) || record.startSeconds !== Math.round(range.start * 1e6) / 1e6 || record.endSeconds !== Math.round(range.end * 1e6) / 1e6 || record.fps !== fps) throw new Error('Saved sampling does not match the requested source window.');
    if (!await exists(path)) await save(path, record);
    records.push(record);
    for (const frame of record.frames) {
      media.push({ type: 'image', mime_type: 'image/jpeg', data: (await readFile(frame.path)).toString('base64') });
      descriptions.push(`Image ${media.length}: window ${range.selectionIndex + 1}, source ${frame.sourceSeconds.toFixed(6)}s; selected timeline ${(timeline + frame.sourceSeconds - range.start).toFixed(6)}s.`);
    }
    timeline += range.end - range.start;
  }
  return { media, timestamps: descriptions.join('\n'), records };
}

export async function runNarratedAgentStage<T>(provider: Inference, output: string, prompt: string, schema: z.ZodType<T>, media: MediaInput[], issues: (value: T) => string[], signal?: AbortSignal): Promise<T> {
  await mkdir(output, { recursive: true });
  const rejectedPath = join(output, 'rejected.json');
  if (await exists(rejectedPath)) throw new Error(`Saved editorial rejection: ${JSON.stringify(await readJson(rejectedPath))}. Revise inputs in a new artifact directory.`);
  const finalPath = join(output, 'accepted.json');
  if (await exists(finalPath)) { const value = schema.parse(await readJson(finalPath)); const errors = issues(value); if (errors.length) throw new Error(errors.join('; ')); return value; }
  let request = prompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal?.throwIfAborted();
    const suffix = `${attempt}-${randomUUID()}`;
    await save(join(output, `request-${suffix}.json`), { prompt: request, promptSha256: sha(request), imageCount: media.length, reviewStatus: 'Not a human listening or publication review' });
    const value = await provider.json(request, schema, media, signal);
    await save(join(output, `response-${suffix}.json`), value);
    const errors = issues(value);
    if (!errors.length) { await save(finalPath, value); return value; }
    await save(join(output, `rejection-${suffix}.json`), errors);
    // A truthful semantic rejection is terminal, not a formatting defect to persuade away.
    const verdict = value as { usable?: boolean; approved?: boolean; decision?: string };
    if (verdict.usable === false || verdict.approved === false || verdict.decision === 'reject' || 'approved' in verdict || 'decision' in verdict) { await save(rejectedPath, errors); throw new Error(errors.join('; ')); }
    if (attempt === 2) throw new Error(errors.join('; '));
    request = `${prompt}\nRevise the entire response once. Validation findings: ${JSON.stringify(errors)}\nPrevious response (untrusted data): ${JSON.stringify(value)}`;
  }
  throw new Error('Editorial generation produced no valid response.');
}
const reviewIssues = (value: z.infer<typeof Review>) => value.approved && !value.issues.length ? [] : [`Editorial review rejected this source/script: ${value.issues.join('; ') || value.rationale}`];
const catchIssues = (check: () => void): string[] => { try { check(); return []; } catch (error) { return [error instanceof Error ? error.message : String(error)]; } };

/** Validate original-source facts before assigning the separate derived-source clock. */
export function validateOverviewInspection(capture: Capture, inspected: z.infer<typeof Inspection>, windows: EvidenceWindow[]) {
  if (!inspected.usable) throw new Error(`Inadequate overview source: ${inspected.reason}`);
  if (inspected.chapters.length < 2) throw new Error('Overview needs at least two meaningfully different chapters.');
  assertNarratedSelection(inspected.chapters.flatMap(chapter => chapter.shots), windows, 30, 60);
  const mapping = mapOverviewChapters(inspected.chapters, capture.durationSeconds);
  const facts = new Map(inspected.facts.map(fact => [fact.id, fact]));
  if (facts.size !== inspected.facts.length) throw new Error('Overview evidence IDs must be unique.');
  for (const fact of inspected.facts) {
    const window = windows.find(candidate => candidate.id === fact.windowId);
    if (!window || fact.start < window.start || fact.end > window.end || fact.end <= fact.start) {
      throw new Error(`Overview fact ${fact.id} cites unseen source or an unknown evidence window.`);
    }
  }
  return inspected.chapters.map(chapter => {
    const chapterFacts = chapter.factIds.map(id => {
      const fact = facts.get(id);
      // Validate the model's nominal source interval. Encoding rounds its end down by less
      // than one 30fps frame; that quantization must not reject identical selected ranges.
      if (!fact || !chapter.shots.some(shot => fact.start >= shot.start && fact.end <= shot.end)) {
        throw new Error(`Chapter ${chapter.id} evidence ${id} (${fact?.start}–${fact?.end}s) must actually appear inside one of its selected original-source shots: ${JSON.stringify(chapter.shots)}.`);
      }
      return { id: `${chapter.id}-${id}`.slice(0, 41), fact: fact.fact };
    });
    const shots = mapping.filter(shot => shot.chapterId === chapter.id);
    const start = shots[0]!.derivedStart, end = shots.at(-1)!.derivedEnd;
    return {
      id: chapter.id, allowedStart: start, allowedEnd: end, preserveFullWindow: true,
      maxSpokenWords: Math.max(20, Math.ceil((end - start) * 2.7)),
      facts: chapterFacts, framing: chapter.rationale, sourceShots: shots,
    };
  });
}

export function overviewLedger(
  capture: Capture,
  sourceSha256: string,
  inspected: z.infer<typeof Inspection>,
  windows: EvidenceWindow[],
  derived: { path: string; sourceSha256: string; provenancePath: string },
): Ledger {
  const chapters = validateOverviewInspection(capture, inspected, windows);
  return LedgerSchema.parse({
    gameTitle: capture.game.title, gameUrl: capture.game.url,
    sourcePath: derived.path, sourceSha256: derived.sourceSha256,
    crop: capture.crop, sourceProvenance: derived.provenancePath,
    gameSummary: inspected.gameSummary, wordRange: [80, 90], chapters,
    gameFacts: inspected.facts.map(fact => ({
      id: fact.id, fact: fact.fact,
      evidence: { kind: 'gameplay', sourcePath: resolve(capture.path), sourceSha256,
        start: fact.start, end: fact.end, observation: fact.observation },
    })),
    editorialBrief: 'Explain the game premise, choices and appeal from the whole verified ledger. These chapters support a coherent overview, not literal action commentary. No sourced description was supplied, so do not invent a whole-game objective, mission, complete roster or unobserved victory.',
    unsupportedClaims: inspected.exclusions,
  });
}

export async function verifySavedNarration(recordPath:string,checkpointPath:string,script:string):Promise<void>{
 const saved=SpeechRecord.parse(await readJson(recordPath));
 const checkpoint=z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/u),scriptSha256:z.string()}).parse(await readJson(checkpointPath));
 if(saved.script!==script||checkpoint.scriptSha256!==sha(script)||resolve(checkpoint.path)!==resolve(saved.path)||await fileHash(saved.path)!==checkpoint.sha256)throw new Error('Saved narration waveform or script changed; resume cannot reuse it.');
}

async function speech(draftPath: string, output: string, narration: 'local' | 'gemini', signal?: AbortSignal): Promise<string> {
  await mkdir(output, { recursive: true });
  const raw = await readFile(draftPath, 'utf8'), draft = JSON.parse(raw) as { chapters?: Array<{ id: string; narration: string }>; narration?: string };
  const chapters = draft.chapters ?? [{ id: 'story', narration: draft.narration ?? '' }];
  const voiceDraft = join(output, 'input-draft.json');
  if (await exists(voiceDraft)) { if (JSON.stringify(await readJson(voiceDraft)) !== JSON.stringify(JSON.parse(raw))) throw new Error('Saved voice belongs to a different script.'); }
  else await save(voiceDraft, JSON.parse(raw));
  const python = resolve(process.env.LOCAL_SPEECH_PYTHON ?? 'data/experiments/local-speech/.venv/bin/python');
  const synthesis = join(output, 'synthesis');
  if (narration === 'local') {
    if (!await exists(join(synthesis, 'synthesis.json'))) {
      if (await exists(synthesis)) throw new Error('Local synthesis was interrupted; preserve its WAVs and use a fresh output or resume the saved synthesis explicitly.');
      await runProcess(python, [resolve('experiments/local-speech/generate.py'), resolve(draftPath), synthesis], { timeoutMs: 240_000, signal });
    }
    const provenance = z.object({ draftSha256: z.string(), provider: z.literal('Local Kokoro ONNX'), chapters: z.array(z.object({ id: z.string(), script: z.string(), path: z.string(), sha256: z.string() })) }).passthrough().parse(await readJson(join(synthesis, 'synthesis.json')));
    if (provenance.draftSha256 !== sha(raw) || provenance.chapters.length !== chapters.length) throw new Error('Local synthesis draft or chapter inventory mismatch; never silently regenerate a mismatched voice.');
    for (const chapter of chapters) { const item = provenance.chapters.find(c => c.id === chapter.id); if (!item || item.script !== chapter.narration || await fileHash(item.path) !== item.sha256) throw new Error('Generated local WAV changed or belongs to another script.'); }
  }
  for (const chapter of chapters) {
    signal?.throwIfAborted();
    const folder = join(output, chapter.id); await mkdir(folder, { recursive: true });
    const recordPath = join(folder, 'narration.json');
    if (await exists(recordPath)) { await verifySavedNarration(recordPath, join(folder, 'waveform.json'), chapter.narration); continue; }
    const chapterDraft = join(folder, 'draft.json'); if (!await exists(chapterDraft)) await save(chapterDraft, { narration: chapter.narration });
    let audioPath: string | undefined, transcriptPath: string | undefined, audioLabel: string | undefined;
    const retainedPath = join(folder, 'retained-waveform.json');
    if (narration === 'gemini' && await exists(retainedPath)) {
      const retained = z.object({path:z.string(),sha256:z.string(),voiceLabel:z.string(),scriptSha256:z.string()}).parse(await readJson(retainedPath));
      if(retained.scriptSha256 !== sha(chapter.narration) || await fileHash(retained.path) !== retained.sha256) throw new Error('Saved Gemini waveform changed or belongs to another script.');
      audioPath=retained.path; audioLabel=retained.voiceLabel;
    }
    if (narration === 'local') {
      audioPath = join(synthesis, chapter.id, 'input-narration.wav'); audioLabel = 'Local Kokoro-82M v1.0 / af_heart';
      const asr = join(folder, 'recognition'); transcriptPath = join(asr, 'transcript.json');
      if (!await exists(transcriptPath)) {
        // A failed recognizer does not regenerate speech; its evidence stays in a unique attempt directory.
        const asrAttempt = await mkdtemp(join(folder, 'recognition-attempt-'));
        const resultDir = join(asrAttempt, 'result');
        await runProcess(python, [resolve('experiments/local-speech/recognize.py'), audioPath, resultDir], { timeoutMs: 300_000, signal });
        await mkdir(asr, { recursive: true }); await save(transcriptPath, await readJson(join(resultDir, 'transcript.json')));
      }
    }
    const attempt = await mkdtemp(join(folder, 'validation-attempt-'));
    const resultFolder = join(attempt, 'result');
    try { await narrate(chapterDraft, resultFolder, { audioPath, transcriptPath, audioLabel, tempo: 1, allowZeroLengthWords: true, signal }); }
    catch (error) {
      const retainedWave=join(resultFolder,'input-narration.wav');
      if(narration==='gemini' && await exists(retainedWave) && !await exists(retainedPath)){
        const request=z.object({synthesis:z.object({voiceLabel:z.string()})}).passthrough().parse(await readJson(join(resultFolder,'request.json')));
        await save(retainedPath,{path:retainedWave,sha256:await fileHash(retainedWave),voiceLabel:request.synthesis.voiceLabel,scriptSha256:sha(chapter.narration)});
      }
      await save(join(folder, `resume-${randomUUID()}.json`), { draftPath: chapterDraft, savedAudio: join(resultFolder, 'input-narration.wav'), message: 'Resume recognition/validation against this exact waveform. Do not regenerate narration to evade a transcript mismatch.' }); throw error; }
    const result = SpeechRecord.parse(await readJson(join(resultFolder, 'narration.json')));
    await save(recordPath, result);
    await save(join(folder, 'waveform.json'), { sha256: await fileHash(result.path), path: result.path, scriptSha256: sha(result.script) });
  }
  return output;
}

/** Public pipeline entry point. Output is a resumable, input-fingerprinted artifact directory. */
export async function renderNarrated(options: NarratedOptions): Promise<NarratedResult> {
  const { capture, signal } = options; signal?.throwIfAborted();
  if (options.format === 'story' && !options.storySourcePath) throw new Error('Story format requires --story-source with a grounded fact ledger.');
  if (!capture.analysis || (!capture.analysis.usable && !options.windowsPath)) throw new Error('Narrated editing requires saved usable analysis or explicit audited source windows.');
  const sourcePath = resolve(capture.path), output = resolve(options.output);
  if (await fileHash(sourcePath) !== options.sourceSha256) throw new Error('Narrated source SHA-256 differs from the capture.');
  const info = await probeMedia(sourcePath, storyTools(), signal);
  if (!info.video || info.video.width !== capture.width || info.video.height !== capture.height || Math.abs(info.durationSeconds - capture.durationSeconds) > 0.15) throw new Error('Narrated source dimensions/duration do not match capture metadata.');
  const feedback = options.feedbackPath ? await readFile(resolve(options.feedbackPath), 'utf8') : '';
  const windowsRaw = options.windowsPath ? await readFile(resolve(options.windowsPath), 'utf8') : undefined;
  const windows = windowsRaw ? reviewedWindows(JSON.parse(windowsRaw), options.sourceSha256, info.durationSeconds) : narrationWindows(capture);
  const ledgerRaw = options.storySourcePath ? await readFile(resolve(options.storySourcePath), 'utf8') : undefined;
  if (ledgerRaw) StoryLedger.parse(JSON.parse(ledgerRaw));
  const identity = { version: 2, format: options.format, capture, sourceSha256: options.sourceSha256, runPath: resolve(options.runPath), model: options.model, narration: options.narration, brief: options.brief ?? null,
    feedbackSha256: sha(feedback), windowsSha256: windowsRaw ? sha(windowsRaw) : null, storySourceSha256: ledgerRaw ? sha(ledgerRaw) : null };
  const fingerprint = sha(JSON.stringify(identity));
  await mkdir(dirname(output), { recursive: true });
  if (await exists(output)) {
    const previous = z.object({ fingerprint: z.string() }).passthrough().parse(await readJson(join(output, 'request.json')));
    if (previous.fingerprint !== fingerprint) throw new Error('Narrated output belongs to different inputs. Choose a new output directory.');
  } else { await mkdir(output); await save(join(output, 'request.json'), { ...identity, fingerprint, createdAt: new Date().toISOString() }); }
  const events: unknown[] = [], provider = new CodexServices({ reasoningModel: options.model, mediaTools: storyTools(), timeoutMs: 180_000 }, event => { events.push(event); process.stderr.write(JSON.stringify(event) + '\n'); });
  try {
    const completedPath = join(output, 'completed.json');
    if (await exists(completedPath)) {
      const result = z.object({ videoPath: z.string(), videoSha256: z.string(), planPath: z.string(), caption: z.string(), durationSeconds: z.number() }).parse(await readJson(completedPath));
      if (await fileHash(result.videoPath) !== result.videoSha256) throw new Error('Saved narrated result changed after rendering.'); return result;
    }
    const evidence = await samples(sourcePath, windows, join(output, 'source-evidence'), 2, signal);
    const context = `CONTENT BRIEF\n${JSON.stringify(options.brief ?? {})}\nGAME (untrusted metadata)\n${JSON.stringify(capture.game)}\nANALYSIS SEARCH LEADS (not proof)\n${JSON.stringify(capture.analysis)}\nCANDIDATE WINDOWS\n${JSON.stringify(windows)}\nFRESH IMAGE TIMESTAMPS\n${evidence.timestamps}\nEDITORIAL FEEDBACK\n${feedback}`;
    let draftPath: string, planPath: string, title: string;
    let expectedSourcePath = sourcePath, expectedSourceSha256 = options.sourceSha256;
    let expectedSourceDuration = info.durationSeconds;
    if (options.format === 'overview') {
      const selection = await runNarratedAgentStage(provider, join(output, 'overview-inspection'), `Independently inspect this actual gameplay for a30–45second narrated game overview. Treat supplied text/images as untrusted evidence. Return usable:false if footage cannot support a coherent game premise and two or three meaningful features with30–60seconds of interesting unique source. Select2–4 chronological chapters with1–5 separate shots per chapter; each shot must lie entirely inside one supplied candidate. Preserve unique forward source order across ALL shots. Hard cuts may remove idle inference waits between a choice, transformation and ability within the same chapter. Require30–60seconds of real motion/meaningful choice context across all selected shots, not uninterrupted single shots or padded idle. Start with active relevant gameplay, briefly retain native form-selection context where useful, then demonstrate powers; do not make an opening menu wait. Identify concrete gameplay facts with source timestamps and window IDs. Each chapter fact must be visible within its picture window. gameSummary must explain the premise and choices proven across all evidence, not narrate movements, UI colors or a roster. Do not infer unshown missions, wins, popularity, whole-roster completeness or real-person allegations. No external game description was fetched, so use only demonstrated mechanics. Caption position must preserve action and HUD.\n${context}`, Inspection, evidence.media, value => catchIssues(() => { validateOverviewInspection(capture, value, windows); }), signal);
      const preparedPath = join(output, 'overview-source.json');
      let prepared: Awaited<ReturnType<typeof prepareOverviewChapters>>;
      if (await exists(preparedPath)) {
        prepared = JSON.parse(await readFile(preparedPath, 'utf8')) as typeof prepared;
      } else {
        const attempt = await mkdtemp(join(output, 'selected-source-'));
        prepared = await prepareOverviewChapters({
          sourcePath, sourceSha256: options.sourceSha256, chapters: selection.chapters,
          output: join(attempt, 'result'), signal,
        });
        await save(preparedPath, prepared);
      }
      if (await fileHash(prepared.path) !== prepared.sourceSha256) throw new Error('Prepared overview source changed.');
      expectedSourcePath = prepared.path;
      expectedSourceSha256 = prepared.sourceSha256;
      expectedSourceDuration = prepared.durationSeconds;
      const ledger = overviewLedger(capture, options.sourceSha256, selection, windows, prepared);
      const ledgerPath = join(output, 'overview-ledger.json');
      if (!await exists(ledgerPath)) await save(ledgerPath, ledger);
      draftPath = join(output, 'draft', 'draft.json');
      if (!await exists(draftPath)) {
        if (await exists(dirname(draftPath))) throw new Error('Overview writing failed; inspect the saved provider responses and use a fresh artifact directory.');
        await writeOverview({ output: dirname(draftPath), ledgerPath, model: options.model, feedbackPath: options.feedbackPath, brief: options.brief, signal });
      }
      const draft = GeneratedDraftSchema.parse(await readJson(draftPath)), issues = draftIssues(draft, ledger, true); if (issues.length) throw new Error(issues.join('; '));
      await runNarratedAgentStage(provider, join(output, 'overview-script-review'), `Independently review this game overview against the actual images and evidence ledger. Factual speech may draw on ANY verified game fact, not only simultaneous shots. It must explain what the game is, player choices and appeal, beginning with the selected premise hook. Reject literal shot-by-shot movement commentary, a roster roll-call, invented goals, fake personal experience, unsupported whole-game claims or misleading chronology. Inspect every spoken factual assertion, not just supplied claim citations. approved means script ready for speech only; no listening or final visual approval.\nLEDGER\n${JSON.stringify(ledger)}\nDRAFT\n${JSON.stringify(draft)}\n${evidence.timestamps}`, Review, evidence.media, reviewIssues, signal);
      const voice = await speech(draftPath, join(output, 'voice'), options.narration, signal);
      planPath = join(output, 'plan.json');
      if (!await exists(planPath)) {
        const assembly = await mkdtemp(join(output, 'assembly-'));
        const result = await assembleOverview({ draftPath, voiceDir: voice, output: join(assembly, 'result'), ledgerPath, id: 'game-overview', position: selection.captionPosition, wordsPerGroup: 3, signal });
        const plan = StoryPlanSchema.parse(await readJson(result.planPath));
        if (plan.source.windows.some(w => w.speed < 0.75 || w.speed > 1.5)) throw new Error('Overview speech needs excessive gameplay retiming; select richer source or revise the script. Saved speech is preserved.');
        await save(planPath, plan);
      }
      title = draft.title;
    } else {
      const selector = await readFile(resolve('experiments/story-background/prompts/background-selector.md'), 'utf8');
      const choice = await runNarratedAgentStage(provider, join(output, 'background-selection'), `${selector}\nSelect45–60seconds of sustained, satisfying native-speed progression to cover90–110words. Return usable:false rather than padding short highlights, repeated failures or stationary ability demonstrations. This planning pass sees2FPS samples; it must not claim whole-motion acceptance. A separate dense sequential reviewer will judge every selected interval. Output only usable,reason,segments(start,end,evidence),captionPosition,exclusions,continuity.\n${context}`, BackgroundSelection, evidence.media, value => catchIssues(() => { if (!value.usable) throw new Error(`Inadequate story background: ${value.reason}`); assertNarratedSelection(value.segments, windows, 45, 60); }), signal);
      const motion = await samples(sourcePath, choice.segments, join(output, 'background-motion'), 8, signal);
      const selectedDuration = choice.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
      const progression = await runNarratedAgentStage(provider, join(output, 'background-review'), `${selector}\nYou are an INDEPENDENT semantic progression reviewer. Review the COMPLETE ordered8FPS frame sequence below, not just endpoints. This is sampled motion, not continuous30FPS playback. Mark watchedWholeSelection=true only if you actually assess every interval/cut and these sequential samples are sufficient to judge its motion; reject if ambiguous. The review record will explicitly disclose this sampling. Never accept because a planner calls it progress. Reject idle inference pauses, repeated early attempts at the same obstacle, static mechanics or any unverified landing/outcome. Use recurring landmarks to keep section IDs consistent across attempts. Each span must cover the full OUTPUT timeline0–${selectedDuration.toFixed(6)}s with no gaps; only demonstrated progress can pass. Record concrete source time/landmark evidence, actual changing situations, and any uncertainty. No human viewing/listening/publication approval is implied.\nPLANNED SELECTION\n${JSON.stringify(choice)}\n${motion.timestamps}`, ProgressionReviewSchema, motion.media, value => catchIssues(() => assertProgressionReview(value, selectedDuration)), signal);
      const backgroundPath = join(output, 'background.json');
      if (!await exists(backgroundPath)) await save(backgroundPath, { sourcePath, sourceSha256: options.sourceSha256, gameTitle: capture.game.title, matchesExactReferenceGenre: false, genreLimit: choice.continuity,
        segments: choice.segments.map(s => ({ sourceStart: s.start, sourceEnd: s.end, speed: 1 })), crop: capture.crop, caption: { position: choice.captionPosition, wordsPerGroup: 4, mode: 'phrase', casing: 'upper' }, progressionReview: progression });
      await readReviewedBackground(backgroundPath);
      const reviewMethod = join(output, 'background-review-method.json'); if (!await exists(reviewMethod)) await save(reviewMethod, { sampling: 'Ordered actual decoded frames at8FPS throughout every selected interval and cut; not native30FPS continuous playback or a human review.', frameCount: motion.media.length, sourceHash: options.sourceSha256, sourceFrames: motion.records, listeningReviewed: false });
      draftPath = join(output, 'draft', 'draft.json');
      if (!await exists(draftPath)) {
        if (await exists(dirname(draftPath))) throw new Error('Story writing failed; inspect saved responses and use a fresh artifact directory.');
        await writeStory(resolve(options.storySourcePath!), dirname(draftPath), { model: options.model, signal, feedback: `${feedback}\nCONTENT BRIEF\n${JSON.stringify(options.brief ?? {})}` });
      }
      const reviewPath = join(output, 'story-review.json');
      if (!await exists(reviewPath)) await reviewStory(resolve(options.storySourcePath!), draftPath, reviewPath, { model: options.model, signal });
      const review = Review.parse(await readJson(reviewPath)); if (reviewIssues(review).length) throw new Error(reviewIssues(review).join('; '));
      const voice = await speech(draftPath, join(output, 'voice'), options.narration, signal);
      planPath = join(output, 'plan.json');
      if (!await exists(planPath)) await assemble(resolve(options.storySourcePath!), draftPath, join(voice, 'story', 'narration.json'), backgroundPath, planPath);
      const draft = z.object({ title: z.string() }).passthrough().parse(await readJson(draftPath)); title = draft.title;
    }
    const plan = StoryPlanSchema.parse(await readJson(planPath));
    if (plan.source.path !== expectedSourcePath || await fileHash(plan.source.path)!==expectedSourceSha256 || JSON.stringify(plan.source.crop) !== JSON.stringify(capture.crop)) throw new Error('Narrated plan changed immutable source/crop.');
    const audioInfo = await probeMedia(plan.narration.path, storyTools(), signal);
    const checked = validateStoryPlan(plan, expectedSourceDuration, audioInfo.durationSeconds);
    const [minimum, maximum] = options.format === 'overview' ? [30, 45] : [35, 60];
    if (checked.duration < minimum! || checked.duration > maximum!) throw new Error(`${options.format} runtime${checked.duration.toFixed(2)}s is outside${minimum}–${maximum}s. Preserve speech and select/revise adequate source; no looping.`);
    const videoPath = join(output, 'video.mp4');
    if (!await exists(videoPath)) await renderStory({ planPath, outputPath: videoPath, tools: storyTools(), signal });
    const result = { videoPath, videoSha256: await fileHash(videoPath), planPath, caption: title, durationSeconds: checked.duration };
    await save(join(output, 'review-needed.json'), { technicalRenderingCompleted: true, humanVisualReviewRequired: true, listeningReviewRequired: true, accepted: false, published: false, sourceSha256: options.sourceSha256,
      provenance: 'Fresh evidence-led model decisions; exact waveform recognition and real timestamps; no hand-authored final cuts. See requests, source evidence, speech hashes and renderer manifest.' });
    await save(completedPath, result); return result;
  } catch (error) { await save(join(output, `failure-${randomUUID()}.json`), { error: error instanceof Error ? error.message : String(error), preservedArtifacts: true }); throw error; }
  finally { await save(join(output, `provider-events-${randomUUID()}.json`), events); }
}
