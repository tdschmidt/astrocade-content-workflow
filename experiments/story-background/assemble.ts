import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {probeMedia} from '../../src/server/media/probe.js';
import {StoryPlanSchema,validateStoryPlan} from './schema.js';
import {storyTools,validateSourceCrop} from './render.js';
import {readReviewedBackground} from './background-quality.js';

const readJson=async(path:string)=>JSON.parse(await readFile(path,'utf8'));

export async function assemble(sourcePath:string,draftPath:string,narrationPath:string,backgroundPath:string,output:string) {
 const background=await readReviewedBackground(backgroundPath);
 const[source,draft,narration]=await Promise.all([sourcePath,draftPath,narrationPath].map(readJson));
 if(narration.script!==draft.narration)throw new Error('Narration does not belong to this exact draft');
 const plan=StoryPlanSchema.parse({version:1,id:`${source.id}-story`,title:draft.title,
  source:{path:resolve(background.sourcePath),crop:background.crop,windows:background.segments.map(s=>({start:s.sourceStart,end:s.sourceEnd,speed:s.speed}))},
  narration,story:{kind:source.source_type==='public_reddit_post'?'reddit':'information',title:source.title,permalink:source.url,attribution:draft.attribution},
  caption:background.caption??{position:'upper-middle',wordsPerGroup:4,mode:'highlight'},
  rationale:`Agent-written narration from the cited source fact ledger. Background: ${background.gameTitle}. ${background.genreLimit} Gameplay is unrelated visual background. Windows and crop were selected by the footage scout from real source frames; no loops or generated gameplay.`,
 });
 const[video,audio]=await Promise.all([probeMedia(plan.source.path,storyTools()),probeMedia(plan.narration.path,storyTools())]);
 if(!video.video||!audio.audio)throw new Error('Missing source video or narration audio');
 validateSourceCrop(plan.source.crop,video.video.width,video.video.height);
 validateStoryPlan(plan,video.durationSeconds,audio.durationSeconds);
 await mkdir(dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 return plan;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[source,draft,narration,background,out]=process.argv.slice(2);
 if(!source||!draft||!narration||!background||!out)throw new Error('Usage: node --import tsx experiments/story-background/assemble.ts SOURCE.json DRAFT.json NARRATION.json BACKGROUND.json NEW_PLAN.json');
 await assemble(...[source,draft,narration,background,out].map(p=>resolve(p)) as [string,string,string,string,string]);
 console.log(resolve(out));
}
