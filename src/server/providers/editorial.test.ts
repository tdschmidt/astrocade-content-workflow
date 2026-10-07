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

test('a short recording gets one 8 FPS review and bounded context around the absolute impact', async () => {
  const shortCapture = { ...capture, durationSeconds: 12.948 };
  const event = { ...capture.analysis!.events[0]!, startSeconds: 3.5, endSeconds: 5.6 };
  const response = { ...capture.analysis!, events: [event], playableStartSeconds: 2, playableEndSeconds: 12 };
  const sampled: number[] = [];
  const result = await analyzeFootage(shortCapture, googleFixture([response], sampled));
  assert.deepEqual(sampled, [8]);
  const longerSampled: number[] = [];
  await analyzeFootage({ ...shortCapture, durationSeconds: 45 }, googleFixture([response], longerSampled));
  assert.deepEqual(longerSampled, [8], 'bounded capture probes need only one absolute-time review');
  assert.equal(result.events[0]!.startSeconds, 2, 'context never includes the opening banner');
  assert.equal(result.events[0]!.endSeconds, 6.6, 'the impact retains its visible aftermath');
  assert.match(result.events[0]!.evidence, /Impact: 3.5–5.6s/);
  const late = await analyzeFootage(shortCapture, googleFixture([{ ...response, events: [{ ...event, startSeconds: 10.5, endSeconds: 11.8 }] }]));
  assert.deepEqual([late.events[0]!.startSeconds, late.events[0]!.endSeconds], [8.5, 12]);
  for (const invalid of [{ ...event, endSeconds: 12.949 }, { ...event, startSeconds: -1 }, { ...event, endSeconds: event.startSeconds }]) {
    await assert.rejects(analyzeFootage(shortCapture, googleFixture([{ ...response, events: [invalid] }])), /outside the recording|greater than|Too small/);
  }
  for (const bounds of [{ playableStartSeconds: null }, { playableStartSeconds: 12, playableEndSeconds: 2 }, { playableEndSeconds: 12.949 }, { playableStartSeconds: 4 }, { playableEndSeconds: 5 }]) {
    await assert.rejects(analyzeFootage(shortCapture, googleFixture([{ ...response, ...bounds }])), /playable span/);
  }
  const idle = await analyzeFootage(shortCapture, googleFixture([{ ...response, playableStartSeconds: null, playableEndSeconds: null, usable: false, reason: 'Opening banner obscures the only action', events: [] }]));
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

test('long analysis keeps a late high-priority payoff when earlier windows produce many events', async () => {
  const event = capture.analysis!.events[0]!;
  const coarse = { ...capture.analysis!, events: [60, 0, 20].map(start => ({ ...event, startSeconds: start, endSeconds: start + 10 })) };
  const payoff = { ...event, startSeconds: 7, endSeconds: 10, event: 'Board completed', evidence: 'All items are sorted and the completion panel appears', outcome: 'The board is complete.' };
  const densePayoff = { timebase: 'window_relative', analysis: { ...capture.analysis!, events: [payoff] } };
  const denseEarly = { timebase: 'window_relative', analysis: { ...capture.analysis!, events: [1, 3, 5, 7].map(start => ({ ...event, startSeconds: start, endSeconds: start + 1 })) } };
  const result = await analyzeFootage(capture, googleFixture([coarse, densePayoff, denseEarly, denseEarly]));
  assert.deepEqual(result.events.map(event => event.startSeconds), [1, 3, 5, 7, 20, 66], 'retain the six highest-priority verified events, then present them chronologically');
  assert.equal(result.events.at(-1)!.outcome, payoff.outcome, 'early actions must not evict the verified completion');
});

const script = { hook: 'Watch the landing', narration: 'The tiny explorer found a way home.', caption: 'A short story.', cuts: [{ startSeconds: 0, endSeconds: 25 }], rationale: 'Visible jumps', claims: [] };

test('a highlight preserves the whole context of a single selected event', async () => {
  const shortCapture = { ...capture, durationSeconds: 12.948, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, startSeconds: 2, endSeconds: 6.6 }] } };
  const choice = { eventIndexes: [0], hook: script.hook, rationale: script.rationale };
  const result = await draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([choice]));
  assert.deepEqual(result.cuts, [{ startSeconds: 2, endSeconds: 6.6 }]);
  assert.equal(result.narration, '');
  assert.equal(result.caption, `${shortCapture.game.title}\n${shortCapture.analysis.events[0]!.outcome}\nPlay: ${shortCapture.game.url}`, 'caption uses the selected observation without another invented claim');
  await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, eventIndexes: [1] }])), /unknown observed event/);
  await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, eventIndexes: [0, 0] }])), /duplicate observed events/);
  for (const eventIndexes of [[], [0, 1, 2, 3], [-1], [0.5]]) {
    await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, eventIndexes }])));
  }
  for (const cuts of [[{ startSeconds: 3.5, endSeconds: 5.6 }], [{ startSeconds: 4.5, endSeconds: 5.625 }, { startSeconds: 9.5, endSeconds: 11.125 }]]) {
    await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, cuts }])), /Unrecognized key/);
  }
});

test('a highlight joins overlapping transformation phases once and captions them chronologically', async () => {
  const phases = [
    { startSeconds: 11, endSeconds: 14, event: 'Earned result panel', evidence: 'A three-star panel appears after the customer leaves', outcome: 'The result panel shows three stars.' },
    { startSeconds: 1, endSeconds: 5, event: 'Dirty before-state and first wash', evidence: 'Dirt covers the car before soap spreads', outcome: 'Soap spreads across the dirty car.' },
    { startSeconds: 4, endSeconds: 12, event: 'Cleaning changes the car', evidence: 'Visible dirt vanishes and the customer leaves', outcome: 'The car becomes clean and the customer leaves.' },
  ];
  const transformationCapture = { ...capture, analysis: { ...capture.analysis!, events: phases } };
  const original = structuredClone(transformationCapture);
  const result = await draftScript({ capture: transformationCapture, format: 'highlight', topic: '' }, googleFixture([
    { eventIndexes: [0, 2, 1], hook: 'A dirty car earns three stars', rationale: 'Shows the dirty setup, cleaning and visible result.' },
  ]));
  assert.deepEqual(result.cuts, [{ startSeconds: 1, endSeconds: 14 }], 'overlapping verified phases never repeat source frames');
  assert.equal(result.caption, `${capture.game.title}\n${phases[1]!.outcome}\n${phases[2]!.outcome}\n${phases[0]!.outcome}\nPlay: ${capture.game.url}`);
  assert.deepEqual(transformationCapture, original, 'selection must not reorder or merge the saved observations');
});

test('a highlight orders separate verified phases without filling gaps or exceeding 40 seconds', async () => {
  const event = capture.analysis!.events[0]!;
  const choice = { eventIndexes: [1, 0], hook: script.hook, rationale: script.rationale };
  const separated = { ...capture, analysis: { ...capture.analysis!, events: [
    { ...event, startSeconds: 1, endSeconds: 10 }, { ...event, startSeconds: 20, endSeconds: 25 },
  ] } };
  const result = await draftScript({ capture: separated, format: 'highlight', topic: '' }, googleFixture([choice]));
  assert.deepEqual(result.cuts, [{ startSeconds: 1, endSeconds: 10 }, { startSeconds: 20, endSeconds: 25 }]);
  const overlap = { ...capture, analysis: { ...capture.analysis!, events: [
    { ...event, startSeconds: 0, endSeconds: 30 }, { ...event, startSeconds: 20, endSeconds: 40 },
  ] } };
  const forty = await draftScript({ capture: overlap, format: 'highlight', topic: '' }, googleFixture([choice]));
  assert.deepEqual(forty.cuts, [{ startSeconds: 0, endSeconds: 40 }], 'the duration budget counts overlapping frames only once');
  const tooLong = { ...capture, analysis: { ...capture.analysis!, events: [{ ...event, startSeconds: 0, endSeconds: 40.01 }] } };
  await assert.rejects(draftScript({ capture: tooLong, format: 'highlight', topic: '' }, googleFixture([{ ...choice, eventIndexes: [0] }])), /40-second edit target/);
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
