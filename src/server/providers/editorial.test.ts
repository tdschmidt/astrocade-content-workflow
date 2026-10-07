import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeFootage, draftScript, mapWindowEvents, phraseCaptions, shortenScript, storyMode, transcriptWarnings, validateCuts } from './editorial.js';
import { defaultContentBrief, type ContentAssessment } from '../../shared/content.js';
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

const content: ContentAssessment = { angle: 'prediction', clarity: 3, participation: 2, payoff: 2, readability: 3, distinctiveness: 1, evidence: 'Visible gap, jump and landing.', textPlacement: 'upper', placementReason: 'Decorative sky above the action.' };

const capture: Capture = {
  id: 'capture', runId: 'run', profileId: 'profile', path: '/fixture.webm', durationSeconds: 80,
  width: 1280, height: 720, createdAt: '2026-10-06T12:00:00Z',
  game: { id: 'game', title: 'Jump', titleSource: 'visible_text', url: 'https://www.astrocade.com/games/jump', metrics: [], observations: [] },
  analysis: { usable: true, reason: 'Visible action', mechanic: 'Jumping', visualScore: 4, content, events: [{ startSeconds: 0, endSeconds: 30, event: 'Jump across platforms', evidence: 'Avatar jumps and lands', outcome: 'Reaches a platform' }] },
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
  assert.equal(result.events[0]!.endSeconds, 7.6, 'the impact retains up to two seconds of verified aftermath');
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
  const dense = { timebase: 'window_relative', analysis: { ...capture.analysis!, playableStartSeconds: 0, playableEndSeconds: 11, events: [{ ...event, startSeconds: 1, endSeconds: 8 }] } };
  const sampled: number[] = [];
  const result = await analyzeFootage(capture, googleFixture([coarse, dense, dense, dense], sampled));
  assert.deepEqual(sampled, [1, 8, 8, 8]);
  assert.deepEqual(result.events.map(event => event.startSeconds), [0, 19, 39]);
  assert.ok(result.events.every(event => event.evidence.startsWith('8 FPS review:')));
});

test('dense reviews retain failure aftermath only inside their observed playable span and source window', async () => {
  const longCapture = { ...capture, durationSeconds: 140 };
  const event = capture.analysis!.events[0]!;
  const coarse = { ...capture.analysis!, events: [{ ...event, startSeconds: 88, endSeconds: 94 }] };
  // The dense source window is 87–95s; all response timestamps are relative to it.
  const analysis = { ...capture.analysis!, playableStartSeconds: 0.5, playableEndSeconds: 7.5, events: [{ ...event, startSeconds: 4.5, endSeconds: 5.5, outcome: 'Wrong drop; the item returns to the tray.' }] };
  const analyze = (changes = {}) => analyzeFootage(longCapture, googleFixture([coarse, { timebase: 'window_relative', analysis: { ...analysis, ...changes } }]));
  const result = await analyze();
  assert.deepEqual(result.events.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })), [{ startSeconds: 89.5, endSeconds: 94.5 }]);
  assert.match(result.events[0]!.evidence, /Impact: 91.5–92.5s/);
  assert.match(result.events[0]!.evidence, /playable span 87.5–94.5s \(source time\)/);
  const clamped = await analyze({ playableStartSeconds: 4, playableEndSeconds: 6 });
  assert.deepEqual([clamped.events[0]!.startSeconds, clamped.events[0]!.endSeconds], [91, 93], 'context cannot enter a banner or idle region outside the observed span');
  const windowEnd = await analyze({ playableEndSeconds: 8, events: [{ ...event, startSeconds: 7.4, endSeconds: 7.8 }] });
  assert.equal(windowEnd.events[0]!.endSeconds, 95, 'remaining source footage outside the dense window is not observed context');
  for (const bounds of [{ playableStartSeconds: null }, { playableStartSeconds: 7, playableEndSeconds: 1 }, { playableEndSeconds: 8.1 }, { playableStartSeconds: 5 }, { playableEndSeconds: 5 }]) {
    await assert.rejects(analyze(bounds), /playable span/);
  }
  await assert.rejects(analyze({ events: [{ ...event, startSeconds: 7, endSeconds: 8.1 }] }), /outside the recording or review window/);
  const empty = await analyze({ events: [], playableStartSeconds: null, playableEndSeconds: null });
  assert.equal(empty.usable, false);
  assert.deepEqual(empty.events, []);
});

test('coarse apparent action cannot survive a dense review that found only idle footage', async () => {
  const coarse = { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 10 }] };
  const idle = { timebase: 'window_relative', analysis: { ...capture.analysis!, playableStartSeconds: null, playableEndSeconds: null, usable: false, reason: 'Static menu', events: [] } };
  const result = await analyzeFootage(capture, googleFixture([coarse, idle]));
  assert.equal(result.usable, false);
  assert.deepEqual(result.events, []);
});

test('a good dense window cannot admit another window with a disqualifying content dimension', async () => {
  const event = capture.analysis!.events[0]!;
  const coarse = { ...capture.analysis!, events: [20, 0].map(start => ({ ...event, startSeconds: start, endSeconds: start + 10 })) };
  const goodContent = { ...content, clarity: 3, participation: 3, payoff: 3, readability: 3, distinctiveness: 3 };
  const good = { timebase: 'window_relative', analysis: { ...capture.analysis!, content: goodContent, playableStartSeconds: 0, playableEndSeconds: 11, events: [{ ...event, startSeconds: 1, endSeconds: 8 }] } };
  for (const dimension of ['clarity', 'payoff', 'readability']) {
    const rejected = { ...good, analysis: { ...good.analysis, visualScore: 5, content: { ...goodContent, [dimension]: 0 }, events: [{ ...event, startSeconds: 1, endSeconds: 8, outcome: 'Unverifiable result' }] } };
    const result = await analyzeFootage(capture, googleFixture([coarse, good, rejected]));
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.startSeconds, 19);
    assert.equal(result.visualScore, good.analysis.visualScore, 'rejected windows must not inflate the score');
    assert.deepEqual(result.content, goodContent);
    const onlyRejected = await analyzeFootage(capture, googleFixture([{ ...coarse, events: coarse.events.slice(1) }, rejected]));
    assert.equal(onlyRejected.usable, false);
    assert.deepEqual(onlyRejected.events, []);
  }
});

test('granular setup events cannot evict their own failure payoff from the global event budget', async () => {
  const longCapture = { ...capture, durationSeconds: 140 };
  const event = capture.analysis!.events[0]!;
  const coarse = { ...capture.analysis!, events: [128, 86].map(start => ({ ...event, startSeconds: start, endSeconds: start + 8 })) };
  const completion = { timebase: 'window_relative', analysis: { ...capture.analysis!, playableStartSeconds: 0, playableEndSeconds: 10, events: [1, 3, 5, 7].map((start, index) => ({ ...event, startSeconds: start, endSeconds: start + 0.5, outcome: index === 3 ? 'Board complete' : `Correct placement ${index + 1}` })) } };
  const failure = { ...completion, analysis: { ...completion.analysis, events: completion.analysis.events.map((event, index) => ({ ...event, outcome: index === 3 ? 'Wrong drop; red X and lost combo' : event.outcome })) } };
  const result = await analyzeFootage(longCapture, googleFixture([coarse, completion, failure]));
  assert.equal(result.events.length, 2, 'each overlapping sequence is one episode before applying the six-event limit');
  assert.match(result.events[0]!.outcome, /Correct placement 1[\s\S]*Wrong drop; red X and lost combo/);
  assert.match(result.events[0]!.evidence, /Impact: 92–92.5s/);
  assert.deepEqual([result.events[0]!.startSeconds, result.events[0]!.endSeconds], [85, 94.5]);
  assert.match(result.events[1]!.outcome, /Board complete/);
  const separated = { ...failure, analysis: { ...failure.analysis, events: [{ ...event, startSeconds: 1, endSeconds: 2 }, { ...event, startSeconds: 7, endSeconds: 8 }] } };
  const gaps = await analyzeFootage(longCapture, googleFixture([{ ...coarse, events: coarse.events.slice(1) }, separated]));
  assert.deepEqual(gaps.events.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })), [{ startSeconds: 85, endSeconds: 89 }, { startSeconds: 90, endSeconds: 95 }], 'merging must never fill an unverified gap');
});

test('long analysis keeps a late high-priority payoff when earlier windows produce many events', async () => {
  const event = capture.analysis!.events[0]!;
  const coarse = { ...capture.analysis!, events: [60, 0, 20].map(start => ({ ...event, startSeconds: start, endSeconds: start + 10 })) };
  const payoff = { ...event, startSeconds: 7, endSeconds: 10, event: 'Board completed', evidence: 'All items are sorted and the completion panel appears', outcome: 'The board is complete.' };
  const densePayoff = { timebase: 'window_relative', analysis: { ...capture.analysis!, playableStartSeconds: 0, playableEndSeconds: 12, events: [payoff] } };
  const denseEarly = { timebase: 'window_relative', analysis: { ...capture.analysis!, playableStartSeconds: 0, playableEndSeconds: 11, events: [1, 3, 5, 7].map(start => ({ ...event, startSeconds: start, endSeconds: start + 1 })) } };
  const result = await analyzeFootage(capture, googleFixture([coarse, densePayoff, denseEarly, denseEarly]));
  assert.deepEqual(result.events.map(event => event.startSeconds), [0, 19, 64], 'retain coherent episodes in priority order, then present them chronologically');
  assert.equal(result.events.at(-1)!.outcome, payoff.outcome, 'early actions must not evict the verified completion');
  assert.equal(result.events.at(-1)!.endSeconds, 71, 'the late payoff keeps its observed reading time');
});

const review = { approved: true, reason: 'The visible jump supports the question; sky is unobstructed.', hook: 'would you make that jump?', caption: 'Pick your landing before the jump.', position: 'upper' };
const choiceFor = (eventIndexes: number[]) => ({ eventIndexes, cuts: null, alternatives: [
  { angle: 'prediction', hook: review.hook, caption: review.caption, evidence: 'A visible jump and landing.', tradeoff: 'Simple decision.' },
  { angle: 'escalation', hook: 'that landing is getting smaller', caption: 'The platforms leave little room.', evidence: 'Small platform is visible.', tradeoff: 'Needs scale to read.' },
  { angle: 'novelty', hook: 'this gap has trust issues', caption: 'A suspiciously narrow landing.', evidence: 'Gap and narrow landing.', tradeoff: 'Less direct participation.' },
], selectedIndex: 0, position: 'upper', rationale: 'The viewer can choose before the jump.', durationReason: 'A complete decision and readable landing without padding.' });

const script = { hook: 'Watch the landing', narration: 'The tiny explorer found a way home.', caption: 'A short story.', cuts: [{ startSeconds: 0, endSeconds: 25 }], rationale: 'Visible jumps', claims: [] };

test('short analysis retains the observed settled result instead of discarding needed payoff time', async () => {
  const outfitCapture = { ...capture, durationSeconds: 30 };
  const response = { ...capture.analysis!, playableStartSeconds: 22.28, playableEndSeconds: 25.53, events: [
    { startSeconds: 22.514, endSeconds: 22.88, event: 'Leggings appear', evidence: 'Black leggings replace the bare legs.', outcome: 'The outfit gains black leggings.' },
    { startSeconds: 23.514, endSeconds: 23.88, event: 'A straw hat appears', evidence: 'The selected hat appears over the hair and remains visible.', outcome: 'The hat and leggings are visible together.' },
  ] };
  const analysis = await analyzeFootage(outfitCapture, googleFixture([response]));
  assert.equal(analysis.events.length, 1, 'overlapping phases of the same short transformation stay one coherent episode');
  assert.deepEqual([analysis.events[0]!.startSeconds, analysis.events[0]!.endSeconds], [22.28, 25.53]);
  assert.match(analysis.events[0]!.outcome, /leggings[\s\S]*hat and leggings/);
  const result = await draftScript({ capture: { ...outfitCapture, analysis }, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), review]));
  assert.deepEqual(result.cuts, [{ startSeconds: 22.28, endSeconds: 25.53 }], 'all 3.25 verified seconds are available to the editor');
  assert.equal(result.overlays![0]!.endSeconds, 2);
  const previouslyTruncated = { ...analysis, events: [{ ...analysis.events[0]!, endSeconds: 24.88 }] };
  await assert.rejects(draftScript({ capture: { ...outfitCapture, analysis: previouslyTruncated }, format: 'highlight', topic: '' }, googleFixture([choiceFor([0])])), /too short to read/, '2.6 seconds fails before any visual-review call, without inventing missing context');
  const atLimit = await analyzeFootage(outfitCapture, googleFixture([{ ...response, playableEndSeconds: 29, events: [response.events[1]!] }]));
  assert.equal(atLimit.events[0]!.endSeconds, 25.88, 'a longer playable span never authorizes more than two seconds of post-impact context');
  const noExtraContext = await analyzeFootage(outfitCapture, googleFixture([{ ...response, playableEndSeconds: 24.88 }]));
  assert.equal(noExtraContext.events[0]!.endSeconds, 24.88, 'source duration does not authorize frames outside the verified playable span');
});

test('a selected hook must fit before visual review and rewritten copy is checked again', async () => {
  const shortCapture = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 3.2 }] } };
  const longHook = "i cannot let this be the thing i'm bad at";
  const choice = choiceFor([0]);
  choice.alternatives[0]!.hook = longHook;
  await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([choice])), /too short to read/, 'an impossible chosen hook must not spend another inference call');
  await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), { ...review, hook: longHook }])), /too short to read/, 'the critic cannot introduce a longer hook that consumes the payoff');
  const exact = { ...shortCapture, analysis: { ...shortCapture.analysis, events: [{ ...shortCapture.analysis.events[0]!, startSeconds: 10, endSeconds: 12.8 }] } };
  assert.ok(await draftScript({ capture: exact, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), review])), 'exact reading-time budgets tolerate timestamp subtraction rounding');
});

test('a highlight preserves the whole context of a single selected event', async () => {
  const shortCapture = { ...capture, durationSeconds: 12.948, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, startSeconds: 2, endSeconds: 6.6 }] } };
  const choice = choiceFor([0]);
  const result = await draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([choice, review]));
  assert.deepEqual(result.cuts, [{ startSeconds: 2, endSeconds: 6.6 }]);
  assert.equal(result.narration, '');
  assert.equal(result.caption, `${review.caption}\n${shortCapture.game.title} · Astrocade\nPlay: ${shortCapture.game.url}`);
  assert.equal(result.editorial?.alternatives.length, 3);
  assert.equal(result.overlays?.[0]?.text, review.hook);
  assert.ok(result.overlays![0]!.endSeconds < 4.6, 'the payoff is free of the opening text');
  await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, eventIndexes: [1] }])), /unknown observed event/);
  await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, eventIndexes: [0, 0] }])), /duplicate observed events/);
  for (const eventIndexes of [[], [0, 1, 2, 3], [-1], [0.5]]) {
    await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, eventIndexes }])));
  }
  const trimmed = await draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, cuts: [{ startSeconds: 2.2, endSeconds: 6.4 }] }, review]));
  assert.deepEqual(trimmed.cuts, [{ startSeconds: 2.2, endSeconds: 6.6 }], 'restore the verified payoff context while allowing setup trims');
  for (const cuts of [[{ startSeconds: 1, endSeconds: 6.6 }], [{ startSeconds: 2, endSeconds: 5 }, { startSeconds: 4, endSeconds: 6 }]]) {
    await assert.rejects(draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, cuts }])), /outside the verified action|overlap/);
  }
});

test('a highlight joins overlapping transformation phases once and preserves reviewed copy', async () => {
  const phases = [
    { startSeconds: 11, endSeconds: 14, event: 'Earned result panel', evidence: 'A three-star panel appears after the customer leaves', outcome: 'The result panel shows three stars.' },
    { startSeconds: 1, endSeconds: 5, event: 'Dirty before-state and first wash', evidence: 'Dirt covers the car before soap spreads', outcome: 'Soap spreads across the dirty car.' },
    { startSeconds: 4, endSeconds: 12, event: 'Cleaning changes the car', evidence: 'Visible dirt vanishes and the customer leaves', outcome: 'The car becomes clean and the customer leaves.' },
  ];
  const transformationCapture = { ...capture, analysis: { ...capture.analysis!, events: phases } };
  const original = structuredClone(transformationCapture);
  const result = await draftScript({ capture: transformationCapture, format: 'highlight', topic: '' }, googleFixture([
    choiceFor([0, 2, 1]), review,
  ]));
  assert.deepEqual(result.cuts, [{ startSeconds: 1, endSeconds: 14 }], 'overlapping verified phases never repeat source frames');
  assert.equal(result.caption, `${review.caption}\n${capture.game.title} · Astrocade\nPlay: ${capture.game.url}`);
  assert.deepEqual(transformationCapture, original, 'selection must not reorder or merge the saved observations');
});

test('a presenter duration ceiling accepts an exact fit and rejects longer edits before visual review', async () => {
  const boundedCapture = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, startSeconds: 2, endSeconds: 7 }] } };
  const input = { capture: boundedCapture, format: 'highlight' as const, topic: '', presenter: true, maxDurationSeconds: 5 };
  const fiveSeconds = { ...choiceFor([0]), cuts: [{ startSeconds: 2, endSeconds: 7 }] };
  const result = await draftScript(input, googleFixture([fiveSeconds, review]));
  assert.deepEqual(result.cuts, fiveSeconds.cuts);
  // The fixture has no review response; an oversized edit must stop before that call.
  const longerPayoff = { ...boundedCapture, analysis: { ...boundedCapture.analysis, events: [{ ...boundedCapture.analysis.events[0]!, endSeconds: 7.01 }] } };
  await assert.rejects(draftScript({ ...input, capture: longerPayoff }, googleFixture([fiveSeconds])), /5-second edit target/, 'restoring verified payoff context must not bypass the presenter ceiling');
  for (const maxDurationSeconds of [0, -1, NaN, Infinity]) {
    await assert.rejects(draftScript({ ...input, maxDurationSeconds }, googleFixture([])), /positive finite/);
  }
  const tooLong = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 41 }] } };
  await assert.rejects(draftScript({ ...input, capture: tooLong, maxDurationSeconds: 50 }, googleFixture([choiceFor([0])])), /40-second edit target/);
});

test('a highlight orders separate verified phases without filling gaps or exceeding 40 seconds', async () => {
  const event = capture.analysis!.events[0]!;
  const choice = choiceFor([1, 0]);
  const separated = { ...capture, analysis: { ...capture.analysis!, events: [
    { ...event, startSeconds: 1, endSeconds: 10 }, { ...event, startSeconds: 20, endSeconds: 25 },
  ] } };
  const result = await draftScript({ capture: separated, format: 'highlight', topic: '' }, googleFixture([choice, review]));
  assert.deepEqual(result.cuts, [{ startSeconds: 1, endSeconds: 10 }, { startSeconds: 20, endSeconds: 25 }]);
  await assert.rejects(draftScript({ capture: separated, format: 'highlight', topic: '' }, googleFixture([{ ...choice, cuts: [{ startSeconds: 1, endSeconds: 9 }] }])), /omits the last selected episode/, 'restoring a payoff must never bridge a gap in verified footage');
  const overlap = { ...capture, analysis: { ...capture.analysis!, events: [
    { ...event, startSeconds: 0, endSeconds: 30 }, { ...event, startSeconds: 20, endSeconds: 40 },
  ] } };
  const forty = await draftScript({ capture: overlap, format: 'highlight', topic: '' }, googleFixture([choice, review]));
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


test('visual review can correct a hook and placement but cannot approve unsupported footage', async () => {
  const corrected = { ...review, hook: 'which platform would you pick?', position: 'lower', reason: 'Upper overlay would cover the target; lower scenery is clear.' };
  const result = await draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), corrected]));
  assert.equal(result.hook, corrected.hook);
  assert.equal(result.overlays![0]!.position, 'lower');
  assert.equal(result.editorial!.review, corrected.reason);
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), { ...review, approved: false, reason: 'No visible landing supports this promise.' }])), /visual editorial review rejected.*No visible landing/);
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), { ...review, caption: 'Visit https:\/\/unrelated.example' }])), /external link/);
  const tiny = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 2 }] } };
  await assert.rejects(draftScript({ capture: tiny, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), review])), /too short to read/);
});

test('conversational hooks retain their wording with measured reading time and an unobscured payoff', async () => {
  for (const hook of [
    "i cannot let this be the thing i'm bad at",
    'this tiny little platform is the hill i will die on',
  ]) {
    const choice = choiceFor([0]);
    choice.alternatives[0]!.hook = hook;
    const result = await draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([choice, { ...review, hook }]));
    assert.equal(result.hook, hook, 'longer conversational wording must not be truncated to eight words');
    assert.equal(result.editorial!.alternatives[0]!.hook, hook, 'saved concepts use the same readable text budget as the reviewed hook');
    assert.equal(result.overlays![0]!.endSeconds, hook.split(/\s+/).length / 3);
    const tooShort = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 4 }] } };
    await assert.rejects(draftScript({ capture: tooShort, format: 'highlight', topic: '' }, googleFixture([choice, { ...review, hook }])), /too short to read/, 'longer copy cannot consume the payoff or cause duration padding');
  }
  const overBudget = 'one two three four five six seven eight nine ten eleven twelve thirteen';
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), { ...review, hook: overBudget }])), /hook is too long/);
  const tooManyLines = 'the fact that someone actually sat down and made this playable';
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), { ...review, hook: tooManyLines }])), /three short lines/, 'word and character ceilings never override the actual renderer width budget');
});

test('visual review receives the writing brief and alternative premises before choosing final copy', async () => {
  const choice = choiceFor([0]);
  const brief = { ...defaultContentBrief, voice: 'Dry group-chat reactions to suspiciously small platforms.' };
  const alternate = choice.alternatives[2]!;
  const provider = googleFixture([choice, { ...review, hook: alternate.hook, caption: alternate.caption, reason: 'The gap is already crossed too soon for a choice; its comic personification is supported.' }]);
  const json = provider.json.bind(provider);
  const prompts: string[] = [];
  provider.json = async (prompt, ...args) => { prompts.push(prompt); return json(prompt, ...args); };
  const result = await draftScript({ capture, format: 'highlight', topic: '', brief }, provider);
  assert.ok(prompts[1]!.includes(brief.voice), 'the visual critic needs the same requested voice as the writer');
  assert.ok(prompts[1]!.includes(JSON.stringify(alternate)), 'a rejected premise can be replaced by a previously considered, evidence-backed alternative');
  assert.equal(result.hook, alternate.hook);
  assert.equal(result.editorial!.selectedIndex, choice.selectedIndex, 'initial selection remains traceable even when visual review changes the hook');
  assert.match(result.editorial!.review, /comic personification/);
});

test('visual review maps caption anchors through the game crop instead of the browser viewport', async () => {
  const cropped = { ...capture, width: 720, height: 1280, crop: { x: 29, y: 0, width: 661, height: 1176 } };
  const provider = googleFixture([choiceFor([0]), review]);
  const json = provider.json.bind(provider);
  const prompts: string[] = [];
  provider.json = async (prompt, ...args) => { prompts.push(prompt); return json(prompt, ...args); };
  await draftScript({ capture: cropped, format: 'highlight', topic: '' }, provider);
  assert.match(prompts[1]!, /"lowerBottomSourceY":940\.8/);
  assert.match(prompts[1]!, /not 12\.5%\/80% of the entire uncropped viewport/);
  const duplicate = choiceFor([0]); duplicate.alternatives[2] = duplicate.alternatives[0]!;
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([duplicate])), /three distinct concepts/);
});
