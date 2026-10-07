import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSubtitles, NarrationOverrunError, validateOverlayCues, validateTimeline } from './render.js';
import type { MediaInfo } from './probe.js';

const media = new Map<string, MediaInfo>([['/capture.webm', { durationSeconds: 10, sizeBytes: 100, video: { width: 1280, height: 720, codec: 'vp9' } }]]);
const cuts = [{ path: '/capture.webm', startSeconds: 2, endSeconds: 7 }];

test('narration overrun fails instead of looping footage or truncating speech', () => {
  assert.throws(() => validateTimeline(cuts, media, [], 5.1), NarrationOverrunError);
  assert.equal(validateTimeline(cuts, media, [], 4.9), 5);
});

test('cuts, crop rectangles, and captions must fit the actual media timeline', () => {
  assert.throws(() => validateTimeline([{ ...cuts[0]!, endSeconds: 11 }], media), /outside/u);
  assert.throws(() => validateTimeline([{ ...cuts[0]!, crop: { x: 1200, y: 0, width: 300, height: 200 } }], media), /Crop/u);
  assert.throws(() => validateTimeline(cuts, media, [{ startSeconds: 4.5, endSeconds: 5.5, text: 'late' }]), /Caption/u);
  assert.throws(() => validateTimeline(cuts, media, [{ startSeconds: 0, endSeconds: 2, text: 'one' }, { startSeconds: 1, endSeconds: 3, text: 'two' }]), /overlapping/u);
});

test('editable caption text cannot inject ASS style overrides', () => {
  const ass = makeSubtitles('Try this', 'Creator', [{ startSeconds: 0, endSeconds: 2, text: '{\\pos(0,0)} literal' }], 5, 'Noto Sans');
  assert.ok(!ass.includes('{\\pos(0,0)}'));
  assert.ok(ass.includes('｛＼pos(0,0)｝'));
});

test('oversized phrases are rejected instead of covering the gameplay', () => {
  assert.doesNotThrow(() => makeSubtitles('Which gate grows the crowd?', 'Creator', [], 5, 'Noto Sans'));
  assert.throws(() => makeSubtitles('A'.repeat(23), undefined, [], 5, 'Noto Sans'), /Shorten caption/);
  assert.throws(() => makeSubtitles(Array(10).fill('abcdefghij').join(' '), undefined, [], 5, 'Noto Sans'), /Shorten caption/);
  assert.throws(() => makeSubtitles('W'.repeat(22), undefined, [], 5, 'Noto Sans'), /Shorten caption/);
  assert.throws(() => makeSubtitles(Array(13).fill('a').join(' '), undefined, [], 5, 'Noto Sans'), /12 words/);
});

test('overlay schedules replace the legacy hook and subtitles, preserving intentional silent intervals', () => {
  const ass = makeSubtitles('Legacy hook', undefined, [{ startSeconds: 0, endSeconds: 2, text: 'Legacy subtitle' }], 5, 'Noto Sans', [
    { startSeconds: 0, endSeconds: 1.2, text: 'One spot left', position: 'upper' },
    { startSeconds: 3, endSeconds: 4.5, text: 'Finally', position: 'lower' },
  ]);
  assert.ok(!ass.includes('Legacy'));
  assert.ok(ass.includes('0:00:00.00,0:00:01.20,Overlay'));
  assert.ok(ass.includes('{\\an8\\pos(510,240)}One spot left'));
  assert.ok(ass.includes('{\\an2\\pos(510,1536)}Finally'));
  assert.equal(ass.match(/^Dialogue:/gmu)?.length, 2);
  assert.ok(!makeSubtitles('', undefined, [], 5, 'Noto Sans', []).includes('Dialogue:'));
});

test('overlay validation enforces readable timing, order, placement, and source bounds', () => {
  const cue = { startSeconds: 0, endSeconds: 0.8, text: 'Try this', position: 'upper' as const };
  assert.doesNotThrow(() => validateOverlayCues([cue], 5));
  assert.throws(() => validateOverlayCues([{ ...cue, endSeconds: 0.79 }], 5), /0.8/);
  assert.throws(() => validateOverlayCues([{ ...cue, endSeconds: 6 }], 5), /outside/);
  assert.throws(() => validateOverlayCues([{ ...cue, startSeconds: NaN }], 5), /timing/);
  assert.throws(() => validateOverlayCues([cue, { ...cue, startSeconds: 0.5, endSeconds: 2 }], 5), /overlapping/);
  assert.throws(() => validateOverlayCues([{ ...cue, position: 'center' as 'upper' }], 5), /position/);
});

test('attribution remains a single small line and cannot inject subtitles', () => {
  const ass = makeSubtitles('Try this', 'A very long credit '.repeat(20), [], 5, 'Noto Sans');
  const credit = ass.split('\n').find(line => line.startsWith('Dialogue:') && line.includes(',Credit,'))!;
  assert.ok(credit.endsWith('…'));
  assert.ok(!credit.includes('\\N'));
});
