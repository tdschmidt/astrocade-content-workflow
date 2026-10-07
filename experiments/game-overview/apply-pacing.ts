import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {StoryPlanSchema,validateStoryPlan} from '../story-background/schema.js';
import {probeMedia} from '../../src/server/media/probe.js';
const [planArg,pacingArg,outArg]=process.argv.slice(2);if(!planArg||!pacingArg||!outArg)throw new Error('Usage: apply-pacing.ts BASE_PLAN.json PACING.json NEW_OUTPUT_DIR');
const planPath=resolve(planArg),pacePath=resolve(pacingArg),output=resolve(outArg),planRaw=await readFile(planPath,'utf8'),paceRaw=await readFile(pacePath,'utf8');
const plan=StoryPlanSchema.parse(JSON.parse(planRaw)),pace=JSON.parse(paceRaw),ledger=JSON.parse(await readFile(resolve(dirname(planPath),'claim-timeline.json'),'utf8'));
const chapterIndex=ledger.chapters.findIndex((c:any)=>c.id===pace.chapterId);if(chapterIndex<0)throw new Error('Unknown pacing chapter');const chapter=ledger.chapters[chapterIndex],original=plan.source.windows[chapterIndex]!;
let previous=original.start,frames=0;
for(const s of pace.segments){const duration=s.outputFrames/30,speed=(s.sourceEnd-s.sourceStart)/duration;if(s.sourceStart<previous-1e-6||s.sourceEnd>original.end+1e-6||s.sourceEnd<=s.sourceStart||speed<.5||speed>2||!Number.isInteger(s.outputFrames))throw new Error('Invalid paced segment');previous=s.sourceEnd;frames+=s.outputFrames;}
if(Math.abs(frames/30-(chapter.outputEnd-chapter.outputStart))>1e-6)throw new Error('Pacing must preserve the exact chapter duration');
plan.source.windows.splice(chapterIndex,1,...pace.segments.map((s:any)=>({start:s.sourceStart,end:s.sourceEnd,speed:(s.sourceEnd-s.sourceStart)/(s.outputFrames/30)})));
plan.rationale+=' A final real-agent pacing pass aligns the two Four Arms impacts to recognized speech, trims uneventful approach, and preserves every audio sample and the original final source ending.';
const [source,audio]=await Promise.all([probeMedia(plan.source.path),probeMedia(plan.narration.path)]),validation=validateStoryPlan(plan,source.durationSeconds,audio.durationSeconds);
await mkdir(output);await writeFile(resolve(output,basename(planPath)),JSON.stringify(plan,null,2));
chapter.originalUniformVideoSpeed=chapter.videoSpeed;delete chapter.videoSpeed;chapter.videoSpeedPolicy='Piecewise, selected by the actual pacing agent against recognized speech';chapter.segments=pace.segments.map((s:any)=>({...s,globalOutputStart:s.outputStart+chapter.outputStart,globalOutputEnd:s.outputEnd+chapter.outputStart}));
await writeFile(resolve(output,'claim-timeline.json'),JSON.stringify({...ledger,validation,pacingProvenance:{basePlanPath:planPath,basePlanSha256:createHash('sha256').update(planRaw).digest('hex'),pacingPath:pacePath,pacingSha256:createHash('sha256').update(paceRaw).digest('hex'),audioUnchanged:true}},null,2));
console.log(JSON.stringify({planPath:resolve(output,basename(planPath)),duration:validation.duration,sourceWindows:plan.source.windows.length},null,2));
