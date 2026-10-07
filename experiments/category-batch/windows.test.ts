import assert from 'node:assert/strict';
import test from 'node:test';
import { collectWindows, feedbackWindow, reviewedWindows, samplingFps, validateObservedPlan, type EvidenceWindow } from './windows.js';

const windows: EvidenceWindow[] = [
  { id: 'dial', start: 10, end: 13, basis: 'feedback-search-lead', observation: 'Dial opened.' },
  { id: 'flight', start: 30, end: 38, basis: 'core-analysis', observation: 'Flight and landing.' },
];
function plan() { return {
  version: 1, id: 'sample', title: 'Sample', style: 'velocity', sourcePath: '/tmp/source.webm',
  segments: [{ kind: 'clip', start: 10, end: 12, speed: 1, visual: 'clean', zoom: 1 }, { kind: 'clip', start: 30, end: 38, speed: 1, visual: 'clean', zoom: 1 }],
  captions: [], stickers: [], punches: [], soundCues: [], music: { asset: 'velocity', dropAt: 2, gainDb: -9 }, rationale: 'Observed dial then flight.',
}; }
const options = { id: 'sample', title: 'Sample', sourcePath: '/tmp/source.webm', duration: 60, windows };

test('audited windows preserve exact reviewed ranges and remain source-review evidence', () => {
  const hash = 'a'.repeat(64);
  const input = { sourceSha256: hash, sourceReview: '/tmp/source-review.md', windows: [
    { start: 30, end: 38, observation: 'Later answer and score.' }, { start: 10, end: 13, observation: 'Earlier readable question and answer.' },
  ] };
  const original = structuredClone(input);
  const selected = reviewedWindows(input, hash, 60);
  assert.deepEqual(input, original);
  assert.deepEqual(selected.map(window => [window.start, window.end, window.basis]), [[10, 13, 'source-review'], [30, 38, 'source-review']]);
  assert.ok(selected.every(window => !window.analyzedBounds && (window.end - window.start) * samplingFps(window) <= 30));
  assert.equal(validateObservedPlan(plan(), { ...options, windows: selected }).duration, 10);
  const unseen = plan(); unseen.segments[0]!.end = 14;
  assert.throws(() => validateObservedPlan(unseen, { ...options, windows: selected }), /unobserved/);
});

test('audited windows reject wrong sources, invalid ranges and excessive evidence', () => {
  const hash = 'a'.repeat(64);
  const input = { sourceSha256: hash, sourceReview: '/tmp/source-review.md', windows: [{ start: 10, end: 13, observation: 'Question and reveal.' }] };
  assert.throws(() => reviewedWindows(input, 'b'.repeat(64), 60), /different source hash/);
  for (const range of [{ start: 10, end: 10 }, { start: 10, end: 9 }, { start: 59, end: 61 }, { start: 0, end: 30.01 }]) {
    assert.throws(() => reviewedWindows({ ...input, windows: [{ ...input.windows[0], ...range }] }, hash, 60), /nonempty|within|30 seconds/);
  }
  assert.throws(() => reviewedWindows({ ...input, windows: Array.from({ length: 11 }, () => input.windows[0]) }, hash, 60));
  assert.throws(() => reviewedWindows({ ...input, windows: [] }, hash, 60));
  assert.throws(() => reviewedWindows({ ...input, windows: [{ ...input.windows[0], start: -1 }] }, hash, 60));
  assert.throws(() => reviewedWindows({ ...input, windows: [{ ...input.windows[0], end: Infinity }] }, hash, 60));
});

test('uses actual action observations and rejects unsupported feedback timestamps', () => {
  const record = { observation: 'The dial opened and selected an alien.', elapsedMs: 12500, sampledFrames: [{ elapsedMs: 10500 }, { elapsedMs: 11500 }] };
  assert.deepEqual(feedbackWindow(record, 'decision-3', 60), { id: 'decision-3', start: 10, end: 13, basis: 'feedback-search-lead', observation: record.observation });
  assert.equal(feedbackWindow({ ...record, sampledFrames: [{ elapsedMs: 14000 }] }, 'bad', 60), undefined);
  assert.equal(feedbackWindow({ ...record, sampledFrames: [] }, 'no frames', 60), undefined);
  assert.equal(feedbackWindow({ ...record, elapsedMs: Infinity }, 'infinite', 60), undefined);
  assert.equal(feedbackWindow({ proposal: record }, 'proposal', 60), undefined);
});

test('retains distinct selector setup beyond verified action windows, bounded across session', () => {
  const leads = Array.from({ length: 9 }, (_, index) => ({ ...windows[0]!, id: String(index), start: index * 10, end: index * 10 + 3 }));
  const selected = collectWindows(undefined, leads, 100);
  assert.equal(selected.length, 4);
  assert.equal(selected[0]!.id, '0');
  assert.equal(selected.at(-1)!.id, '8');
  assert.ok(selected.every(window => (window.end - window.start) * samplingFps(window) <= 30));
});

test('prioritizes observed level transitions over repeated level mentions and prospective plans', () => {
  const observations = [
    'The dial opened and selected a visible form.',
    'The next taps may trigger a LEVEL UP. No level change appeared.',
    'Two taps crossed 100 reps. A LEVEL UP overlay appeared with confetti, then Level 2 became visible.',
    'The paced chain advanced Level 2 from 266 to 293 reps; no selector or level change appeared.',
    'The next goal is to transform and purchase an upgrade.',
    'The single tap crossed 399 to 400 and triggered LEVEL UP! Getting Toned became visible.',
    'The Slap Power purchase succeeded: Level 3 appeared in the shop.',
    'The previous taps visibly advanced Level 3 from 504 to 523 reps.',
  ];
  const leads = observations.map((observation, index) => ({ ...windows[0]!, id: String(index), start: index * 10, end: index * 10 + 3, observation }));
  assert.deepEqual(collectWindows(undefined, leads, 100).map(window => window.id), ['0', '2', '5', '6']);
});

test('labels new context separately from prior analysis bounds', () => {
  const selected = collectWindows({ usable: true, reason: 'Observed event', mechanic: 'Movement', visualScore: 3, events: [{ startSeconds: 10, endSeconds: 12, event: 'Moves', evidence: 'Changed position', outcome: 'Arrives' }] }, [], 60);
  assert.equal(selected[0]!.start, 9.6);
  assert.equal(selected[0]!.end, 12.4);
  assert.deepEqual(selected[0]!.analyzedBounds, { start: 10, end: 12 });
});

test('does not prioritize retrospective opening or stable form over visible transformation events', () => {
  const observations = [
    'Escape closed the selector. The prompt remains visible; the earlier tap opened the dial instead.',
    'The sequence visibly completed: the readable roster was shown, green morph effects appeared, and NOW the new form stands safely.',
    'The prior batch visibly opened the roster, showed the green morph effect, and completed the transformation.',
    'The prompt-center tap removed the overlay; the character remains transformed and safe.',
    'Space produced a large green voxel morph effect. NOW the character is fully transformed.',
    'The dial selected a form and Space produced a green transformation effect.',
  ];
  const leads = observations.map((observation, index) => ({ ...windows[0]!, id: String(index), start: index * 10, end: index * 10 + 3, observation }));
  assert.deepEqual(collectWindows(undefined, leads, 100).map(window => window.id), ['1', '2', '4', '5']);
});

test('context padding cannot disguise reversed or out-of-source prior analysis bounds', () => {
  const analysis = { usable: true, reason: 'Observed event', mechanic: 'Movement', visualScore: 3, events: [{ startSeconds: 10, endSeconds: 9.8, event: 'Moves', evidence: 'Changed position', outcome: 'Arrives' }] };
  assert.throws(() => collectWindows(analysis, [], 60), /invalid source bounds/);
  analysis.events[0]!.endSeconds = 60.1;
  assert.throws(() => collectWindows(analysis, [], 60), /invalid source bounds/);
});

test('accepts source gaps as cuts but never bridges unobserved footage', () => {
  assert.equal(validateObservedPlan(plan(), options).duration, 10);
  const bridge = plan(); bridge.segments[0]!.end = 31;
  assert.throws(() => validateObservedPlan(bridge, options), /15 seconds|unobserved/);
  bridge.segments[0]!.speed = 3;
  assert.throws(() => validateObservedPlan(bridge, options), /unobserved/);
});

test('bounds total duration including freeze and preserves source identity', () => {
  const slow = plan(); slow.segments[1]!.speed = 0.5;
  assert.throws(() => validateObservedPlan(slow, options), /15 seconds/);
  assert.throws(() => validateObservedPlan({ ...plan(), sourcePath: '/tmp/other.webm' }, options), /identity/);
});

test('rejects replayed source chronology', () => {
  const reverse = plan(); reverse.segments.reverse();
  assert.throws(() => validateObservedPlan(reverse, options), /chronology/);
});

test('allows a sampled freeze without allowing moving-clip replay or accumulating reverse time', () => {
  const held = { ...plan(), segments: [plan().segments[0]!, { kind: 'freeze', at: 11.75, duration: 0.4, visual: 'bw', zoom: 1 }, plan().segments[1]!] };
  assert.ok(validateObservedPlan(held, options).duration > 10);
  const replay = { ...held, segments: [held.segments[0]!, held.segments[1]!, { ...plan().segments[0]!, start: 11.8, end: 13 }, plan().segments[1]!] };
  assert.throws(() => validateObservedPlan(replay, options), /chronology/);
  const backwardsFreeze = { ...held, segments: [held.segments[0]!, held.segments[1]!, { kind: 'freeze', at: 11.5, duration: 0.4, visual: 'bw', zoom: 1 }, plan().segments[1]!] };
  assert.throws(() => validateObservedPlan(backwardsFreeze, options), /chronology/);
});

test('revised edits preserve crop, catalog and actual audio bounds', () => {
  const crop = { x: 29, y: 0, width: 661, height: 1176 };
  const revised = { ...plan(), sourceCrop: crop, audioCatalogPath: '/tmp/catalog.json', music: { ...plan().music, assetId: 'real-track', sourceStart: 5 }, soundCues: [{ at: 2, kind: 'impact', assetId: 'real-hit', sourceStart: 0, duration: 0.8, gainDb: -8 }] };
  const revisedOptions = { ...options, sourceCrop: crop, audioCatalogPath: '/tmp/catalog.json', audioAssets: [{ id: 'real-track', kind: 'music', durationSeconds: 30 }, { id: 'real-hit', kind: 'sfx', durationSeconds: 1 }] };
  assert.equal(validateObservedPlan(revised, revisedOptions).duration, 10);
  assert.throws(() => validateObservedPlan({ ...revised, sourceCrop: { ...crop, x: 30 } }, revisedOptions), /crop/);
  assert.throws(() => validateObservedPlan({ ...revised, audioCatalogPath: '/tmp/other.json' }, revisedOptions), /catalog/);
  assert.throws(() => validateObservedPlan({ ...revised, music: { ...revised.music, assetId: 'unreviewed' } }, revisedOptions), /reviewed music/);
  assert.throws(() => validateObservedPlan({ ...revised, soundCues: [{ ...revised.soundCues[0]!, duration: 2 }] }, revisedOptions), /reviewed sound/);
});

test('freeze timestamp must correspond to a supplied decoded frame', () => {
  const held = { ...plan(), segments: [plan().segments[0]!, { kind: 'freeze', at: 11.75, duration: 0.4, visual: 'bw', zoom: 1 }, plan().segments[1]!] };
  assert.ok(validateObservedPlan(held, { ...options, frameTimes: [10, 11.75, 30] }));
  assert.throws(() => validateObservedPlan(held, { ...options, frameTimes: [10, 11.5, 30] }), /exact supplied/);
});
