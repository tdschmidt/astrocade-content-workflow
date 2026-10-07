import {z} from 'zod';
const Id=z.string().regex(/^[a-z][a-z0-9-]{0,40}$/u);
const GameFact=z.object({id:Id,fact:z.string().min(1),evidence:z.discriminatedUnion('kind',[
 z.object({kind:z.literal('description'),url:z.url(),excerpt:z.string().min(10)}),
 z.object({kind:z.literal('gameplay'),sourcePath:z.string().min(1),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/u),start:z.number().nonnegative(),end:z.number().positive(),observation:z.string().min(10)}).refine(e=>e.end>e.start,'Gameplay evidence needs a forward source window'),
])});
export const LedgerSchema=z.object({
 gameTitle:z.string(),gameUrl:z.url(),sourcePath:z.string(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/u),
 gameSummary:z.string().optional(),gameFacts:z.array(GameFact).default([]),
 chapters:z.array(z.object({id:Id,allowedStart:z.number().nonnegative(),allowedEnd:z.number().positive(),maxSpokenWords:z.number().int().positive().optional(),preserveFullWindow:z.boolean().optional(),facts:z.array(z.object({id:Id,fact:z.string()})).min(1)}).passthrough()).min(2).max(6),
 avoidSpokenGameTitle:z.boolean().default(false),spokenAvoidPhrases:z.array(z.string()).default([]),
 wordRange:z.tuple([z.number().int().positive(),z.number().int().positive()]).default([80,95]),
 crop:z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}).optional(),
}).passthrough().superRefine((ledger,ctx)=>{
 const ids=[...ledger.gameFacts,...ledger.chapters.flatMap(c=>c.facts)].map(f=>f.id);
 if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'Fact IDs must be unique across the whole game ledger'});
});
const Hook=z.object({id:Id,text:z.string().min(5).max(180),factIds:z.array(Id).min(1),firstShotFactIds:z.array(Id).min(1),firstShotEvidence:z.string().min(10),scores:z.object({specificity:z.number().int().min(1).max(5),curiosity:z.number().int().min(1).max(5),pictureMatch:z.number().int().min(1).max(5)}),rationale:z.string()});
export const DraftSchema=z.object({version:z.literal(1),title:z.string(),hooks:z.array(Hook).length(3).optional(),selectedHookId:Id.optional(),chapters:z.array(z.object({id:Id,sourceStart:z.number().nonnegative(),sourceEnd:z.number().positive(),narration:z.string(),claims:z.array(z.object({claim:z.string(),factIds:z.array(Id),opinion:z.boolean()})),rationale:z.string()})).min(2).max(6),rationale:z.string()});
export const GeneratedDraftSchema=DraftSchema.extend({hooks:z.array(Hook).length(3),selectedHookId:Id});
export type Ledger=z.infer<typeof LedgerSchema>;
export type Draft=z.infer<typeof DraftSchema>;
export function draftIssues(draft:Draft,ledger:Ledger,requireHook=false):string[]{
 const issues:string[]=[];
 const ids=new Set([...ledger.gameFacts,...ledger.chapters.flatMap(c=>c.facts)].map(f=>f.id));
 const speech=draft.chapters.map(c=>c.narration).join(' ').toLowerCase();
 if(ledger.avoidSpokenGameTitle&&speech.includes(ledger.gameTitle.toLowerCase()))issues.push('Game title must stay in metadata, not narration');
 for(const phrase of ledger.spokenAvoidPhrases)if(speech.includes(phrase.toLowerCase()))issues.push(`Forbidden editorial phrasing: ${phrase}`);
 const count=draft.chapters.map(c=>c.narration).join(' ').trim().split(/\s+/u).length;
 if(count<ledger.wordRange[0]||count>ledger.wordRange[1])issues.push(`Total words ${count}, expected ${ledger.wordRange.join('–')}`);
 if(draft.chapters.length!==ledger.chapters.length)issues.push('Chapter count differs from ledger');
 draft.chapters.forEach((c,i)=>{const l=ledger.chapters[i];if(!l){issues.push('Unexpected chapter');return;}if(l.maxSpokenWords&&c.narration.trim().split(/\s+/u).length>l.maxSpokenWords)issues.push(`${c.id} exceeds its ${l.maxSpokenWords}-word footage budget`);if(l.preserveFullWindow&&(Math.abs(c.sourceStart-l.allowedStart)>1e-6||Math.abs(c.sourceEnd-l.allowedEnd)>1e-6))issues.push(`${c.id} must preserve its preselected complete action window`);if(c.id!==l.id||c.sourceStart<l.allowedStart-1e-6||c.sourceEnd>l.allowedEnd+1e-6||c.sourceStart>=c.sourceEnd)issues.push(`Invalid ${c.id} identity/window`);if(!c.claims.length||c.claims.some(claim=>!claim.opinion&&(!claim.factIds.length||claim.factIds.some(id=>!ids.has(id)))))issues.push(`Ungrounded ${c.id} claim`);});
 if(requireHook||draft.hooks||draft.selectedHookId){
  if(!draft.hooks||!draft.selectedHookId)return [...issues,'Three ranked hooks and selectedHookId are required'];
  const openingIds=new Set(ledger.chapters[0]!.facts.map(f=>f.id));
  if(new Set(draft.hooks.map(h=>h.id)).size!==3)issues.push('Hook IDs must be unique');
  for(const h of draft.hooks){
   if(h.factIds.some(id=>!ids.has(id)))issues.push('Hook claim references unknown game facts');
   if(h.firstShotFactIds.some(id=>!openingIds.has(id)))issues.push('First-shot evidence references unknown or non-opening facts');
  }
  const selected=draft.hooks.find(h=>h.id===draft.selectedHookId);
  const score=(h:z.infer<typeof Hook>)=>Object.values(h.scores).reduce((a,b)=>a+b,0);
  if(!selected)issues.push('Selected hook does not exist');
  else {if(!draft.chapters[0]?.narration.startsWith(selected.text))issues.push('Opening narration must begin verbatim with the selected hook');if(score(selected)<Math.max(...draft.hooks.map(score)))issues.push('Selected hook is not the highest-scoring candidate');}
 }
 return issues;
}
