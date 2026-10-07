import { sourceSeekArgs, sourceWindowVideoFilter } from '../../src/server/media/source-window.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runProcess} from '../../src/server/media/process.js';
import {mediaExecutables,probeMedia} from '../../src/server/media/probe.js';
const [selectionArg,outArg,ledgerArg]=process.argv.slice(2);if(!selectionArg||!outArg||!ledgerArg)throw new Error('Usage: prepare-selected.ts SELECTION.json NEW_SOURCE_DIR NEW_LEDGER.json');
const selection=JSON.parse(await readFile(resolve(selectionArg),'utf8')),c=JSON.parse(await readFile(selection.candidatesPath,'utf8')),output=resolve(outArg);await mkdir(output);
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const source=resolve(c.sourcePath),sourceHash=sha(await readFile(source));if(sourceHash!==c.sourceSha256)throw new Error('Original source changed');
const {ffmpeg}=mediaExecutables(),clips:any[]=[],chapters:any[]=[];let offset=0;
for(const chapter of selection.chapters){const module=c.modules.find((m:any)=>m.id===chapter.id),allowedStart=offset;
 for(const shot of chapter.shots){const allowed=module.shots.find((s:any)=>s.id===shot.id);if(!allowed||shot.start<allowed.start||shot.end>allowed.end)throw new Error('Out-of-bounds selection');const count=Math.round((shot.end-shot.start)*30),duration=count/30,path=resolve(output,`${clips.length}-${shot.id}.mp4`);
  const args=['-hide_banner','-loglevel','error','-nostdin','-n',...sourceSeekArgs(shot.start),'-i',source,'-an','-vf',`${sourceWindowVideoFilter(duration)},setsar=1`,'-frames:v',String(count),'-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p',path];
  await runProcess(ffmpeg,args,{timeoutMs:120000});clips.push({chapterId:chapter.id,id:shot.id,kind:allowed.kind,originalPath:source,originalSha256:sourceHash,originalStart:shot.start,originalEnd:shot.start+duration,derivedStart:offset,derivedEnd:offset+duration,frameCount:count,path,sha256:sha(await readFile(path)),command:[ffmpeg,...args]});offset+=duration;
 }
 const hasMenu=chapter.shots.some((s:any)=>module.shots.find((a:any)=>a.id===s.id).kind==='menu');
 const facts=module.facts.filter((f:any)=>hasMenu||!f.id.endsWith('-choice'));
 chapters.push({id:chapter.id,allowedStart,allowedEnd:offset,shots:clips.filter(s=>s.chapterId===chapter.id).map(({id,kind,derivedStart,derivedEnd,originalStart,originalEnd})=>({id,kind,derivedStart,derivedEnd,originalStart,originalEnd})),facts,framing:chapter.rationale,spokenWordTarget:module.wordTarget,unsupportedClaims:module.limits});
}
const concat=resolve(output,'concat.txt');await writeFile(concat,clips.map(x=>`file '${x.path}'`).join('\n')+'\n');const path=resolve(output,'selected-feature-source.mp4');await runProcess(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-n','-f','concat','-safe','0','-i',concat,'-c','copy',path],{timeoutMs:120000});
const sourceInfo=await probeMedia(path),derivedSha=sha(await readFile(path));
await writeFile(resolve(output,'provenance.json'),JSON.stringify({selectionPath:resolve(selectionArg),sourcePath:source,sourceSha256:sourceHash,derivedPath:path,derivedSha256:derivedSha,durationSeconds:sourceInfo.durationSeconds,clips,policy:'Actual shot-selection agent ordered and trimmed declared original gameplay windows. Derived source only hard-cuts them, with no titles, graphics, audio, fabricated outcomes or repeated source windows.'},null,2));
const ledger={gameTitle:c.gameTitle,gameUrl:c.gameUrl,gameSummary:c.gameSummary,gameFacts:c.gameFacts??[],sourcePath:path,sourceSha256:derivedSha,crop:c.crop,sourceProvenance:resolve(output,'provenance.json'),angle:selection.angle,openingReason:selection.openingReason,wordRange:[80,90],avoidSpokenGameTitle:false,spokenAvoidPhrases:['sampled abilities','recorded sessions','overview montage','without demonstrating','cyan-and-white','pale ring','close-range tools'],chapters,editorialBrief:'Explain the game premise, player role, choices and appeal from the whole reviewed game and sourced description. Open with a specific curiosity hook over relevant gameplay. Selected shots support the narrative; do not make the script a description of each movement or animation. Do not recite a character roster. Natural conversational voice at1x; respect per-chapter word targets because footage cannot be frozen to cover long speech. No audit/production language, health/color inventories, invented combat goals, or fake personal experience. Existing native menu/aim text is not a renderer overlay. Metadata holds caveats, narration names actions positively.'};
await writeFile(resolve(ledgerArg),JSON.stringify(ledger,null,2));console.log(JSON.stringify({path,ledgerPath:resolve(ledgerArg),duration:sourceInfo.durationSeconds,chapters:chapters.map(x=>({id:x.id,start:x.allowedStart,end:x.allowedEnd}))},null,2));
