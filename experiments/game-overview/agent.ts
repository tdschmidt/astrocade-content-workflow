import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {GeneratedDraftSchema,LedgerSchema,draftIssues} from './contracts.js';
import {CodexServices} from '../../src/server/providers/codex.js';
import {extractVideoFrames} from '../../src/server/media/frames.js';
import type {ContentBrief} from '../../src/shared/content.js';
import type {MediaInput} from '../../src/server/providers/inference.js';
export async function writeOverview(options:{output:string;ledgerPath:string;model?:string;feedbackPath?:string;brief?:ContentBrief;signal?:AbortSignal}){
const output=resolve(options.output),ledgerPath=resolve(options.ledgerPath);
options.signal?.throwIfAborted();
await mkdir(output);
const ledgerText=await readFile(ledgerPath,'utf8'),ledger=LedgerSchema.parse(JSON.parse(ledgerText));
const system=await readFile('experiments/game-overview/prompts/editor.md','utf8');
const sourcePath=resolve(ledger.sourcePath),sourceHash=createHash('sha256').update(await readFile(sourcePath)).digest('hex');
if(sourceHash!==ledger.sourceSha256)throw new Error('Source hash changed');
const media:MediaInput[]=[],timestamps:string[]=[];
for(const chapter of ledger.chapters){
 const frames=await extractVideoFrames(sourcePath,resolve(output,`frames-${chapter.id}`),{fps:2,start_offset:`${chapter.allowedStart}s`,end_offset:`${chapter.allowedEnd}s`},{},options.signal);
 await writeFile(resolve(output,`frames-${chapter.id}.json`),JSON.stringify(frames,null,2));
 for(const f of frames.frames){media.push({type:'image',mime_type:'image/jpeg',data:(await readFile(f.path)).toString('base64')});timestamps.push(`Image${media.length}: ${chapter.id}, absolute source${f.sourceSeconds.toFixed(6)}s`);}
}
const feedback=options.feedbackPath?await readFile(resolve(options.feedbackPath),'utf8'):'';
const prompt=`${system}\n\nCONTENT BRIEF\n${JSON.stringify(options.brief??{})}\n\nLEDGER\n${ledgerText}\n\nIMAGE TIMESTAMPS\n${timestamps.join('\n')}\n\nEDITORIAL REVIEW TO APPLY\n${feedback}`;
await writeFile(resolve(output,'prompt.txt'),prompt);
await writeFile(resolve(output,'request.json'),JSON.stringify({ledgerPath,ledgerSha256:createHash('sha256').update(ledgerText).digest('hex'),sourcePath,sourceHash,frameCount:media.length,provider:'CodexServices',modelSetting:options.model??'default',promptSha256:createHash('sha256').update(prompt).digest('hex')},null,2));
const events:unknown[]=[];const provider=new CodexServices({reasoningModel:options.model??'default'},e=>{events.push(e);process.stderr.write(JSON.stringify(e)+'\n');});
try{
 let request=prompt;
 for(let attempt=1;attempt<=2;attempt++){
  const draft=await provider.json(request,GeneratedDraftSchema,media,options.signal);await writeFile(resolve(output,`response-${attempt}.json`),JSON.stringify(draft,null,2));
  const issues=draftIssues(draft,ledger,true);
  if(!issues.length){await writeFile(resolve(output,'draft.json'),JSON.stringify(draft,null,2));await writeFile(resolve(output,'script.txt'),draft.chapters.map(c=>c.narration).join('\n\n')+'\n');break;}
  if(attempt===2)throw new Error(issues.join('; '));request=prompt+`\nCorrect this draft completely: ${JSON.stringify(draft)}\nIssues:${issues.join('; ')}`;await writeFile(resolve(output,'repair-prompt.txt'),request);
 }
}finally{await writeFile(resolve(output,'provider-events.json'),JSON.stringify(events,null,2));}
return resolve(output,'draft.json');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 console.log(await writeOverview({output:process.argv[2]??'data/experiments/game-overview/draft-v1',ledgerPath:process.argv[3]??'experiments/game-overview/source-ledger.json',feedbackPath:process.argv[4]}));
}
