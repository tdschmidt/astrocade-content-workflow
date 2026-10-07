import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSubtitles, NarrationOverrunError, validateTimeline } from './render.js';
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
  assert.ok(!ass.includes('{\\pos'));
  assert.ok(ass.includes('｛＼pos(0,0)｝'));
});
