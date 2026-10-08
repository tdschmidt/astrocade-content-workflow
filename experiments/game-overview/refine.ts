import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {CodexServices} from '../../src/server/providers/codex.js';
import {DraftSchema,LedgerSchema,draftIssues} from './contracts.js';
const [inputArg,outputArg,ledgerArg,feedbackArg]=process.argv.slice(2);
if(!inputArg||!outputArg)throw new Error('Usage: refine.ts EVIDENCE_LED_DRAFT.json NEW_OUTPUT_DIR [LEDGER.json] [FEEDBACK.json]');
const inputPath=resolve(inputArg),output=resolve(outputArg),raw=await readFile(inputPath,'utf8'),draft=DraftSchema.parse(JSON.parse(raw));
const ledger=LedgerSchema.parse(JSON.parse(await readFile(resolve(ledgerArg??'experiments/game-overview/source-ledger.json'),'utf8')));
await mkdir(output);
const feedback=feedbackArg?await readFile(resolve(feedbackArg),'utf8'):'';
const prompt=`Perform a wording-only revision of this evidence-reviewed game overview. Keep every source window, claim and factual scope unchanged. Return ${draft.chapters.length} narration strings in order, totaling ${ledger.wordRange.join('–')} words. Keep any selected hook verbatim at the start of chapter one; it has already been ranked for the whole-game premise and relevant opening image. Explain the game, player choices and appeal rather than narrating individual movements; facts need not be demonstrated by the shot playing during that sentence. Do not invent a broader premise that is absent from the fixed verified claims. Use conversational specific language, no fictional personal experience or unseen goals/features. Do not turn the hook into a generic overview. Return only narration strings, no new hooks or instructions.\n\nLEDGER\n${JSON.stringify(ledger)}\n\nVERIFIED DRAFT\n${raw}\n\nSPECIFIC REVIEW TO APPLY\n${feedback}`;
await writeFile(resolve(output,'prompt.txt'),prompt);
await writeFile(resolve(output,'request.json'),JSON.stringify({inputPath,inputSha256:createHash('sha256').update(raw).digest('hex'),provider:'CodexServices',modelSetting:'default',mode:'wording-only; existing observed facts and source windows are immutable',promptSha256:createHash('sha256').update(prompt).digest('hex')},null,2));
const events:unknown[]=[];const provider=new CodexServices({reasoningModel:'default'},e=>{events.push(e);process.stderr.write(JSON.stringify(e)+'\n');});
try{
 let request=prompt;
 for(let attempt=1;attempt<=2;attempt++){
  const response=await provider.json(request,z.object({narrations:z.array(z.string()).length(draft.chapters.length)}));
  await writeFile(resolve(output,`response-${attempt}.json`),JSON.stringify(response,null,2));
  draft.chapters.forEach((chapter,i)=>{chapter.narration=response.narrations[i]!;});
  const issues=draftIssues(draft,ledger);
  if(!issues.length)break;
  if(attempt===2)throw new Error(issues.join('; '));
  request=prompt+`\n\nCorrect only these rejected narration details: ${JSON.stringify(response)}\nValidation issues: ${issues.join('; ')}`;
  await writeFile(resolve(output,'repair-prompt.txt'),request);
 }
 draft.rationale+=' Wording refined by a second saved CodexServices request; source windows and fact ledger retained.';
 await writeFile(resolve(output,'draft.json'),JSON.stringify(draft,null,2));
 await writeFile(resolve(output,'script.txt'),draft.chapters.map(c=>c.narration).join('\n\n')+'\n');
}finally{await writeFile(resolve(output,'provider-events.json'),JSON.stringify(events,null,2));}
console.log(resolve(output,'draft.json'));
