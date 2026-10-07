import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {CodexServices} from '../../src/server/providers/codex.js';
const [specArg,outArg]=process.argv.slice(2);if(!specArg||!outArg)throw new Error('Usage: pace-chapter.ts SPEC.json NEW_OUTPUT_DIR');
const raw=await readFile(resolve(specArg),'utf8'),spec=JSON.parse(raw),output=resolve(outArg);await mkdir(output);
const narration=JSON.parse(await readFile(resolve(spec.narrationPath),'utf8'));
const schema=z.object({segments:z.array(z.object({sourceStart:z.number(),sourceEnd:z.number(),outputFrames:z.number().int().positive(),rationale:z.string()})).min(2).max(6),rationale:z.string()});
const prompt=`You are the final pacing agent for a game overview. Fit relevant gameplay to the measured native-speed speech without turning it into a literal action report. The narration explains the game, player choices and appeal; picture supports those ideas across the section. Choose chronological nonoverlapping source windows and exact integer output frames at30FPS. Preserve required source moments and their readable causes/consequences. Do not change speech, repeat frames/windows, freeze, reverse or fabricate action. Each resulting video speed=(sourceEnd-sourceStart)/(outputFrames/30) must be0.5–2.0; favor natural speed. Output frame counts must sum exactly to targetFrames. Required moments need exact speech-time alignment ONLY if that moment has syncToSpeech:true, for a specific causal explanation; otherwise retain it without forcing a word/action match. Keep a native choice/menu interval only when the spec declares menuEnd; never stretch menus or settling footage to fill time. Retain the actual source end for the0.3s final fade. Return JSON only.\nSPEC\n${raw}\nACTUAL WORD TIMINGS\n${JSON.stringify(narration)}`;
await writeFile(resolve(output,'prompt.txt'),prompt);
const media=spec.imagePaths?await Promise.all(spec.imagePaths.map(async(path:string)=>({type:'image' as const,mime_type:'image/jpeg',data:(await readFile(resolve(path))).toString('base64')}))):[];
const events:unknown[]=[];const provider=new CodexServices({reasoningModel:'default'},e=>{events.push(e);process.stderr.write(JSON.stringify(e)+'\n');});
try{let request=prompt;
 for(let attempt=1;attempt<=2;attempt++){
 const decision=await provider.json(request,schema,media);await writeFile(resolve(output,`response-${attempt}.json`),JSON.stringify(decision,null,2));
 const issues:string[]=[],mapping:any[]=[];let sourceEnd=spec.allowedStart,outputFrames=0;
 for(const s of decision.segments){const speed=(s.sourceEnd-s.sourceStart)/(s.outputFrames/30);if(s.sourceStart<sourceEnd-1e-6||s.sourceEnd<=s.sourceStart||s.sourceEnd>spec.allowedEnd+1e-6||speed<.5-1e-6||speed>2+1e-6)issues.push('Invalid source bounds/order/speed');mapping.push({...s,speed,outputStart:outputFrames/30,outputEnd:(outputFrames+s.outputFrames)/30});sourceEnd=s.sourceEnd;outputFrames+=s.outputFrames;}
 if(outputFrames!==spec.targetFrames)issues.push(`Output frames ${outputFrames} must equal${spec.targetFrames}`);
 for(const m of spec.requiredMoments??[]){const s=mapping.find(s=>m.source>=s.sourceStart&&m.source<s.sourceEnd);if(!s){issues.push(`Missing moment ${m.id}`);continue;}const t=s.outputStart+(m.source-s.sourceStart)/s.speed;if(m.syncToSpeech===true&&(!Number.isFinite(m.outputMin)||!Number.isFinite(m.outputMax)||t<m.outputMin-1e-6||t>m.outputMax+1e-6))issues.push(`${m.id} lands${t.toFixed(3)} outside${m.outputMin}–${m.outputMax}`);}
 const menu=mapping[0];if(spec.menuEnd!==undefined&&(menu.sourceStart!==spec.allowedStart||Math.abs(menu.sourceEnd-spec.menuEnd)>1e-6||menu.outputEnd<2.5||menu.outputEnd>3.6))issues.push('Keep full native choice at2.5–3.6s');
 if(Math.abs(sourceEnd-spec.allowedEnd)>1e-6)issues.push('Retain real final source end for tail');
 if(!issues.length){await writeFile(resolve(output,'pacing.json'),JSON.stringify({...decision,chapterId:spec.chapterId,targetFrames:spec.targetFrames,segments:mapping,narrationPath:resolve(spec.narrationPath),specPath:resolve(specArg)},null,2));break;}
 if(attempt===2)throw new Error(issues.join('; '));request=prompt+`\nCorrect this proposal: ${JSON.stringify(decision)}\nIssues: ${issues.join('; ')}`;await writeFile(resolve(output,'repair-prompt.txt'),request);
 }
}finally{await writeFile(resolve(output,'provider-events.json'),JSON.stringify(events,null,2));}
