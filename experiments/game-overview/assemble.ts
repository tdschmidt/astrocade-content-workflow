import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DraftSchema,LedgerSchema,draftIssues} from './contracts.js';
import {probeMedia,mediaExecutables} from '../../src/server/media/probe.js';
import {runProcess} from '../../src/server/media/process.js';
import {StoryPlanSchema,validateStoryPlan,type Word} from '../story-background/schema.js';

export async function assembleOverview(options:{draftPath:string;voiceDir:string;output:string;ledgerPath:string;id?:string;position?:'upper-middle'|'lower-middle'|'middle';wordsPerGroup?:number;minDuration?:number;durationNote?:string;signal?:AbortSignal}){
const {signal}=options;
signal?.throwIfAborted();
const id=options.id??'game-overview',position=options.position??'upper-middle',wordsPerGroup=options.wordsPerGroup??3,minDuration=options.minDuration??30,durationNote=options.durationNote??'';
if(!Number.isFinite(minDuration)||minDuration<25||minDuration>30||(minDuration<30&&!durationNote.trim()))throw new Error('A25–30s minimum exception requires a duration note');
const draftPath=resolve(options.draftPath),voiceDir=resolve(options.voiceDir),output=resolve(options.output),ledgerPath=resolve(options.ledgerPath);
const draft=DraftSchema.parse(JSON.parse(await readFile(draftPath,'utf8')));
const voiceDraft=JSON.parse(await readFile(resolve(voiceDir,'input-draft.json'),'utf8'));
if(JSON.stringify(voiceDraft)!==JSON.stringify(draft))throw new Error('Voice input must exactly match the approved generated draft');
const ledgerText=await readFile(ledgerPath,'utf8'),ledger=LedgerSchema.parse(JSON.parse(ledgerText));
const issues=draftIssues(draft,ledger);if(issues.length)throw new Error(issues.join('; '));
const sourcePath=resolve(ledger.sourcePath);
const sourceSha256=createHash('sha256').update(await readFile(sourcePath)).digest('hex');
if(sourceSha256!==ledger.sourceSha256)throw new Error('Source hash changed');
await mkdir(output);
const {ffmpeg}=mediaExecutables();
const words:Word[]=[],chapters:any[]=[],windows:{start:number,end:number,speed:number}[]=[],voiceLabels=new Set<string>();
let offsetFrames=0;
for(const [i,chapter] of draft.chapters.entries()){
 const narration=JSON.parse(await readFile(resolve(voiceDir,chapter.id,'narration.json'),'utf8'));
 if(narration.script!==chapter.narration)throw new Error(`Mismatched ${chapter.id} script`);
 const info=await probeMedia(narration.path,{},signal);
 const frames=Math.ceil((info.durationSeconds+0.1)*30-1e-9);
 const duration=frames/30,offset=offsetFrames/30;
 const padPath=resolve(output,`voice-${chapter.id}.wav`);
 await runProcess(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-n','-i',narration.path,'-af',`aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_len=${frames*1600},atrim=end_sample=${frames*1600},asetpts=PTS-STARTPTS`,'-ar','48000','-ac','1','-c:a','pcm_s16le',padPath],{timeoutMs:60000,signal});
 words.push(...narration.words.map((w:Word)=>({...w,start:w.start+offset,end:w.end+offset})));
 voiceLabels.add(narration.voiceLabel);
 // One extra source frame covers ffprobe's decimal rounding at the final tail.
 const videoDuration=duration+(i===draft.chapters.length-1?0.3+1/30:0);
 const speed=(chapter.sourceEnd-chapter.sourceStart)/videoDuration;
 if(speed<0.5||speed>2)throw new Error(`Chapter ${chapter.id} requires unsupported speed ${speed}; review source selection or measured voice delivery`);
 windows.push({start:chapter.sourceStart,end:chapter.sourceEnd,speed});
 chapters.push({...chapter,outputStart:offset,outputEnd:offset+videoDuration,narrationDuration:info.durationSeconds,paddedNarrationDuration:duration,narrationSource:narration.path,narrationFile:padPath,videoSpeed:speed,wordTimingMethod:narration.alignmentMethod});
 offsetFrames+=frames;
}
await writeFile(resolve(output,'voices.txt'),chapters.map(c=>`file 'voice-${c.id}.wav'`).join('\n')+'\n');
const narrationPath=resolve(output,'narration.wav');
await runProcess(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-n','-f','concat','-safe','1','-i','voices.txt','-c','copy',narrationPath],{cwd:output,timeoutMs:60000,signal});
const narrationInfo=await probeMedia(narrationPath,{},signal),sourceInfo=await probeMedia(sourcePath,{},signal);
if(Math.abs(narrationInfo.durationSeconds-offsetFrames/30)>1/48000)throw new Error('Joined waveform differs from chapter timing ledger');
const plan=StoryPlanSchema.parse({version:1,id,title:draft.title,source:{path:sourcePath,crop:ledger.crop,windows},narration:{path:narrationPath,script:draft.chapters.map((c:{narration:string})=>c.narration).join(' '),voiceLabel:[...voiceLabels].join('; '),words,alignmentMethod:'Actual per-chapter audio recognition with word timestamps; offsets follow measured, frame-aligned WAV joins. No uniform timing estimates.'},story:{kind:'game-overview',title:ledger.gameTitle,permalink:ledger.gameUrl},caption:{position,wordsPerGroup,mode:'phrase',casing:'sentence'},rationale:'Actual CodexServices chapter script and source selection; deterministic assembly fits relevant gameplay to measured voice sections. Claims are grounded across the whole game ledger, not forced to match individual on-screen actions. Short phrase captions receive moving-body obstruction review. No permanent game-name or credit overlay; source/claim evidence stays in metadata.'});
const validation=validateStoryPlan(plan,sourceInfo.durationSeconds,narrationInfo.durationSeconds);
if(validation.duration<minDuration||validation.duration>45)throw new Error(`Overview duration ${validation.duration} is outside permitted${minDuration}–45s; inspect delivery before changing audio`);
await writeFile(resolve(output,`${id}.json`),JSON.stringify(plan,null,2)+'\n');
await writeFile(resolve(output,'claim-timeline.json'),JSON.stringify({draftPath,ledgerPath,ledgerSha256:createHash('sha256').update(ledgerText).digest('hex'),sourcePath,sourceSha256,voiceDir,chapters,durationPolicy:{preferredRange:[30,45],minimumAccepted:minDuration,exceptionReason:durationNote||null},timingPolicy:'Each chapter owns one chronological, unique picture window for assembly, not an exclusive set of permissible spoken facts. Sentence-to-action synchronization is not required. Voice is unchanged and gets <0.134s trailing pad; video speed fits that chapter. Final source coverage adds0.3s plus one guard frame against ffprobe rounding; renderer uses only needed frames and applies its0.3s end fade.',validation},null,2)+'\n');
return {planPath:resolve(output,`${id}.json`),duration:validation.duration,chapters:chapters.map(c=>({id:c.id,outputStart:c.outputStart,outputEnd:c.outputEnd,videoSpeed:c.videoSpeed}))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [draftArg,voiceArg,outputArg,...flags]=process.argv.slice(2);
 if(!draftArg||!voiceArg||!outputArg)throw new Error('Usage: assemble.ts DRAFT.json VOICE_DIR NEW_OUTPUT_DIR [--ledger LEDGER.json]');
 const options:Parameters<typeof assembleOverview>[0]={draftPath:draftArg,voiceDir:voiceArg,output:outputArg,ledgerPath:'experiments/game-overview/source-ledger.json'};
 for(let i=0;i<flags.length;i+=2){const value=flags[i+1];if(!value)throw new Error('Missing flag value');
  switch(flags[i]){case '--id':options.id=value;break;case '--ledger':options.ledgerPath=value;break;case '--caption':if(!['upper-middle','lower-middle','middle'].includes(value))throw new Error('Invalid caption position');options.position=value as 'upper-middle'|'lower-middle'|'middle';break;case '--min-duration':options.minDuration=Number(value);break;case '--duration-note':options.durationNote=value;break;case '--words':options.wordsPerGroup=Number(value);break;default:throw new Error('Unknown flag');}
 }
 console.log(JSON.stringify(await assembleOverview(options),null,2));
}
