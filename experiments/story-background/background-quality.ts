import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {StoryPlanSchema} from './schema.js';

// A semantic reviewer supplies these observations after watching the selection.
// File uniqueness or absence of visible deaths cannot establish satisfying play.
export const ProgressionReviewSchema=z.object({
 decision:z.enum(['accept','reject']),watchedWholeSelection:z.boolean(),
 engagementSummary:z.string().min(20),repeatedFailureLoop:z.boolean(),
 spans:z.array(z.object({
  start:z.number().nonnegative(),end:z.number().positive(),
  sectionId:z.string().min(1),attemptId:z.string().min(1),
  outcome:z.enum(['progress','retry','failure','stalled']),evidence:z.string().min(10),
 })).min(1),
});
export type ProgressionReview=z.infer<typeof ProgressionReviewSchema>;
export function assertProgressionReview(review:ProgressionReview,duration:number):void{
 if(!Number.isFinite(duration)||duration<=0)throw new Error('Background duration must be positive');
 if(review.decision!=='accept'||!review.watchedWholeSelection||review.repeatedFailureLoop)throw new Error('Background needs an accepted whole-selection progression review, not just unique frames or hidden falls');
 let end=0;const attempts=new Map<string,string>();const tolerance=2/30+1e-6;
 for(const span of review.spans){
  if(span.end<=span.start||Math.abs(span.start-end)>tolerance||span.end>duration+tolerance)throw new Error('Progression review must cover the selected output timeline in order without gaps');
  if(span.outcome!=='progress')throw new Error('Select engaging progression instead of failed attempts, retries or stalled movement');
  const prior=attempts.get(span.sectionId);
  if(prior!==undefined&&prior!==span.attemptId)throw new Error(`Repeated attempt at section ${span.sectionId}; different recordings and hidden falls do not make new progress`);
  attempts.set(span.sectionId,span.attemptId);end=span.end;
 }
 if(Math.abs(end-duration)>tolerance)throw new Error('Progression review does not cover the complete background duration');
}
export const BackgroundSchema=z.object({
 sourcePath:z.string(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/u),gameTitle:z.string(),
 matchesExactReferenceGenre:z.boolean(),genreLimit:z.string(),
 segments:z.array(z.object({sourceStart:z.number().nonnegative(),sourceEnd:z.number().positive(),speed:z.number().positive()}).refine(s=>s.sourceEnd>s.sourceStart)).min(1),
 crop:z.object({x:z.number().int(),y:z.number().int(),width:z.number().int(),height:z.number().int()}).optional(),
 caption:StoryPlanSchema.shape.caption.optional(),progressionReview:ProgressionReviewSchema,
});
export async function readReviewedBackground(path:string){
 const raw=JSON.parse(await readFile(path,'utf8'));
 if(!raw.progressionReview)throw new Error('Background needs a new progressionReview before generation; historical technical QA is insufficient');
 const background=BackgroundSchema.parse(raw);
 assertProgressionReview(background.progressionReview,background.segments.reduce((sum,s)=>sum+(s.sourceEnd-s.sourceStart)/s.speed,0));
 const hash=createHash('sha256');for await(const chunk of createReadStream(background.sourcePath))hash.update(chunk);
 if(hash.digest('hex')!==background.sourceSha256)throw new Error('Background has changed since its editorial review');
 return background;
}
