import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {CodexServices} from '../../src/server/providers/codex.js';
import {DraftSchema,LedgerSchema,draftIssues} from './contracts.js';
const [draftArg,ledgerArg,outputArg]=process.argv.slice(2);
if(!draftArg||!ledgerArg||!outputArg)throw new Error('Usage: select-chapters.ts DRAFT.json REDUCED_LEDGER.json NEW_OUTPUT_DIR');
const draft=DraftSchema.parse(JSON.parse(await readFile(resolve(draftArg),'utf8'))),ledger=LedgerSchema.parse(JSON.parse(await readFile(resolve(ledgerArg),'utf8'))),output=resolve(outputArg);
await mkdir(output);
const prompt=`Select only the chapter IDs in this reduced evidence ledger, in order. Preserve the source windows, exact narration, ranked hooks and all other retained chapter fields; the deterministic assembler will copy them byte-for-byte. Omit the missing chapter because its speech provider hit quota, not because its claims are false. The three retained distinct abilities form a complete feature overview. Return keepChapterIds and a truthful rationale for this revised three-power overview. No new narration or facts.\nLEDGER\n${JSON.stringify(ledger)}\nPRIOR DRAFT\n${JSON.stringify(draft)}`;
await writeFile(resolve(output,'prompt.txt'),prompt);
const events:unknown[]=[];const provider=new CodexServices({reasoningModel:'default'},e=>{events.push(e);process.stderr.write(JSON.stringify(e)+'\n');});
try{
 const decision=await provider.json(prompt,z.object({keepChapterIds:z.array(z.string()).min(2).max(6),rationale:z.string()}));
 await writeFile(resolve(output,'response.json'),JSON.stringify(decision,null,2));
 if(JSON.stringify(decision.keepChapterIds)!==JSON.stringify(ledger.chapters.map(c=>c.id)))throw new Error('Selection differs from requested evidenced chapters');
 const chapters=decision.keepChapterIds.map(id=>{const c=draft.chapters.find(c=>c.id===id);if(!c)throw new Error('Unknown chapter');return c;});
 const result={...draft,chapters,rationale:decision.rationale};const issues=draftIssues(result,ledger,true);if(issues.length)throw new Error(issues.join('; '));
 await writeFile(resolve(output,'draft.json'),JSON.stringify(result,null,2));
 await writeFile(resolve(output,'script.txt'),chapters.map(c=>c.narration).join('\n\n')+'\n');
 await writeFile(resolve(output,'selection-provenance.json'),JSON.stringify({draftPath:resolve(draftArg),ledgerPath:resolve(ledgerArg),retainedChaptersUnchanged:true,removedChapters:draft.chapters.filter(c=>!decision.keepChapterIds.includes(c.id)).map(c=>c.id),reason:'Configured TTS model quota exhausted on blades; three complete existing voice recordings retained.'},null,2));
}finally{await writeFile(resolve(output,'provider-events.json'),JSON.stringify(events,null,2));}
