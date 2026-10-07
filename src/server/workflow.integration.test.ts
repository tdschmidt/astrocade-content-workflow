import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runOptionsSchema } from '../shared/domain.js';
import { Configuration } from './config.js';
import { Workflow } from './workflow.js';
import { mediaExecutables, probeMedia } from './media/probe.js';
import { runProcess } from './media/process.js';
import { fileSha256 } from './instagram/publish.js';

test('SYNTHETIC workflow renders both formats, preserves caption-only edits, and resumes without a key', {
  skip: process.env.RUN_RENDER_TESTS !== '1', timeout: 180_000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'astrocade-SYNTHETIC-workflow-'));
  const environment = new Map(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'INSTAGRAM_USERNAME'].map(key => [key, process.env[key]]));
  for (const key of environment.keys()) process.env[key] = '';
  let workflow: Workflow | undefined;
  let resumed: Workflow | undefined;
  try {
    const config = await Configuration.open(directory);
    config.mediaTools.fontPath = fileURLToPath(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url));
    await config.save({ geminiApiKey: 'synthetic-fixture-never-sent', instagramUsername: 'synthetic_fixture' });
    workflow = await Workflow.open(config);
    const source = join(config.mediaDir, 'SYNTHETIC-source.mp4');
    const tone = join(directory, 'SYNTHETIC-tone.wav');
    const { ffmpeg } = mediaExecutables(config.mediaTools);
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', source]);
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-af', 'volume=0.05', tone]);
    const audioBytes = await readFile(tone);
    const sourceInfo = await probeMedia(source, config.mediaTools);
    const options = runOptionsSchema.parse({ formats: ['highlight', 'recommendation'], comparison: 'same-game' });
    const runId = 'SYNTHETIC-run';
    const gameUrl = 'https://example.invalid/SYNTHETIC-fixture';
    await workflow.store.update(state => {
      state.runs.push({ id: runId, createdAt: new Date().toISOString(), options, status: 'pending', captureIds: ['SYNTHETIC-capture'], draftIds: [] });
      state.captures.push({
        id: 'SYNTHETIC-capture', runId, profileId: 'SYNTHETIC-profile', path: source,
        durationSeconds: sourceInfo.durationSeconds, width: 640, height: 360, createdAt: new Date().toISOString(),
        game: { id: 'SYNTHETIC-game', title: 'SYNTHETIC TEST — not gameplay', titleSource: 'visible_text', url: gameUrl, metrics: [], observations: [] },
        analysis: { usable: true, reason: 'SYNTHETIC fixture observations', mechanic: 'Moving test shapes', visualScore: 4,
          events: [{ startSeconds: 0, endSeconds: 12, event: 'Test pattern moves', evidence: 'SYNTHETIC moving shapes', outcome: 'Test pattern continues' }] },
      });
    });
    const narration = 'Synthetic fixture only. Watch these test shapes move across the screen.';
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/[^/]+\/interactions(?:\?|$)/, 'No Astrocade, browser, or other provider request is allowed');
      const body = JSON.parse(input instanceof Request ? await input.clone().text() : String(init?.body));
      let content: unknown[];
      if (body.model === config.get().reasoningModel) {
        const highlight = String(body.input[0].text).includes('Create a highlight');
        calls.push(highlight ? 'highlight script' : 'recommendation script');
        content = [{ type: 'text', text: JSON.stringify({
          hook: 'SYNTHETIC TEST — moving shapes', narration: highlight ? '' : narration,
          caption: `SYNTHETIC fixture only; not live gameplay. ${gameUrl}`,
          cuts: [{ startSeconds: 0, endSeconds: highlight ? 4 : 12 }],
          rationale: 'Tests orchestration with a generated pattern, not content quality.', claims: [],
        }) }];
      } else if (body.model === config.get().speechModel) {
        calls.push('speech'); assert.equal(body.input[0].text, narration);
        content = [{ type: 'audio', mime_type: 'audio/wav', data: audioBytes.toString('base64') }];
      } else if (body.model === config.get().transcriptionModel) {
        calls.push('transcription'); assert.equal(body.input[0].data, audioBytes.toString('base64'));
        // Deliberately mocked word timings over a sine-wave fixture; this is not an ASR-quality test.
        content = [{ type: 'text', text: narration, annotations: narration.split(' ').map((text, index) => ({
          type: 'word_info', text, start_offset: `${index * 0.25}s`, end_offset: `${index * 0.25 + 0.22}s`,
        })) }];
      } else throw new Error('Unexpected model request');
      return Response.json({ id: 'synthetic-interaction', status: 'completed', steps: [{ type: 'model_output', content }] });
    });
    const context = { signal: new AbortController().signal, progress: async (_step: string) => {} };
    await workflow.generate(runId, options, context);
    assert.deepEqual(calls, ['highlight script', 'recommendation script', 'speech', 'transcription']);
    const drafts = workflow.store.read().drafts;
    assert.equal(drafts.length, 2);
    for (const draft of drafts) {
      assert.equal(draft.status, 'ready'); assert.ok(draft.videoPath); assert.ok(draft.assetSha256);
      const media = await probeMedia(draft.videoPath, config.mediaTools);
      assert.deepEqual([media.video?.codec, media.video?.width, media.video?.height, media.video?.frameRate], ['h264', 1080, 1920, 30]);
      assert.ok(Math.abs(media.durationSeconds - (draft.format === 'highlight' ? 4 : 12)) < 0.15);
      assert.equal(await fileSha256(draft.videoPath), draft.assetSha256);
    }
    const highlight = drafts.find(draft => draft.format === 'highlight')!;
    const recommendation = drafts.find(draft => draft.format === 'recommendation')!;
    assert.equal(highlight.narration, ''); assert.equal(highlight.audioPath, undefined);
    assert.ok(recommendation.audioPath); assert.ok(recommendation.subtitles.length > 0);
    assert.equal((await probeMedia(recommendation.videoPath!, config.mediaTools)).audio?.codec, 'aac');
    assert.ok(recommendation.subtitles.every(phrase => phrase.endSeconds <= 4));
    assert.deepEqual(recommendation.warnings, []);
    await workflow.approveDraft(recommendation.id, 1); // Local fixture approval only; no publisher is invoked.
    assert.ok(workflow.getDraft(recommendation.id, 1).approval);
    const before = await readFile(recommendation.videoPath!);
    await workflow.editDraft(recommendation.id, 1, { hook: recommendation.hook, narration, caption: `${recommendation.caption}\nCaption-only edit.` }, context);
    const edited = workflow.getDraft(recommendation.id, 2);
    assert.equal(edited.approval, undefined); assert.equal(edited.status, 'ready');
    assert.equal(edited.videoPath, recommendation.videoPath); assert.equal(edited.assetSha256, recommendation.assetSha256);
    assert.deepEqual(await readFile(edited.videoPath!), before);
    await config.save({ geminiApiKey: '' }); await workflow.close();
    resumed = await Workflow.open(await Configuration.open(directory));
    assert.equal(resumed.config.get().geminiApiKey, '');
    await resumed.generate(runId, options, context);
    assert.equal(calls.length, 4); assert.equal(resumed.store.read().drafts.length, 3);
    assert.equal(resumed.store.read().runs[0]!.status, 'ready');
    assert.equal(resumed.store.read().captures.length, 1);
  } finally {
    await workflow?.close(); await resumed?.close();
    for (const [key, value] of environment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
