import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeFootage, draftScript, mapWindowEvents, storyMode, transcriptWarnings, validateCuts } from './editorial.js';
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
  const repaired = await draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([
    choiceFor([0]), { ...review, hook: longHook }, { hook: 'i cannot be bad at this', reason: 'Removed the longer framing while keeping the reaction and negation.' },
  ]));
  assert.equal(repaired.hook, 'i cannot be bad at this');
  assert.equal(repaired.overlays![0]!.endSeconds, 2);
  assert.ok(repaired.overlays![0]!.endSeconds <= 3.2 - 0.8, 'shortening leaves the required payoff without extending cuts');
  assert.match(repaired.editorial!.review, /Local caption repair.*too short to read/);
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
  const trimmed = await draftScript({ capture: shortCapture, format: 'highlight', topic: '' }, googleFixture([{ ...choice, cuts: [{ startSeconds: 2.2, endSeconds: 6.4 }] }, {
    ...review, tail: { settledAtSeconds: 5.4, essentialText: '', redundant: true, evidence: 'The landing has settled; the omitted 0.2 seconds show only the same resting position.' },
  }]));
  assert.deepEqual(trimmed.cuts, [{ startSeconds: 2.2, endSeconds: 6.4 }], 'a visually verified redundant tail can be removed without padding');
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
    choiceFor([0]), review,
  ]));
  assert.deepEqual(result.cuts, [{ startSeconds: 1, endSeconds: 14 }], 'overlapping verified phases never repeat source frames');
  assert.equal(result.caption, `${review.caption}\n${capture.game.title} · Astrocade\nPlay: ${capture.game.url}`);
  assert.deepEqual(transformationCapture, original, 'selection must not reorder or merge the saved observations');
});

test('saved overlapping dense reviews expose one complete selection and settled result to the editor', async () => {
  // Observed bounds and evidence from World Cup39: the earlier dense window
  // ends just after the card moves; the overlapping review contains the hold.
  const recorded = { ...capture, game: { ...capture.game, title: 'World Cup Squad' }, analysis: { ...capture.analysis!, events: [
    { startSeconds: 45.019999999999996, endSeconds: 49.884, event: 'Compare four Germany 1975 candidates, then select Müller for the squad.', evidence: 'The settled market displays Müller 90 ST, Leno 85 GK, Tah 86 CB and Ter Stegen 91 GK. Müller enlarges and moves toward the pitch.', outcome: 'Müller is visibly added at striker.' },
    { startSeconds: 48.001, endSeconds: 51.553, event: 'Müller is selected from the four-player transfer market and placed into the center striker slot.', evidence: 'Müller moves over the formation and settles in the ST slot beside Messi. OVR settles from 93 to 92.', outcome: 'The settled squad shows Müller beside Messi; the squad remains incomplete.' },
  ] } };
  const original = structuredClone(recorded);
  const provider = googleFixture([choiceFor([0]), review]);
  const json = provider.json.bind(provider);
  let calls = 0;
  provider.json = async (prompt, schema, media, signal) => {
    if (++calls === 1) {
      const events = JSON.parse(prompt.match(/Observed moments \(zero-based indexes\): (.*)\n/)![1]!);
      assert.equal(events.length, 1, 'overlapping observations describe one selectable episode');
      assert.equal(events[0].eventIndex, 0);
      assert.equal(events[0].startSeconds, 45.019999999999996);
      assert.equal(events[0].endSeconds, 51.553);
      assert.match(events[0].evidence, /settled market[\s\S]*settles in the ST slot beside Messi/);
      assert.match(events[0].outcome, /added at striker[\s\S]*squad remains incomplete/);
    } else {
      assert.deepEqual(media!.map(item => item.type === 'video' ? item.processing : null), [
        { type: 'static', fps: 2, start_offset: '45.019999999999996s', end_offset: '51.553s' },
      ], 'visual review sees the complete verified episode rather than the early window alone');
    }
    return json(prompt, schema, media, signal);
  };
  const result = await draftScript({ capture: recorded, format: 'highlight', topic: '' }, provider);
  assert.deepEqual(result.cuts, [{ startSeconds: 45.019999999999996, endSeconds: 51.553 }]);
  assert.equal(calls, 2, 'saved observations need no new analysis or provider call');
  assert.deepEqual(recorded, original, 'normalization must not rewrite saved source evidence');
  await assert.rejects(draftScript({ capture: recorded, format: 'highlight', topic: '' }, googleFixture([
    { ...choiceFor([0]), cuts: [{ startSeconds: 45.019999999999996, endSeconds: 49.884 }] },
    { ...review, tail: { settledAtSeconds: 49.53, essentialText: '', redundant: true, evidence: 'The omitted frames hold the settled squad.' } },
  ])), /payoff reading time/, 'explicitly choosing the old early endpoint must still pass the complete episode tail guard');
});

test('a shortened ending audits the whole omitted tail and retains readable earned results', async () => {
  const recorded = { ...capture, durationSeconds: 34.6, analysis: { ...capture.analysis!, events: [{
    startSeconds: 24.6, endSeconds: 34.6, event: 'Polish then earned result', evidence: 'Polishing makes the car glow; three stars and 245 coins then remain on screen.', outcome: 'Three stars and 245 coins.',
  }] } };
  const choice = { ...choiceFor([0]), cuts: [{ startSeconds: 24.6, endSeconds: 29.8 }] };
  const verdict = { ...review, tail: { settledAtSeconds: 27.8, essentialText: 'Three stars 245 coins', redundant: true, evidence: 'The entire omitted tail holds the same reward panel, with no further consequence.' } };
  const provider = googleFixture([choice, verdict]);
  const json = provider.json.bind(provider);
  let calls = 0;
  provider.json = async (prompt, schema, media, signal) => {
    if (++calls === 2) {
      assert.match(prompt, /OMITTED footage[\s\S]*NOT appear in the rendered short/);
      assert.match(prompt, /Never credit its action or reading time to the edit/);
      assert.deepEqual(media!.map(item => item.type === 'video' ? item.processing : null), [
        { type: 'static', fps: 2, start_offset: '24.6s', end_offset: '29.8s' },
        { type: 'static', fps: 2, start_offset: '29.8s', end_offset: '34.6s' },
      ], 'the extra audit covers all omitted footage but does not replace the shown cuts');
      assert.equal(schema.safeParse(review).success, false, 'trimmed endings require a separate evidence verdict');
    }
    return json(prompt, schema, media, signal);
  };
  const result = await draftScript({ capture: recorded, format: 'highlight', topic: '', maxDurationSeconds: 5.3 }, provider);
  assert.deepEqual(result.cuts, choice.cuts);
  assert.equal(calls, 2, 'tail verification shares the existing visual review, with no extra call or retry');
  assert.match(result.editorial!.review, /Tail trim: result settled at source 27\.8s; 1\.33s minimum reading time/);
  assert.equal(recorded.analysis.events[0]!.endSeconds, 34.6, 'available source evidence remains unchanged');
});

test('tail trimming cannot omit a consequence or borrow reading time from unseen footage', async () => {
  const recorded = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, startSeconds: 10, endSeconds: 20 }] } };
  const choice = { ...choiceFor([0]), cuts: [{ startSeconds: 10, endSeconds: 15 }] };
  const tail = { settledAtSeconds: 13, essentialText: '', redundant: true, evidence: 'A synthetic visible result.' };
  for (const invalid of [
    { ...tail, settledAtSeconds: null }, { ...tail, settledAtSeconds: 9.9 }, { ...tail, settledAtSeconds: 15 },
    { ...tail, settledAtSeconds: 18 }, { ...tail, settledAtSeconds: 14.5 }, { ...tail, redundant: false },
    { ...tail, essentialText: 'one two three four five six seven eight nine ten eleven twelve' },
  ]) await assert.rejects(draftScript({ capture: recorded, format: 'highlight', topic: '' }, googleFixture([choice, { ...review, tail: invalid }])), /shortened ending/);
  await assert.rejects(draftScript({ capture: recorded, format: 'highlight', topic: '' }, googleFixture([choice, review])), /tail/, 'a missing tail verdict cannot silently restore or approve the cut');
});

test('the combined shown and omitted review stays within 360 requested samples', async () => {
  const recorded = { ...capture, durationSeconds: 200, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, endSeconds: 180 }] } };
  const choice = { ...choiceFor([0]), cuts: [{ startSeconds: 0, endSeconds: 5 }] };
  const verdict = { ...review, tail: { settledAtSeconds: 3, essentialText: '', redundant: true, evidence: 'The long omitted tail has no further events.' } };
  assert.deepEqual((await draftScript({ capture: recorded, format: 'highlight', topic: '' }, googleFixture([choice, verdict]))).cuts, choice.cuts);
  const oversized = { ...recorded, analysis: { ...recorded.analysis, events: [{ ...recorded.analysis.events[0]!, endSeconds: 180.01 }] } };
  await assert.rejects(draftScript({ capture: oversized, format: 'highlight', topic: '' }, googleFixture([choice])), /360-frame review budget/, 'reject before making a partial or oversized visual review');
});

test('a presenter duration ceiling accepts an exact fit and rejects longer edits before visual review', async () => {
  const boundedCapture = { ...capture, analysis: { ...capture.analysis!, events: [{ ...capture.analysis!.events[0]!, startSeconds: 2, endSeconds: 7 }] } };
  const input = { capture: boundedCapture, format: 'highlight' as const, topic: '', presenter: true, maxDurationSeconds: 5 };
  const fiveSeconds = { ...choiceFor([0]), cuts: [{ startSeconds: 2, endSeconds: 7 }] };
  const result = await draftScript(input, googleFixture([fiveSeconds, review]));
  assert.deepEqual(result.cuts, fiveSeconds.cuts);
  // The fixture has no review response; an oversized edit must stop before that call.
  const longerPayoff = { ...boundedCapture, analysis: { ...boundedCapture.analysis, events: [{ ...boundedCapture.analysis.events[0]!, endSeconds: 7.01 }] } };
  await assert.rejects(draftScript({ ...input, capture: longerPayoff }, googleFixture([{ ...fiveSeconds, cuts: [{ startSeconds: 2, endSeconds: 7.01 }] }])), /5-second edit target/, 'a longer selected payoff must not bypass the presenter ceiling');
  await assert.rejects(draftScript({ ...input, capture: longerPayoff }, googleFixture([fiveSeconds, {
    ...review, tail: { settledAtSeconds: 6.5, essentialText: '', redundant: true, evidence: 'The landing settles half a second before the proposed ending.' },
  }])), /payoff reading time/, 'fitting the presenter cannot justify cutting off required result time');
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
  const original = structuredClone(separated);
  const provider = googleFixture([choice, review]);
  const json = provider.json.bind(provider);
  provider.json = async (prompt, schema, media, signal) => {
    const observed = prompt.match(/Observed moments \(zero-based indexes\): (.*)\n/);
    if (observed) assert.deepEqual(JSON.parse(observed[1]!).map(({ eventIndex, startSeconds, endSeconds }: { eventIndex: number; startSeconds: number; endSeconds: number }) => ({ eventIndex, startSeconds, endSeconds })), [
      { eventIndex: 0, startSeconds: 1, endSeconds: 10 }, { eventIndex: 1, startSeconds: 20, endSeconds: 25 },
    ], 'unverified gaps remain separate indexed episodes');
    return json(prompt, schema, media, signal);
  };
  const result = await draftScript({ capture: separated, format: 'highlight', topic: '' }, provider);
  assert.deepEqual(result.cuts, [{ startSeconds: 1, endSeconds: 10 }, { startSeconds: 20, endSeconds: 25 }]);
  assert.deepEqual(separated, original);
  await assert.rejects(draftScript({ capture: separated, format: 'highlight', topic: '' }, googleFixture([{ ...choice, cuts: [{ startSeconds: 1, endSeconds: 9 }] }])), /omits the last selected episode/, 'restoring a payoff must never bridge a gap in verified footage');
  const overlap = { ...capture, analysis: { ...capture.analysis!, events: [
    { ...event, startSeconds: 0, endSeconds: 30 }, { ...event, startSeconds: 20, endSeconds: 40 },
  ] } };
  const forty = await draftScript({ capture: overlap, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), review]));
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

test('factual stories require actual source evidence', async () => {
  await assert.rejects(draftScript({ capture, format: 'story', topic: 'A factual story about a real event' }, googleFixture([])), /research snapshot/);
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
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([
    choiceFor([0]), { ...review, hook: overBudget }, { hook: 'a b c d e f g h i j k l m', reason: 'Still thirteen words.' },
  ])), /one hook-shortening repair.*hook is too long/);
});

test('one repair fits a visually approved hook to the renderer without changing its cut or anchor', async () => {
  const hook = 'the fact that someone actually sat down and made this playable';
  const approved = { ...review, hook, position: 'lower', reason: 'The playable absurdity is visible and lower scenery is clear.' };
  const repair = { hook: 'someone made this playable', reason: 'Removed filler while preserving the reaction to its existence.' };
  const result = await draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([choiceFor([0]), approved, repair]));
  assert.equal(result.hook, repair.hook);
  assert.deepEqual(result.cuts, [{ startSeconds: 0, endSeconds: 30 }]);
  assert.deepEqual(result.overlays, [{ startSeconds: 0, endSeconds: 2, text: repair.hook, position: 'lower' }]);
  assert.ok(result.caption.startsWith(`${approved.caption}\n`), 'copy repair cannot change the approved post caption');
  assert.ok(result.editorial!.review.startsWith(approved.reason));
  assert.ok(result.editorial!.review.includes(JSON.stringify(hook)));
  assert.ok(result.editorial!.review.includes(JSON.stringify(repair.hook)));
  assert.match(result.editorial!.review, /three short lines/);
  assert.match(result.editorial!.review, /Current layout: \d+ lines.*wrapped lines/);
  assert.ok(result.editorial!.review.endsWith(repair.reason));
});

test('an invalid shortening ends after one repair and cannot override visual rejection', async () => {
  const hook = 'the fact that someone actually sat down and made this playable';
  const stillWide = 'the fact that someone actually sat down and made it playable';
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([
    choiceFor([0]), { ...review, hook }, { hook: stillWide, reason: 'Removed one short word, but still too wide.' },
  ])), /<=46 characters/, 'the stricter repair budget rejects a token shortening without another model call');
  await assert.rejects(draftScript({ capture, format: 'highlight', topic: '' }, googleFixture([
    choiceFor([0]), { ...review, hook, approved: false, reason: 'Both anchors obscure the decisive action.' },
  ])), /visual editorial review rejected.*Both anchors/, 'a wide rejected line must never enter the repair flow');
});

test('visual review receives the writing brief and alternative premises before choosing final copy', async () => {
  const choice = choiceFor([0]);
  const brief = { ...defaultContentBrief, editingStyle: 'episode' as const, voice: 'Dry group-chat reactions to suspiciously small platforms.' };
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

const reelCapture: Capture = { ...capture, analysis: { ...capture.analysis!, events: [
  { startSeconds: 0, endSeconds: 8, event: 'Explore the rooftop', evidence: 'The character leaps across roofs into a new area.', outcome: 'A rooftop route opens.' },
  { startSeconds: 20, endSeconds: 28, event: 'Fire attack', evidence: 'A fire burst hits the nearby target, leaving a visible scorched state.', outcome: 'The target changes visibly.' },
  { startSeconds: 45, endSeconds: 55, event: 'Alien transformation', evidence: 'A small hero changes into a large four-armed form.', outcome: 'The new form moves on screen.' },
] } };
const reelChoice = () => ({
  ...(({ eventIndexes: _indexes, cuts: _cuts, ...choice }) => choice)(choiceFor([0, 1, 2])),
  shots: [
    { eventIndex: 2, startSeconds: 45, endSeconds: 48, purpose: 'opening', role: 'supporting_transition', feature: 'transform', visibleChange: 'The hero transforms into a recognizable large alien.' },
    { eventIndex: 0, startSeconds: 2, endSeconds: 5, purpose: 'contrast', role: 'active_play', feature: 'rooftop traversal', visibleChange: 'A rooftop leap shows the traversal mechanic.' },
    { eventIndex: 1, startSeconds: 23, endSeconds: 27, purpose: 'ending', role: 'active_play', feature: 'aimed fire', visibleChange: 'A fire attack visibly changes the target.' },
  ],
});
const reelReview = {
  ...review, hook: 'why am i sweating', caption: 'this did not need to be playable',
  distinctMoments: 3, varietyEvidence: 'Transformation, rooftop traversal and fire attack show different gameplay activities.',
  shots: [
    { shotIndex: 0, activeSeconds: 0, feature: null, demonstratesFeature: false, navigationObstruction: false, agencyEvidence: 'A clean transformation animation supports the following gameplay.' },
    { shotIndex: 1, activeSeconds: 3, feature: 'rooftop traversal', demonstratesFeature: true, navigationObstruction: false, agencyEvidence: 'The character approaches, jumps the gap and reaches the next roof.' },
    { shotIndex: 2, activeSeconds: 3, feature: 'aimed fire', demonstratesFeature: true, navigationObstruction: false, agencyEvidence: 'The character turns toward the target, fires and visibly scorches it.' },
  ],
  ending: { readableFromSeconds: 25, essentialText: '', evidence: 'The target remains visibly scorched.' },
};
const reelInput = { capture: reelCapture, format: 'highlight' as const, topic: '', brief: { ...defaultContentBrief, editingStyle: 'reel' as const } };

test('a reel keeps deliberate shot order, reviews every exact cut at 4 FPS, and retains shot evidence', async () => {
  const provider = googleFixture([reelChoice(), reelReview]);
  const json = provider.json.bind(provider);
  const sampled: unknown[] = [];
  provider.json = async (prompt, schema, media, ...args) => {
    if (media?.length) {
      sampled.push(...media);
      assert.ok(prompt.includes(JSON.stringify({ title: reelCapture.game.title, titleSource: reelCapture.game.titleSource, url: reelCapture.game.url })), 'the critic receives the original game identity and its provenance, not only copywriter assertions');
    }
    return json(prompt, schema, media, ...args);
  };
  const result = await draftScript(reelInput, provider);
  assert.deepEqual(result.cuts, [{ startSeconds: 45, endSeconds: 48 }, { startSeconds: 2, endSeconds: 5 }, { startSeconds: 23, endSeconds: 27 }]);
  assert.equal(result.cuts.reduce((sum, cut) => sum + cut.endSeconds - cut.startSeconds, 0), 10);
  assert.deepEqual(sampled, result.cuts.map(cut => ({ type: 'video', uri: 'fixture-video', mime_type: 'video/webm', processing: { type: 'static', fps: 4, start_offset: `${cut.startSeconds}s`, end_offset: `${cut.endSeconds}s` } })));
  assert.equal(result.hook, reelReview.hook, 'a subjective gaming reaction remains intact after review');
  assert.match(result.rationale, /Reel shots:.*Alien|Reel shots:.*recognizable large alien/);
  assert.match(result.editorial!.review, /Visual variety \(3 moments\)/);
  assert.ok(!sampled.some(item => JSON.stringify(item).includes('55s')), 'the reel does not inherit the full final event tail or its old episode ordering');
});

test('reels enforce the 15-second cap even when the caller allows 40, and respect a tighter limit', async () => {
  const choice = reelChoice();
  choice.shots = [
    { ...choice.shots[0]!, eventIndex: 0, startSeconds: 0, endSeconds: 5 },
    { ...choice.shots[1]!, eventIndex: 1, startSeconds: 20, endSeconds: 25 },
    { ...choice.shots[2]!, eventIndex: 2, startSeconds: 45, endSeconds: 50.001 },
  ];
  await assert.rejects(draftScript({ ...reelInput, maxDurationSeconds: 40 }, googleFixture([choice])), /reel exceeds the 15-second/);
  choice.shots[2]!.endSeconds = 50;
  const result = await draftScript({ ...reelInput, maxDurationSeconds: 40 }, googleFixture([choice, { ...reelReview, shots: reelReview.shots.map((shot, index) => ({ ...shot, activeSeconds: index === 0 ? 0 : 4 })), ending: { ...reelReview.ending, readableFromSeconds: 49 } }]));
  assert.equal(result.cuts.reduce((sum, cut) => sum + cut.endSeconds - cut.startSeconds, 0), 15);
  await assert.rejects(draftScript({ ...reelInput, maxDurationSeconds: 9 }, googleFixture([reelChoice()])), /reel exceeds the 9-second/);
});

test('a reel rejects fabricated shot counts, adjacent splits, repeated footage and wrong evidence references before visual calls', async () => {
  const choice = reelChoice();
  await assert.rejects(draftScript(reelInput, googleFixture([{ ...choice, shots: choice.shots.slice(0, 1) }])), /Too small|>=2/);
  const oneMoment = { ...choice, shots: [0, 3, 6].map(start => ({ ...choice.shots[0]!, eventIndex: 0, startSeconds: start, endSeconds: start + 2 })) };
  await assert.rejects(draftScript(reelInput, googleFixture([oneMoment])), /splitting one observed event/);
  const duplicatedObservations = { ...reelCapture, analysis: { ...reelCapture.analysis!, events: reelCapture.analysis!.events.map(event => ({ ...event, startSeconds: 0, endSeconds: 12 })) } };
  const adjacent = { ...choice, shots: [0, 1, 2].map(index => ({ ...choice.shots[index]!, eventIndex: index, startSeconds: index * 3, endSeconds: (index + 1) * 3 })) };
  await assert.rejects(draftScript({ ...reelInput, capture: duplicatedObservations }, googleFixture([adjacent])), /adjacent slices/);
  await assert.rejects(draftScript(reelInput, googleFixture([{ ...choice, shots: choice.shots.map((shot, index) => index === 0 ? { ...shot, eventIndex: 1 } : shot) }])), /outside its referenced observed moment/);
  const overlap = { ...choice, shots: [choice.shots[1]!, { ...choice.shots[1]!, startSeconds: 4, endSeconds: 7 }, choice.shots[2]!] };
  await assert.rejects(draftScript(reelInput, googleFixture([overlap])), /overlap/);
  const gap = { ...choice, shots: [{ ...choice.shots[0]!, startSeconds: 30, endSeconds: 33 }, ...choice.shots.slice(1)] };
  await assert.rejects(draftScript(reelInput, googleFixture([gap])), /outside the verified action windows/);
});

test('numeric reel diversity cannot override actual-frame rejection or an unreadable ending', async () => {
  await assert.rejects(draftScript(reelInput, googleFixture([reelChoice(), { ...reelReview, approved: true, distinctMoments: 1, varietyEvidence: 'All three cuts show the same strike against identical targets.' }])), /visual reel review rejected.*same strike/);
  await assert.rejects(draftScript(reelInput, googleFixture([reelChoice(), { ...reelReview, approved: false, reason: 'The opening promises a transformation absent from these cuts.' }])), /visual reel review rejected.*transformation/);
  for (const ending of [
    { ...reelReview.ending, readableFromSeconds: null },
    { ...reelReview.ending, readableFromSeconds: 28 },
    { ...reelReview.ending, readableFromSeconds: 26.5 },
    { ...reelReview.ending, essentialText: 'one two three four five six seven eight nine' },
  ]) await assert.rejects(draftScript(reelInput, googleFixture([reelChoice(), { ...reelReview, ending }])), /readable ending|required ending reading time/);
});

test('two sustained feature demonstrations work without adding a reveal to meet a shot quota', async () => {
  const choice = reelChoice();
  choice.shots = [
    { ...choice.shots[1]!, startSeconds: 0, endSeconds: 6 },
    { ...choice.shots[2]!, startSeconds: 20, endSeconds: 27 },
  ];
  const result = await draftScript(reelInput, googleFixture([choice, { ...reelReview, distinctMoments: 2,
    shots: reelReview.shots.slice(1).map((shot, index) => ({ ...shot, shotIndex: index, activeSeconds: 5 })),
  }]));
  assert.equal(result.cuts.length, 2);
  assert.equal(result.cuts.reduce((sum, cut) => sum + cut.endSeconds - cut.startSeconds, 0), 13);
  assert.match(result.rationale, /"role":"active_play"/);
  assert.match(result.editorial!.review, /Active gameplay 10.00s\/13.00s/);
});

test('actual-frame agency rejects menus, reveal-only variety and a single repeated feature despite approval', async () => {
  const attempt = (shots: typeof reelReview.shots) => draftScript(reelInput, googleFixture([reelChoice(), { ...reelReview, shots }]));
  await assert.rejects(attempt(reelReview.shots.map((shot, index) => ({ ...shot, navigationObstruction: index === 0 }))), /navigation menu or engagement/);
  await assert.rejects(attempt(reelReview.shots.map(shot => ({ ...shot, activeSeconds: 0, demonstratesFeature: false }))), /majority of active gameplay/);
  await assert.rejects(attempt(reelReview.shots.map(shot => ({ ...shot, feature: 'same ability' }))), /two visibly demonstrated/);
  await assert.rejects(attempt(reelReview.shots.map(shot => ({ ...shot, activeSeconds: shot.activeSeconds ? 2.5 : 0 }))), /majority of active gameplay/, 'exactly half the reel is not a majority');
  await assert.rejects(attempt(reelReview.shots.map(shot => ({ ...shot, demonstratesFeature: false }))), /two visibly demonstrated/, 'active motion alone does not prove two understandable features');
});

test('a reel agency review must cover each real cut once with possible active durations', async () => {
  const attempt = (shots: typeof reelReview.shots) => draftScript(reelInput, googleFixture([reelChoice(), { ...reelReview, shots }]));
  await assert.rejects(attempt(reelReview.shots.slice(1)), /every exact shot once/);
  await assert.rejects(attempt(reelReview.shots.map(shot => ({ ...shot, shotIndex: 0 }))), /every exact shot once/);
  await assert.rejects(attempt(reelReview.shots.map((shot, index) => ({ ...shot, shotIndex: index + 1 }))), /every exact shot once/);
  await assert.rejects(attempt(reelReview.shots.map((shot, index) => ({ ...shot, activeSeconds: index === 1 ? 3.1 : shot.activeSeconds }))), /invalid gameplay agency/);
  await assert.rejects(attempt(reelReview.shots.map(shot => ({ ...shot, feature: null }))), /invalid gameplay agency/);
});

const moment = (startSeconds: number, endSeconds: number, feature: string, priority = 3, kind: 'gameplay' | 'transition' = 'gameplay') => ({
  ...capture.analysis!.events[0]!, startSeconds, endSeconds, event: feature, feature, priority, kind,
});
const windowAnalysis = (events: ReturnType<typeof moment>[]) => ({ timebase: 'window_relative', analysis: { ...capture.analysis!, events } });

test('balanced coarse passes cover a 600.03-second source and prioritize sustained distinct mechanics within 432 dense frames', async () => {
  const sampled: number[] = [];
  const first = windowAnalysis([moment(30, 38, 'flight', 2), moment(60, 64, 'form reveal', 3, 'transition'), moment(120, 128, 'flight')]);
  const second = windowAnalysis([moment(20, 28, 'aimed projectile'), moment(290, 298, 'puzzle manipulation')]);
  const provider = googleFixture([first, second, ...['flight', 'aimed projectile', 'puzzle manipulation', 'flight'].map(feature => windowAnalysis([moment(1, 12, feature)]))], sampled);
  const json = provider.json.bind(provider);
  const windows: Array<{ fps: number; start_offset: string; end_offset: string }> = [];
  provider.json = async (prompt, schema, media, ...args) => {
    windows.push(...(media ?? []).flatMap(item => item.type === 'video' && item.processing?.type === 'static' ? [item.processing as typeof windows[number]] : []));
    return json(prompt, schema, media, ...args);
  };
  const result = await analyzeFootage({ ...capture, durationSeconds: 600.03 }, provider, undefined, reelInput.brief);
  assert.deepEqual(sampled, [1, 1, 8, 8, 8, 8]);
  assert.deepEqual(windows.slice(0, 2), [
    { type: 'static', fps: 1, start_offset: '0s', end_offset: '300.015s' },
    { type: 'static', fps: 1, start_offset: '300.015s', end_offset: '600.03s' },
  ]);
  const dense = windows.slice(2);
  assert.equal(dense.length, 4);
  const frameBudget = dense.reduce((sum, window) => sum + (parseFloat(window.end_offset) - parseFloat(window.start_offset)) * 8, 0);
  assert.ok(frameBudget <= 432 + 1e-8);
  assert.equal(result.usable, true);
  assert.deepEqual(result.events.map(event => event.event), ['flight', 'flight', 'aimed projectile', 'puzzle manipulation']);
  assert.ok(result.events.every(event => event.endSeconds - event.startSeconds === 11), 'sustained reviewed sequences survive without automatic clipping into flashes');
  assert.ok(result.events.at(-1)!.startSeconds > 580, 'late activity is selected across chunks');
  assert.ok(result.events.find(event => event.event === 'aimed projectile')!.startSeconds > 300, 'window-relative coarse and dense offsets are each mapped exactly once');
  assert.ok(!result.events.some(event => event.event === 'form reveal'), 'a high-rated transition cannot displace actual play');
});

test('coarse and dense reel timestamps are validated against their own supplied window', async () => {
  const event = moment(5, 12, 'flight');
  const coarse = windowAnalysis([event, moment(30, 38, 'aiming')]);
  await assert.rejects(analyzeFootage({ ...capture, durationSeconds: 600.03 }, googleFixture([windowAnalysis([moment(301, 303, 'flight')])]), undefined, reelInput.brief), /outside its video window/);
  await assert.rejects(analyzeFootage(capture, googleFixture([coarse, windowAnalysis([moment(12, 14, 'flight')])]), undefined, reelInput.brief), /outside its video window/);
  await assert.rejects(analyzeFootage(capture, googleFixture([{ ...coarse, timebase: 'source_absolute' }]), undefined, reelInput.brief), /window_relative/);
});

test('reel analysis excludes unverified moments and one-feature footage without weakening legacy episodes', async () => {
  const event = moment(5, 12, 'flight');
  const coarse = windowAnalysis([event, moment(30, 38, 'aiming')]);
  const dense = windowAnalysis([moment(2, 10, 'flight')]);
  const idle = { ...dense, analysis: { ...dense.analysis, content: { ...content, clarity: 0 }, reason: 'No understandable activity.', events: [] } };
  const result = await analyzeFootage(capture, googleFixture([coarse, dense, idle]), undefined, reelInput.brief);
  assert.equal(result.usable, false);
  assert.equal(result.events.length, 1);
  assert.match(result.reason, /explore more/);
  const repeated = await analyzeFootage(capture, googleFixture([coarse, dense, dense]), undefined, reelInput.brief);
  assert.equal(repeated.usable, false, 'two different timestamps do not establish two mechanics');
  const reveals = await analyzeFootage(capture, googleFixture([coarse, windowAnalysis([moment(2, 10, 'reveal A', 2, 'transition')]), windowAnalysis([moment(2, 10, 'reveal B', 2, 'transition')])]), undefined, reelInput.brief);
  assert.equal(reveals.usable, false, 'two form reveals alone are not gameplay');
  const legacy = { ...defaultContentBrief, editingStyle: undefined };
  const short = { ...capture, durationSeconds: 12 };
  const sampled: number[] = [];
  const one = await analyzeFootage(short, googleFixture([{ ...capture.analysis!, events: [{ ...event, endSeconds: 8 }], playableStartSeconds: 0, playableEndSeconds: 12 }], sampled), undefined, legacy);
  assert.equal(one.usable, true);
  assert.deepEqual(sampled, [8], 'saved briefs without a style keep the episode analysis');
  assert.equal((await draftScript({ capture, format: 'highlight', topic: '', brief: legacy }, googleFixture([choiceFor([0]), review]))).cuts.length, 1);
});

test('nearby distinct gameplay survives a shared dense window with no artificial shot fragmentation', async () => {
  const events = [moment(0, 3, 'jumping'), moment(3, 6, 'aimed fire')];
  const response = windowAnalysis(events);
  const sampled: number[] = [];
  const result = await analyzeFootage({ ...capture, durationSeconds: 6 }, googleFixture([response, response], sampled), undefined, reelInput.brief);
  assert.deepEqual(sampled, [1, 8], 'overlapping proposals share one dense call without losing distinct activities');
  assert.equal(result.usable, true);
  assert.deepEqual(result.events.map(event => event.event), ['jumping', 'aimed fire']);
  assert.deepEqual(result.events.map(event => [event.startSeconds, event.endSeconds]), [[0, 3], [3, 6]]);
});

test('controller hints locate a missed transient but cannot promote it without independent dense confirmation', async () => {
  const hint = { startSeconds: 201.022, endSeconds: 203.786, observation: 'UNIQUE_SEARCH_LEAD: an orange projectile crossed the background; impact was not observed.' };
  const run = async (includeHint: boolean, confirmed: boolean) => {
    const sampled: number[] = [], denseWindows: Array<{ start: number; end: number }> = [];
    const provider = googleFixture([]);
    provider.json = async (prompt, schema, media) => {
      const processing = media?.find(item => item.type === 'video')?.processing;
      assert.ok(processing?.type === 'static');
      sampled.push(processing.fps!);
      if (processing.fps === 1) {
        // The coarse frames themselves only reveal locomotion. A search lead can
        // nominate the transient, but contributes no verified event evidence.
        const candidates = [moment(40, 48, 'locomotion', 2)];
        if (prompt.includes(hint.observation)) candidates.push({ ...moment(201.022, 203.786, 'ranged attack'), evidence: 'Unverified controller lead; effect is absent between coarse frames.' });
        return schema.parse(windowAnalysis(candidates));
      }
      assert.ok(!prompt.includes(hint.observation), 'the dense reviewer receives no controller assertion');
      const start = parseFloat(processing.start_offset!), end = parseFloat(processing.end_offset!);
      denseWindows.push({ start, end });
      if (start > 190) return schema.parse(windowAnalysis(confirmed ? [{ ...moment(5.5, 9, 'ranged attack'), evidence: 'Independent frames show the character aim, cast and launch a visible projectile.' }] : []));
      return schema.parse(windowAnalysis([moment(2, 10, 'locomotion')]));
    };
    const result = await analyzeFootage({ ...capture, durationSeconds: 240 }, provider, undefined, reelInput.brief, includeHint ? [hint] : []);
    return { result, sampled, denseWindows };
  };
  const missed = await run(false, true);
  assert.equal(missed.result.usable, false);
  assert.deepEqual(missed.sampled, [1, 8]);
  const found = await run(true, true);
  assert.equal(found.result.usable, true);
  assert.deepEqual(found.sampled, [1, 8, 8]);
  assert.ok(found.denseWindows[0]!.start <= 201.45 && found.denseWindows[0]!.end >= 202.2, 'the distinct hinted ability gets detailed coverage before repeated movement');
  assert.match(found.result.events.at(-1)!.evidence, /Independent frames show/);
  assert.ok(!JSON.stringify(found.result.events).includes('UNIQUE_SEARCH_LEAD'));
  const rejected = await run(true, false);
  assert.equal(rejected.result.usable, false);
  assert.equal(rejected.result.events.length, 1);
  assert.equal(rejected.result.events[0]!.event, 'locomotion', 'a disproven lead never becomes a final event');
});

test('observation hints are clipped and mapped per intersecting coarse chunk without mutating source hints', async () => {
  const hints = [
    { startSeconds: 295, endSeconds: 305, observation: 'Boundary-spanning ability lead.' },
    { startSeconds: 370, endSeconds: 372, observation: 'Later ability lead.' },
  ];
  const before = structuredClone(hints);
  const supplied: typeof hints[] = [];
  const provider = googleFixture([]);
  provider.json = async (prompt, schema) => {
    const match = prompt.match(/relative to THIS PART's clock: (\[.*\])\n/);
    assert.ok(match);
    supplied.push(JSON.parse(match[1]!));
    return schema.parse(windowAnalysis([]));
  };
  const result = await analyzeFootage({ ...capture, durationSeconds: 600.03 }, provider, undefined, reelInput.brief, hints);
  assert.deepEqual(hints, before);
  assert.equal(supplied.length, 2);
  assert.deepEqual(supplied[0], [{ ...hints[0]!, endSeconds: 300.015 }]);
  assert.equal(supplied[1]!.length, 2);
  assert.equal(supplied[1]![0]!.startSeconds, 0);
  assert.ok(Math.abs(supplied[1]![0]!.endSeconds - 4.985) < 1e-8);
  assert.ok(Math.abs(supplied[1]![1]!.startSeconds - 69.985) < 1e-8);
  assert.ok(Math.abs(supplied[1]![1]!.endSeconds - 71.985) < 1e-8);
  assert.equal(result.usable, false);
  assert.deepEqual(result.events, [], 'hints alone cannot make usable footage or trigger unverified final events');
});

test('reel observation hints enforce bounded text, count and valid finite source intervals before inference', async () => {
  const hint = { startSeconds: 1, endSeconds: 2, observation: 'A possible ability appears.' };
  for (const hints of [
    [{ ...hint, startSeconds: -1 }], [{ ...hint, endSeconds: capture.durationSeconds + 1 }],
    [{ ...hint, endSeconds: 1 }], [{ ...hint, startSeconds: Number.NaN }], [{ ...hint, endSeconds: Number.POSITIVE_INFINITY }],
    [{ ...hint, observation: 'x'.repeat(801) }], [{ ...hint, observation: '   ' }], Array.from({ length: 61 }, () => hint),
  ]) await assert.rejects(analyzeFootage(capture, googleFixture([]), undefined, reelInput.brief, hints), error => error instanceof Error && !error.message.includes('unexpected model call'));
  const sampled: number[] = [];
  const valid = await analyzeFootage(capture, googleFixture([windowAnalysis([])], sampled), undefined, reelInput.brief, Array.from({ length: 60 }, () => ({ ...hint, observation: 'x'.repeat(800) })));
  assert.equal(valid.usable, false);
  assert.deepEqual(sampled, [1]);
});

test('verified cut boundaries allow decimal roundoff while real gaps, overlaps and source limits remain strict', () => {
  const events = [{ startSeconds: 28.749000000000002, endSeconds: 34.249 }];
  const exact = [{ startSeconds: 28.749, endSeconds: 34.24900000000001 }];
  assert.deepEqual(validateCuts(exact, 40, events), exact);
  assert.throws(() => validateCuts([{ startSeconds: 28.749 - 1e-7, endSeconds: 31.949 }], 40, events), /outside the verified action windows/);
  assert.throws(() => validateCuts([{ startSeconds: 30, endSeconds: 34.249 + 1e-7 }], 40, events), /outside the verified action windows/);
  assert.throws(() => validateCuts([{ startSeconds: 1, endSeconds: 5 }], 10, [{ startSeconds: 0, endSeconds: 3 }, { startSeconds: 3 + 1e-7, endSeconds: 6 }]), /outside the verified action windows/);
  assert.throws(() => validateCuts([{ startSeconds: 1, endSeconds: 4 }, { startSeconds: 4 - 1e-10, endSeconds: 5 }], 10), /overlap/, 'the containment tolerance does not relax repeated-footage checks');
  assert.throws(() => validateCuts([{ startSeconds: -1e-10, endSeconds: 2 }], 10), /outside the recorded footage/);
  assert.throws(() => validateCuts([{ startSeconds: 1, endSeconds: 10 + 1e-10 }], 10), /outside the recorded footage/);
});

test('the saved Ben10 millisecond cuts survive both verified-window and referenced-event checks', async () => {
  // Exact bounds from 9dd29c: the first start is a mapped relative decimal,
  // while the proposed cut uses its mathematically identical millisecond value.
  const bounds = [[28.749000000000002, 34.249], [201.159, 203.726], [237.823, 239.323], [239.841, 247.59]];
  const source: Capture = { ...reelCapture, durationSeconds: 431.832, analysis: { ...reelCapture.analysis!,
    events: bounds.map(([startSeconds, endSeconds], index) => ({ ...reelCapture.analysis!.events[index % 3]!, startSeconds: startSeconds!, endSeconds: endSeconds! })),
  } };
  const choice = reelChoice();
  choice.shots = [
    { ...choice.shots[1]!, eventIndex: 0, startSeconds: 28.749, endSeconds: 31.949, purpose: 'opening' },
    { ...choice.shots[2]!, eventIndex: 1, startSeconds: 201.159, endSeconds: 203.726, purpose: 'contrast' },
    { ...choice.shots[1]!, eventIndex: 3, startSeconds: 239.841, endSeconds: 247.59, purpose: 'ending', feature: 'powered flight' },
  ];
  const assessed = { ...reelReview,
    shots: choice.shots.map((shot, shotIndex) => ({ shotIndex, activeSeconds: [3, 2, 6][shotIndex]!, feature: shot.feature, demonstratesFeature: true, navigationObstruction: false, agencyEvidence: shot.visibleChange })),
    ending: { readableFromSeconds: 246, essentialText: '', evidence: 'The flight reaches the street and the grounded character remains visible.' },
  };
  const result = await draftScript({ ...reelInput, capture: source }, googleFixture([choice, assessed]));
  assert.deepEqual(result.cuts, choice.shots.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })));
  // An overlapping observation cannot launder real footage outside the specific
  // referenced event, even when the general union contains the proposed shot.
  const overlapping = { ...source, analysis: { ...source.analysis!, events: [...source.analysis!.events, { ...source.analysis!.events[0]!, startSeconds: 28, endSeconds: 40 }] } };
  const outside = { ...choice, shots: choice.shots.map((shot, index) => index ? shot : { ...shot, startSeconds: 28.749 - 1e-7 }) };
  await assert.rejects(draftScript({ ...reelInput, capture: overlapping }, googleFixture([outside])), /outside its referenced observed moment/);
});
