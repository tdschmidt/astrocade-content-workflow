import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {CodexServices} from '../../src/server/providers/codex.js';
const here=dirname(fileURLToPath(import.meta.url));
const Draft=z.object({version:z.literal(1),title:z.string().min(1).max(100),narration:z.string().min(50).max(1600),attribution:z.string().min(1).max(80),evidence:z.array(z.object({sentence:z.string(),beatIds:z.array(z.string()),commentary:z.boolean()})),rationale:z.string().max(1500)});
const count=(s:string)=>s.trim().split(/\s+/u).length;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function writeStory(sourcePath:string,output:string,options:{model?:string;signal?:AbortSignal;feedback?:string}={}) {
 const sourceText=await readFile(sourcePath,'utf8'),source=JSON.parse(sourceText);
 const system=await readFile(resolve(here,'prompts/story-writer.md'),'utf8');
 await mkdir(dirname(output),{recursive:true}); await mkdir(output);
 const prompt=`${system}\n\nSOURCE FACT LEDGER\n${sourceText}\n\nEDITORIAL FEEDBACK\n${options.feedback??''}\n\nReturn a complete draft. Use the ledger's grounded beat IDs in evidence. Narration90–110words; attribution must identify the author and community when source_type=public_reddit_post.`;
 await writeFile(resolve(output,'prompt.txt'),prompt,{flag:'wx'});
 await writeFile(resolve(output,'request.json'),JSON.stringify({createdAt:new Date().toISOString(),sourcePath:resolve(sourcePath),sourceSha256:hash(sourceText),source,systemSha256:hash(system),provider:'CodexServices',model:options.model??'default'},null,2));
 const events:unknown[]=[];
 const provider=new CodexServices({reasoningModel:options.model??'default'},e=>{events.push(e);process.stderr.write(JSON.stringify(e)+'\n');});
 let repair='';
 try {for(let attempt=1;attempt<=2;attempt++){
   const draft=await provider.json(prompt+repair,Draft,[],options.signal);
   await writeFile(resolve(output,`response-${attempt}.json`),JSON.stringify(draft,null,2));
   const ids=new Set((source.grounded_beats??[]).map((b:{id:string})=>b.id));
   const issues=[];
   if(/https?:?|www\./iu.test(draft.attribution))issues.push('Attribution must be a compact complete author/community credit without a URL.');
   if(/\bEditorially\b/iu.test(draft.narration))issues.push('Keep production commentary labels out of the spoken narration.');
   if(count(draft.narration)<90||count(draft.narration)>110)issues.push(`Narration has ${count(draft.narration)}words; require90–110.`);
   if(draft.evidence.some(e=>!e.commentary&&(!e.beatIds.length||e.beatIds.some(id=>!ids.has(id)))))issues.push('Factual evidence entries need valid grounded beat IDs.');
   if(source.source_type==='public_reddit_post'&&!/reddit/i.test(draft.narration))issues.push('Attribute the spoken account to a Reddit user.');
   if(!issues.length){await writeFile(resolve(output,'draft.json'),JSON.stringify(draft,null,2));await writeFile(resolve(output,'script.txt'),draft.narration+'\n');return draft;}
   if(attempt===2)throw new Error(issues.join(' '));
   repair=`\n\nRevise the full draft to fix these validation issues:${issues.join(' ')}\nPrevious draft:${JSON.stringify(draft)}`;
   await writeFile(resolve(output,'repair-prompt.txt'),prompt+repair);
 }} catch(error){await writeFile(resolve(output,'error.json'),JSON.stringify({message:error instanceof Error?error.message:String(error)}));throw error;}
 finally{await writeFile(resolve(output,'inference-events.json'),JSON.stringify(events,null,2));}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[source,out]=process.argv.slice(2);if(!source||!out)throw new Error('Usage: node --import tsx experiments/story-background/agent.ts SOURCE.json NEW_OUTPUT_DIR');
 writeStory(resolve(source),resolve(out)).then(()=>console.log(resolve(out,'draft.json'))).catch(e=>{console.error(e instanceof Error?e.message:'Story generation failed');process.exitCode=1;});
}
