import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {CodexServices} from '../../src/server/providers/codex.js';
const [candidateArg,outArg]=process.argv.slice(2);if(!candidateArg||!outArg)throw new Error('Usage: choose-shots.ts CANDIDATES.json NEW_OUTPUT_DIR');
const raw=await readFile(resolve(candidateArg),'utf8'),candidates=JSON.parse(raw),output=resolve(outArg);await mkdir(output);
const media=await Promise.all(candidates.evidenceImages.map(async(path:string)=>({type:'image' as const,mime_type:'image/jpeg',data:(await readFile(resolve(path))).toString('base64')})));
const schema=z.object({title:z.string(),angle:z.string(),openingReason:z.string(),chapters:z.array(z.object({id:z.string(),shots:z.array(z.object({id:z.string(),start:z.number(),end:z.number()})).min(1).max(5),rationale:z.string()})).min(2).max(4),rejectedAlternatives:z.string()});
const prompt=`You are the creative shot-selection agent for a NEW best-effort30–45second game overview. Compare the actual timestamped contact sheets. Select/order exactly three coherent chapters from the modules below. Use the supplied game description and whole-game evidence to identify the premise, player choices and appeal. Choose interesting opening motion and representative gameplay that supports that narrative, with a satisfying final sequence. The writer must explain what the game is, not recite these shots. This must be a short idea with progression, not a roll call of every form. You may use only the declared shots, preserving essential action moments and the setup-to-result sequence inside each module. Pick exact in/out within bounds; no duplicated windows. At least one brief native choice moment must remain as context when the supplied modules concern character selection. Include all key abilities for a selected module. The centered native aim prompt during selection is unavoidable source UI; keep it brief and never include aim-obstructed active play. Use only cuts that maintain engagement and real motion; no frozen frames. Explain choice without inventing missions, target hits, time powers, or maximum speed. This stage selects footage only; another real agent writes/ranks hooks and narration from the selected evidence. Return JSON only.\nCANDIDATES\n${raw}`;
await writeFile(resolve(output,'prompt.txt'),prompt);
const events:unknown[]=[];const provider=new CodexServices({reasoningModel:'default'},e=>{events.push(e);process.stderr.write(JSON.stringify(e)+'\n');});
try{const choice=await provider.json(prompt,schema,media);await writeFile(resolve(output,'response.json'),JSON.stringify(choice,null,2));
 const used=new Set<string>();let hasMenu=false;
 if(choice.chapters.length!==3)throw new Error('Exactly three chapters required');
 for(const chapter of choice.chapters){const module=candidates.modules.find((m:any)=>m.id===chapter.id);if(!module||used.has(chapter.id))throw new Error('Unknown/repeated module');used.add(chapter.id);
  for(const shot of chapter.shots){const allowed=module.shots.find((s:any)=>s.id===shot.id);if(!allowed||shot.start<allowed.start||shot.end>allowed.end||shot.end<=shot.start)throw new Error('Unapproved shot bounds');if(allowed.essentialMoment&&(shot.start>allowed.essentialMoment[0]||shot.end<allowed.essentialMoment[1]))throw new Error('Trim removes key event');if(allowed.kind==='menu')hasMenu=true;}
  if(module.shots.filter((s:any)=>s.required).some((s:any)=>!chapter.shots.some((shot:any)=>shot.id===s.id)))throw new Error('Missing required action');
 }
 if(!hasMenu)throw new Error('Native choice context is required');
 await writeFile(resolve(output,'selection.json'),JSON.stringify({...choice,candidatesPath:resolve(candidateArg)},null,2));
}finally{await writeFile(resolve(output,'provider-events.json'),JSON.stringify(events,null,2));}
