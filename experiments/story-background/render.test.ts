import assert from 'node:assert/strict';
import test from 'node:test';
import { makeStoryCaptions,validateSourceCrop } from './render.js';
import { StoryPlanSchema, groupWords, validateStoryPlan, type Word } from './schema.js';

function fixture(): Record<string, unknown> {
  return { version: 1, id: 'story-test', title: 'A narrated fixture',
    source: { path: '/tmp/gameplay.mp4', windows: [{ start: 2, end: 8, speed: 1 }, { start: 10, end: 20, speed: 2 }] },
    narration: { path: '/tmp/voice.wav', script: 'These words form a simple test for timed captions.', voiceLabel: 'Synthetic test fixture', alignmentMethod: 'explicit fixture timestamps',
      words: ['These', 'words', 'form', 'a', 'simple', 'test', 'for', 'timed', 'captions.'].map((text, index) => ({ text, start: index * 0.8, end: index * 0.8 + 0.5 })) },
    story: { kind: 'original', title: 'Synthetic renderer test' },
    caption: { position: 'upper-middle', wordsPerGroup: 4, mode: 'highlight' },
    rationale: 'Verify renderer timing on known local inputs.' };
}

test('measured narration duration selects sufficient source without loops or surplus footage', () => {
  const { duration, availableDuration, timeline } = validateStoryPlan(fixture(), 30, 7);
  assert.equal(duration, 7.3);
  assert.equal(availableDuration, 11);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0]!.outputEnd, 6);
  assert.ok(Math.abs(timeline[1]!.sourceEnd - 12.6) < 1e-6);
  assert.equal(timeline[1]!.outputEnd, 7.3);
});

test('insufficient, overlapping, reversed and out-of-bounds gameplay is rejected', () => {
  for (const windows of [
    [{ start: 0, end: 6, speed: 1 }],
    [{ start: 0, end: 6, speed: 1 }, { start: 4, end: 10, speed: 1 }],
    [{ start: 8, end: 2, speed: 1 }], [{ start: 0, end: 40, speed: 1 }],
  ]) assert.throws(() => validateStoryPlan({ ...fixture(), source: { path: '/tmp/gameplay.mp4', windows } }, 30, 7));
});

test('alignment errors and missing primary Reddit sources fail before rendering', () => {
  const base = StoryPlanSchema.parse(fixture());
  for (const words of [
    [{ text: 'a', start: 1, end: 2 }, { text: 'b', start: 1.5, end: 3 }],
    [{ text: 'a', start: 0, end: 1 }, { text: 'b', start: 6, end: 9 }],
    [{ text: 'a', start: 0, end: 0 }, { text: 'b', start: 1, end: 2 }],
  ]) assert.throws(() => validateStoryPlan({ ...base, narration: { ...base.narration, words } }, 30, 7), /timestamps/u);
  assert.throws(() => validateStoryPlan({ ...base, story: { kind: 'reddit', title: 'Unattributed retelling' } }, 30, 7), /permalink/u);
  assert.throws(() => StoryPlanSchema.parse({ ...base, filter: 'arbitrary FFmpeg code' }));
});

test('phrase grouping preserves every aligned word and produces 2–5 word groups', () => {
  for (let length = 2; length <= 35; length++) for (let target = 2; target <= 5; target++) {
    const words: Word[] = Array.from({ length }, (_, index) => ({ text: index % 6 === 0 ? 'end.' : 'word', start: index, end: index + 0.9 }));
    const groups = groupWords(words, target);
    assert.deepEqual(groups.flatMap(group => group.words), words);
    assert.ok(groups.every(group => group.words.length >= 2 && group.words.length <= 5));
    assert.ok(groups.every((group, index) => index === 0 || group.start >= groups[index - 1]!.end));
  }
});

test('highlights use actual word intervals and caption text stays literal', () => {
  const plan = StoryPlanSchema.parse(fixture());
  plan.narration.words[0] = { text: '{\\test}', start: 0.12, end: 0.47 };
  const ass = makeStoryCaptions(plan, 7.3);
  assert.ok(ass.includes('Dialogue: 1,0:00:00.12,0:00:00.47'));
  assert.ok(ass.includes('｛＼TEST｝'));
  assert.ok(ass.includes('\\pos(360,320)'));
  plan.caption.mode = 'phrase';
  assert.ok(!makeStoryCaptions(plan, 7.3).includes('Dialogue: 1,'));
});

test('reviewed crops must fit the real source and cannot contain filter expressions',()=>{
 const plan=StoryPlanSchema.parse(fixture());
 const crop={x:30,y:0,width:660,height:1176};
 assert.doesNotThrow(()=>validateSourceCrop(crop,720,1280));
 assert.throws(()=>validateSourceCrop(crop,640,1280),/exceeds/u);
 assert.throws(()=>StoryPlanSchema.parse({...plan,source:{...plan.source,crop:{...crop,x:'0,drawtext=evil'}}}));
});

test('source credits stay off-screen and overview captions can preserve sentence case',()=>{
 const plan=StoryPlanSchema.parse(fixture());
 plan.story.attribution='PRIVATE_CREDIT_SENTINEL';
 plan.story.title='GAME_NAME_SENTINEL';
 plan.caption.casing='sentence';
 const ass=makeStoryCaptions(plan,7.3);
 assert.ok(!ass.includes('PRIVATE_CREDIT_SENTINEL'));
 assert.ok(!ass.includes('GAME_NAME_SENTINEL'));
 assert.ok(ass.includes('These'));
 assert.ok(!ass.includes('THESE'));
});

test('quantized zero-length words are retained only in positive-span phrase captions',()=>{
 const plan=StoryPlanSchema.parse(fixture());
 plan.caption.mode='phrase';
 plan.narration.words[1]={text:'a',start:0.8,end:0.8};
 assert.doesNotThrow(()=>validateStoryPlan(plan,30,7));
 plan.caption.mode='highlight';
 assert.throws(()=>validateStoryPlan(plan,30,7),/phrase-only/u);
 plan.caption.mode='phrase';
 plan.narration.words=[{text:'a',start:1,end:1},{text:'word',start:1,end:1}];
 assert.throws(()=>validateStoryPlan(plan,30,7),/positive measured/u);
});
