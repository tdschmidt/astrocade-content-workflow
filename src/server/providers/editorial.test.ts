import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeFootage, draftScript, mapWindowEvents, phraseCaptions, shortenScript, storyMode, transcriptWarnings, validateCuts } from './editorial.js';
import type { Capture } from '../../shared/domain.js';
import type { GoogleServices } from './google.js';

test('cuts reject invalid numbers, overlap, overrun and gaps in observed action', () => {
  for (const cuts of [
    [{ startSeconds: NaN, endSeconds: 2 }], [{ startSeconds: 0, endSeconds: Infinity }],
    [{ startSeconds: 1, endSeconds: 11 }], [{ startSeconds: 2, endSeconds: 2 }],
    [{ startSeconds: 0, endSeconds: 4 }, { startSeconds: 3, endSeconds: 5 }],
  ]) assert.throws(() => validateCuts(cuts, 10));
  assert.throws(() => validateCuts([{ startSeconds: 1, endSeconds: 9 }], 10, [{ startSeconds: 0, endSeconds: 4 }, { startSeconds: 6, endSeconds: 10 }]));
  assert.throws(() => validateCuts([{ startSeconds: 1, endSeconds: 2 }], 10, []));
  const valid = [{ startSeconds: 5, endSeconds: 9 }, { startSeconds: 0, endSeconds: 4 }];
  assert.deepEqual(validateCuts(valid, 10, [{ startSeconds: 0, endSeconds: 6 }, { startSeconds: 5, endSeconds: 10 }]), valid);
});

test('dense timestamps map exactly once from window-relative to source time', () => {
  const event = { startSeconds: 1, endSeconds: 4, event: 'jump', evidence: 'avatar rises', outcome: 'lands' };
  assert.deepEqual(mapWindowEvents([event], { startSeconds: 20, endSeconds: 26 }, 30), [{ ...event, startSeconds: 21, endSeconds: 24 }]);
  assert.throws(() => mapWindowEvents([{ ...event, startSeconds: 21, endSeconds: 24 }], { startSeconds: 20, endSeconds: 26 }, 30));
});

test('captions follow measured words and split on length, pauses and punctuation', () => {
  const words = ['One', 'two', 'three', 'four', 'five', 'six', 'seven.'].map((text, index) => ({ text, startSeconds: index * 0.3, endSeconds: index * 0.3 + 0.2 }));
  const captions = phraseCaptions(words, 3);
  assert.deepEqual(captions.map(caption => caption.text), ['One two three four five six', 'seven.']);
  assert.equal(captions[0]!.startSeconds, words[0]!.startSeconds);
  assert.equal(captions.at(-1)!.endSeconds, words.at(-1)!.endSeconds);
  assert.throws(() => phraseCaptions([{ text: 'bad', startSeconds: 1, endSeconds: 3 }], 2));
  assert.throws(() => phraseCaptions([{ text: 'one', startSeconds: 0, endSeconds: 1 }, { text: 'two', startSeconds: 0.9, endSeconds: 2 }], 2));
});

test('transcript comparison ignores punctuation but flags changed negations and numbers', () => {
  assert.deepEqual(transcriptWarnings('We found it!', 'we found it'), []);
  assert.ok(transcriptWarnings('It is not safe after 3 tries.', 'It is safe after 5 tries.').some(warning => warning.includes('number or negation')));
  assert.ok(transcriptWarnings('Jump across the gap.', 'This is an unrelated sentence.').some(warning => warning.includes('differs')));
  assert.equal(storyMode('An original fictional true-crime style story'), 'fiction');
  assert.equal(storyMode('A factual story about a real event'), 'factual');
});

const capture: Capture = {
  id: 'capture', runId: 'run', profileId: 'profile', path: '/fixture.webm', durationSeconds: 80,
  width: 1280, height: 720, createdAt: '2026-10-06T12:00:00Z',
  game: { id: 'game', title: 'Jump', titleSource: 'visible_text', url: 'https://www.astrocade.com/games/jump', metrics: [], observations: [] },
  analysis: { usable: true, reason: 'Visible action', mechanic: 'Jumping', visualScore: 4, events: [{ startSeconds: 0, endSeconds: 30, event: 'Jump across platforms', evidence: 'Avatar jumps and lands', outcome: 'Reaches a platform' }] },
};

function googleFixture(responses: unknown[], sampled: number[] = []): GoogleServices {
  return {
    withVideo: async (_path: string, operation: (video: { uri: string; mimeType: string }) => Promise<unknown>) => operation({ uri: 'fixture-video', mimeType: 'video/webm' }),
    json: async (_prompt: string, _schema: unknown, media: Array<{ processing?: { fps: number } }> = []) => {
      if (!responses.length) throw new Error('unexpected model call');
      if (media[0]?.processing) sampled.push(media[0].processing.fps);
      return responses.shift();
    },
  } as unknown as GoogleServices;
}

test('a short recording gets one full 8 FPS review with absolute timestamps', async () => {
  const shortCapture = { ...capture, durationSeconds: 12.948 };
  const event = { ...capture.analysis!.events[0]!, startSeconds: 3.2, endSeconds: 7.4 };
  const sampled: number[] = [];
  const result = await analyzeFootage(shortCapture, googleFixture([{ ...capture.analysis!, events: [event] }], sampled));
  assert.deepEqual(sampled, [8]);
  assert.deepEqual(result.events, [{ ...event, evidence: `8 FPS review: ${event.evidence}` }]);
  for (const invalid of [{ ...event, endSeconds: 12.949 }, { ...event, startSeconds: -1 }, { ...event, endSeconds: event.startSeconds }]) {
    await assert.rejects(analyzeFootage(shortCapture, googleFixture([{ ...capture.analysis!, events: [invalid] }])), /outside the recording|greater than|Too small/);
  }
  const idle = await analyzeFootage(shortCapture, googleFixture([{ ...capture.analysis!, usable: false, reason: 'Opening banner obscures the only action', events: [event] }]));
  assert.equal(idle.usable, false);
  assert.deepEqual(idle.events, []);
});

test('analysis uses one coarse and at most three dense calls, mapping only verified events', async () => {
  const event = capture.analysis!.events[0]!;
  const coarse = { ...capture.analysis!, events: [0, 20, 40, 60].map(start => ({ ...event, startSeconds: start, endSeconds: start + 10 })) };
  const dense = { timebase: 'window_relative', analysis: { ...capture.analysis!, events: [{ ...event, startSeconds: 1, endSeconds: 8 }] } };
  const sampled: number[] = [];
  const result = await analyzeFootage(capture, googleFixture([coarse, dense, dense, dense], sampled));
  assert.deepEqual(sampled, [1, 8, 8, 8]);
  assert.deepEqual(result.events.map(event => event.startSeconds), [1, 20, 40]);
  assert.ok(result.events.every(event => event.evidence.startsWith('8 FPS review:')));
});

test('coarse apparent action cannot survive a dense review that found only idle footage', async () => {
  const coarse = { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 10 }] };
  const idle = { timebase: 'window_relative', analysis: { ...capture.analysis!, usable: false, reason: 'Static menu', events: [] } };
  const result = await analyzeFootage(capture, googleFixture([coarse, idle]));
  assert.equal(result.usable, false);
  assert.deepEqual(result.events, []);
});

const script = { hook: 'Watch the landing', narration: 'The tiny explorer found a way home.', caption: 'A short story.', cuts: [{ startSeconds: 0, endSeconds: 25 }], rationale: 'Visible jumps', claims: [] };

test('a core highlight preserves one contiguous event instead of joining short contacts', async () => {
  const single = { ...script, narration: '', cuts: [{ startSeconds: 3, endSeconds: 7 }] };
  const result = await draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([single]));
  assert.deepEqual(result.cuts, single.cuts);
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([{ ...single, cuts: [{ startSeconds: 4.5, endSeconds: 5.625 }, { startSeconds: 9.5, endSeconds: 11.125 }] }])), /one contiguous/);
});

test('fiction is labeled and a script cannot cut unobserved footage', async () => {
  const result = await draftScript({ capture, format: 'story', topic: 'An original fictional story' }, googleFixture([script]));
  assert.ok(result.caption.startsWith('Original fiction.'));
  assert.ok(result.caption.includes(capture.game.url));
  await assert.rejects(draftScript({ capture, format: 'recommendation', topic: '' }, googleFixture([{ ...script, cuts: [{ startSeconds: 20, endSeconds: 45 }] }])), /outside the verified action/);
});

test('a 12-second recommendation uses its observed action without a minimum-duration filler requirement', async () => {
  const shortCapture = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, startSeconds: 4, endSeconds: 16 }] } };
  const shortScript = { ...script, narration: 'If you like precise jumps, this quick platform challenge gives you a clear landing to aim for.', cuts: [{ startSeconds: 4, endSeconds: 16 }] };
  const result = await draftScript({ capture: shortCapture, format: 'recommendation', topic: '' }, googleFixture([shortScript]));
  assert.deepEqual(result.cuts, shortScript.cuts);
  assert.equal(result.narration, shortScript.narration);
  await assert.rejects(draftScript({ capture: shortCapture, format: 'recommendation', topic: '' }, googleFixture([{ ...shortScript, narration: ' ' }])), /needs a spoken line/);
});

test('factual stories require actual source evidence and shortening preserves edit decisions', async () => {
  await assert.rejects(draftScript({ capture, format: 'story', topic: 'A factual story about a real event' }, googleFixture([])), /research snapshot/);
  const shortened = await shortenScript(script, 6, googleFixture([{ narration: 'The explorer found home.' }]));
  assert.deepEqual(shortened.cuts, script.cuts);
  assert.equal(shortened.caption, script.caption);
  await assert.rejects(shortenScript(script, 6, googleFixture([{ narration: script.narration }])), /still too long/);
});
