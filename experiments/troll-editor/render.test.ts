import assert from 'node:assert/strict';
import test from 'node:test';
import { delayedAudioFilter, experimentTools, makeCaptions, segmentFilter } from './render.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../../src/server/media/process.js';
import { z } from 'zod';
import { ClimaxAgentPlanSchema, EditPlanSchema, RevisedAgentPlanSchema, musicWindow, validateEditPlan } from './schema.js';

function validPlan(): Record<string, unknown> {
  return { version: 1, id: 'timing-test', title: 'A visible reversal', style: 'troll-freeze', sourcePath: '/tmp/source.mp4',
    segments: [{ kind: 'clip', start: 1, end: 4, speed: 1.5 }, { kind: 'freeze', at: 4, duration: 0.5 }, { kind: 'clip', start: 4, end: 6, speed: 0.5 }],
    captions: [{ start: 0, end: 1, text: 'watch the counter', position: 'top' }],
    stickers: [{ start: 2, end: 2.5, asset: 'reaction', x: 0.75, y: 0.3, size: 0.3 }],
    punches: [{ at: 2, duration: 0.2, strength: 0.8 }], soundCues: [{ at: 2, kind: 'impact' }],
    music: { asset: 'troll', dropAt: 2 }, rationale: 'Freeze the observable counter reversal.' };
}

test('source speed and freeze durations map to the same output clock as overlays and drops', () => {
  const { timeline, duration } = validateEditPlan(validPlan(), 10);
  assert.equal(duration, 6.5);
  assert.deepEqual(timeline.map(({ sourceStart, sourceEnd, outputStart, outputEnd, speed }) => ({ sourceStart, sourceEnd, outputStart, outputEnd, speed })), [
    { sourceStart: 1, sourceEnd: 4, outputStart: 0, outputEnd: 2, speed: 1.5 },
    { sourceStart: 4, sourceEnd: 4, outputStart: 2, outputEnd: 2.5, speed: 0 },
    { sourceStart: 4, sourceEnd: 6, outputStart: 2.5, outputEnd: 6.5, speed: 0.5 },
  ]);
});

test('invalid source bounds and output cues cannot silently become wrong edits', () => {
  for (const segments of [
    [{ kind: 'clip', start: 2, end: 1 }], [{ kind: 'clip', start: 1, end: 11 }],
    [{ kind: 'clip', start: 1, end: 1.001 }], [{ kind: 'freeze', at: 10, duration: 1 }],
  ]) assert.throws(() => validateEditPlan({ ...validPlan(), segments }, 10));
  assert.throws(() => validateEditPlan({ ...validPlan(), captions: [{ start: 0, end: 9, text: 'late' }] }, 10), /output timing/u);
  assert.throws(() => validateEditPlan({ ...validPlan(), soundCues: [{ at: 7, kind: 'impact' }] }, 10), /Sound cue/u);
  assert.throws(() => validateEditPlan({ ...validPlan(), music: { asset: 'troll', dropAt: 7 } }, 10), /Music drop/u);
});

test('unsafe arbitrary expressions, nonfinite speeds and offscreen stickers fail validation', () => {
  assert.throws(() => EditPlanSchema.parse({ ...validPlan(), filter: 'movie=/etc/passwd' }));
  assert.throws(() => EditPlanSchema.parse({ ...validPlan(), segments: [{ kind: 'clip', start: 0, end: 4, speed: Infinity }] }));
  assert.throws(() => validateEditPlan({ ...validPlan(), stickers: [{ start: 1, end: 2, asset: 'reaction', x: 0.01, y: 0.3, size: 0.4 }] }, 10), /outside/u);
});

test('captions remain literal ASS text and cannot overlap their screen position', () => {
  const { plan } = validateEditPlan({ ...validPlan(), captions: [{ start: 0, end: 1, text: '{\\pos(0,0)} wait' }] }, 10);
  const captions = makeCaptions(plan);
  assert.ok(captions.includes('｛＼pos(0,0)｝ wait'));
  assert.throws(() => validateEditPlan({ ...validPlan(), captions: [{ start: 0, end: 2, text: 'first' }, { start: 1, end: 3, text: 'second' }] }, 10), /overlap/u);
});

test('source audio uses legal chained tempo filters for 3x speed', () => {
  const { plan, timeline } = validateEditPlan({ ...validPlan(), segments: [{ kind: 'clip', start: 0, end: 10, speed: 3 }], stickers: [], captions: [], punches: [], soundCues: [] }, 10);
  const filter = segmentFilter(plan.segments[0]!, timeline[0]!, true);
  assert.ok(filter.includes('atempo=2,atempo=1.5'));
  assert.ok(filter.includes('setpts=PTS/3'));
});

test('revised face attachments cannot drift over moving footage or become floating stickers', () => {
  const face = { segmentIndex: 1, asset: 'reaction', coordinateSpace: 'output-pixels', headBox: { x: 210, y: 650, width: 54, height: 60 }, evidence: 'Observed head bounds on the frozen source frame after the declared crop.' };
  const plan = { ...validPlan(), stickers: [], faceAttachments: [face] };
  assert.equal(validateEditPlan(plan, 10).plan.faceAttachments.length, 1);
  assert.throws(() => validateEditPlan({ ...plan, faceAttachments: [{ ...face, segmentIndex: 0 }] }, 10), /frozen/u);
  assert.throws(() => validateEditPlan({ ...plan, faceAttachments: [{ ...face, headBox: { x: 700, y: 650, width: 54, height: 60 } }] }, 10), /outside/u);
  assert.throws(() => validateEditPlan({ ...validPlan(), audioCatalogPath: '/tmp/catalog.json', music: { asset: 'troll', assetId: 'phonk-execution', dropAt: 2 }, soundCues: [] }, 10), /floating stickers/u);
});

test('a real music lead-in preserves the same source/output drop and cannot overrun either clock', () => {
  const {plan,duration}=validateEditPlan({...validPlan(),music:{asset:'troll',dropAt:2,sourceStart:14.84,leadInSeconds:2}},10);
  const selected=musicWindow(plan,duration);
  assert.equal(selected.outputStart,0);
  assert.equal(selected.sourceStart,12.84);
  assert.equal(selected.outputStart+plan.music.leadInSeconds,selected.outputDrop);
  assert.equal(selected.sourceStart+plan.music.leadInSeconds,selected.sourceDrop);
  assert.throws(()=>validateEditPlan({...validPlan(),music:{asset:'troll',dropAt:2,sourceStart:14.84,leadInSeconds:3}},10),/lead-in/u);
  assert.throws(()=>validateEditPlan({...validPlan(),music:{asset:'troll',dropAt:2,sourceStart:1,leadInSeconds:2}},10),/lead-in/u);
});

test('revised agent JSON schema requires every object property for Structured Outputs',()=>{
  const inspect=(value:unknown):void=>{
    if(!value||typeof value!=='object')return;
    const object=value as Record<string,unknown>;
    if(object.type==='object'&&object.properties)assert.deepEqual([...(object.required as string[])].sort(),Object.keys(object.properties).sort());
    for(const entry of Object.values(object))if(Array.isArray(entry))entry.forEach(inspect);else inspect(entry);
  };
  inspect(z.toJSONSchema(RevisedAgentPlanSchema));
  inspect(z.toJSONSchema(ClimaxAgentPlanSchema));
});

test('declared climax cannot spend its main drop or strongest visual on an earlier minor reaction',()=>{
  const narrativeBeats={
    candidates:[{sourceAt:2,significance:'An earlier minor reaction.',rank:2},{sourceAt:9,significance:'The decisive observed reversal.',rank:1}],
    setup:{sourceAt:1,description:'Readable clean setup begins.'},escalation:{sourceAt:7,description:'Approach raises the actual stakes.'},
    climax:{segmentIndex:1,sourceAt:9,outputAt:8,visualSegmentIndex:1,punchIndex:0,reason:'This visible reversal resolves the earlier build.'},
    result:{sourceAt:10,description:'The true aftermath is readable.'},tailReason:'Two seconds preserve the visible final result.',latePayoffException:'',
  };
  const plan={...validPlan(),segments:[{kind:'clip',start:1,end:9,speed:1},{kind:'clip',start:9,end:9.5,speed:1,visual:'bw'},{kind:'clip',start:9.5,end:11,speed:1}],stickers:[],soundCues:[],punches:[{at:8,duration:.2,strength:.8}],music:{asset:'ironic',dropAt:8},narrativeBeats};
  assert.equal(validateEditPlan(plan,12).duration,10);
  assert.throws(()=>validateEditPlan({...plan,music:{asset:'ironic',dropAt:2}},12),/music drop/u);
  assert.throws(()=>validateEditPlan({...plan,punches:[{at:2,duration:.2,strength:1},{at:8,duration:.2,strength:.8}],narrativeBeats:{...narrativeBeats,climax:{...narrativeBeats.climax,punchIndex:1}}},12),/Strongest punch/u);
  assert.throws(()=>validateEditPlan({...plan,narrativeBeats:{...narrativeBeats,climax:{...narrativeBeats.climax,outputAt:7}}},12),/clocks disagree/u);
  assert.throws(()=>validateEditPlan({...plan,narrativeBeats:{...narrativeBeats,climax:{...narrativeBeats.climax,visualSegmentIndex:0}}},12),/visual change/u);
});

test('actual FFmpeg delayed waveform retains silence until its intended late output onset',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'troll-audio-timing-'));
  const ffmpeg=experimentTools().ffmpegPath??'ffmpeg';
  try {
    const source=join(dir,'source.wav'),output=join(dir,'delayed.f32');
    await runProcess(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=733:sample_rate=48000:duration=0.8','-c:a','pcm_s16le',source]);
    await runProcess(ffmpeg,['-v','error','-i',source,'-af',`atrim=start=0.1:duration=0.5,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,${delayedAudioFilter(2)},apad,atrim=duration=3`,'-ac','1','-ar','48000','-f','f32le',output]);
    const bytes=await readFile(output), samples=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const rms=(start:number,end:number)=>{const slice=samples.subarray(Math.round(start*48000),Math.round(end*48000));return Math.sqrt(slice.reduce((sum,value)=>sum+value*value,0)/slice.length);};
    assert.ok(Math.abs(samples.length/48000-3)<1/48000,'Rendered duration includes inserted silence');
    assert.ok(rms(0,1.99)<1e-6,'No sound is front-loaded before the planned 2s cue');
    assert.ok(rms(2.01,2.49)>0.04,'The real decoded waveform begins at the planned late cue');
    assert.ok(rms(2.51,2.99)<1e-6,'The half-second source does not repeat or move later');
  } finally {await rm(dir,{recursive:true,force:true});}
});
