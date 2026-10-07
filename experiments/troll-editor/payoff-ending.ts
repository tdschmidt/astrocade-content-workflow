import {buildTimeline,type EditPlan} from './schema.js';

/** Fresh-job gate only: historical plans remain reproducible by the renderer. */
export function payoffEndingIssues(plan:EditPlan):string[]{
 const timeline=buildTimeline(plan),drop=plan.music.dropAt;
 const tail=(timeline.at(-1)?.outputEnd??0)-drop;
 const moving=timeline.filter(s=>s.kind==='clip').reduce((sum,s)=>sum+Math.max(0,s.outputEnd-Math.max(s.outputStart,drop)),0);
 const issues:string[]=[];
 if(tail<4-1/30)issues.push(`Drop ends after only ${tail.toFixed(2)}s; retain at least 4s and a resolved musical phrase at the actual climax`);
 if(moving<2-1/30)issues.push('Payoff needs at least 2s of moving aftermath; a padded freeze is not an engaging ending');
 return issues;
}
