import assert from 'node:assert/strict';
import test from 'node:test';
import { delayedAudioFilter, experimentTools, finalFilter, makeCaptions, segmentFilter } from './render.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../../src/server/media/process.js';
import { z } from 'zod';
import { ClimaxAgentPlanSchema, EditPlanSchema, RevisedAgentPlanSchema, buildTimeline, musicWindow, validateEditPlan } from './schema.js';
import { sourceSeekArgs } from '../../src/server/media/source-window.js';

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

test('AAC segment boundaries cannot advance the music or truncate its closing fade', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'troll-concat-audio-'));
  const ffmpeg = experimentTools().ffmpegPath ?? 'ffmpeg';
  try {
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=32x32:r=30:d=8.5',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-t', '8.5', join(dir, 'segment.mp4')]);
    await writeFile(join(dir, 'segments.txt'), "file 'segment.mp4'\nduration 8.5\nfile 'segment.mp4'\nduration 8.5\n");
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'concat', '-i', join(dir, 'segments.txt'), '-c', 'copy', join(dir, 'base.mp4')]);
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=733:sample_rate=48000:duration=17', '-c:a', 'pcm_s16le', join(dir, 'music.wav')]);
    const plan = EditPlanSchema.parse({ ...validPlan(), sourcePath: join(dir, 'base.mp4'), style: 'velocity', audioCatalogPath: '/fixture/catalog.json',
      segments: [{ kind: 'clip', start: 0, end: 8.5, speed: 1 }, { kind: 'clip', start: 8.5, end: 17, speed: 1 }],
      stickers: [], captions: [], punches: [], soundCues: [], music: { asset: 'velocity', dropAt: 0.95, sourceStart: 0.95, leadInSeconds: 0.95, leadInGainDb: -22, gainDb: -12 } });
    await writeFile(join(dir, 'captions.ass'), makeCaptions(plan, 'sans-serif'));
    await runProcess(ffmpeg, ['-v', 'error', '-i', 'base.mp4', '-i', 'music.wav', '-filter_complex_threads', '1',
      '-filter_complex', finalFilter(plan, 17, undefined, 1, []), '-map', '[video]', '-map', '[audio]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', '17', 'mixed.mp4'], { cwd: dir });
    await runProcess(ffmpeg, ['-v', 'error', '-i', join(dir, 'mixed.mp4'), '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', join(dir, 'samples.f32')]);
    const bytes = await readFile(join(dir, 'samples.f32')), samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    assert.equal(samples.length, 17 * 48000, 'The whole fade must survive AAC segment priming and the final encode');
    const rms = (start: number, end: number) => { const part = samples.subarray(start, end); return Math.sqrt(part.reduce((sum, sample) => sum + sample * sample, 0) / part.length); };
    assert.ok(rms(10 * 48000, 11 * 48000) > 0.04, 'The post-cut music remains audible');
    assert.ok(rms(samples.length - 240, samples.length) < 0.003, 'The last 5ms resolves the fade instead of cutting active music');
    const packets = JSON.parse((await runProcess('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_packets', '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', join(dir, 'mixed.mp4')])).stdout).packets as Array<{ pts_time: string; duration_time: string }>;
    assert.ok(packets.slice(0, -1).every(packet => Math.abs(Number(packet.duration_time) - 1024 / 48000) < 0.000002), 'AAC packets use a continuous sample clock, without zero-length or stretched packets');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a changing decoded source size cannot corrupt the saved gameplay crop or its clock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'troll-crop-resize-'));
  const ffmpeg = experimentTools().ffmpegPath ?? 'ffmpeg';
  try {
    for (const [index, size] of ['160x240', '80x120', '160x240'].entries()) {
      await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=${['red', 'blue', 'green'][index]}:size=${size}:rate=10:duration=1`,
        '-c:v', 'libvpx-vp9', '-deadline', 'realtime', join(dir, `${index}.webm`)]);
    }
    await writeFile(join(dir, 'segments.txt'), "file '0.webm'\nfile '1.webm'\nfile '2.webm'\n");
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'concat', '-i', join(dir, 'segments.txt'), '-c', 'copy', join(dir, 'source.webm')]);
    const plan = EditPlanSchema.parse({ ...validPlan(), segments: [{ kind: 'clip', start: 0.2, end: 1.8, speed: 1 }],
      stickers: [], captions: [], punches: [], soundCues: [], music: { asset: 'velocity', dropAt: 0 } });
    const timeline = buildTimeline(plan);
    await runProcess(ffmpeg, ['-v', 'error', ...sourceSeekArgs(0.2), '-reinit_filter', '0', '-i', join(dir, 'source.webm'),
      '-filter_complex_threads', '1', '-filter_complex', segmentFilter(plan.segments[0]!, timeline[0]!, false, { x: 10, y: 10, width: 140, height: 220 }, { width: 160, height: 240 }),
      '-map', '[video]', '-map', '[audio]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '1.6', join(dir, 'cropped.mp4')]);
    await runProcess(ffmpeg, ['-v', 'error', '-i', join(dir, 'cropped.mp4'), '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', join(dir, 'pixels.rgb')]);
    const pixels = await readFile(join(dir, 'pixels.rgb'));
    assert.equal(pixels.length, 48 * 3, 'The source resize must not restart or discard the timeline');
    for (let frame = 0; frame < 48; frame++) {
      const red = pixels[frame * 3]!, green = pixels[frame * 3 + 1]!, blue = pixels[frame * 3 + 2]!;
      assert.ok(frame < 24 ? red > 190 && blue < 30 : blue > 190 && red < 30, `The saved crop contains corrupted or mistimed pixels at frame ${frame}`);
      assert.ok(green < 30, 'No green uninitialized edge pixels or next-window source leaks into the crop');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
