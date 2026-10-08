import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {writeStory} from './agent.js';
import {reviewStory} from './review.js';
import {narrate} from './narrate.js';
import {assemble} from './assemble.js';
import {renderStory} from './render.js';
import {readReviewedBackground} from './background-quality.js';

const[sourceArg,backgroundArg,outputArg,tempoArg='1.16']=process.argv.slice(2);
if(!sourceArg||!backgroundArg||!outputArg)throw new Error('Usage: node --import tsx experiments/story-background/run.ts SOURCE.json REVIEWED_BACKGROUND.json NEW_OUTPUT_DIR [VOICE_TEMPO=1.16]');
const source=resolve(sourceArg),background=resolve(backgroundArg),output=resolve(outputArg),tempo=Number(tempoArg);
if(!Number.isFinite(tempo)||tempo<0.9||tempo>1.2)throw new Error('Voice tempo must be0.9–1.2; regenerate the script or voice for larger duration changes');
// Reject unsuitable/stale backgrounds before spending on a script or narration.
await readReviewedBackground(background);
await mkdir(dirname(output),{recursive:true});await mkdir(output);
try{
 await writeStory(source,resolve(output,'draft'));
 const draft=resolve(output,'draft/draft.json');
 await reviewStory(source,draft,resolve(output,'script-review.json'));
 await narrate(draft,resolve(output,'voice'),{tempo});
 const plan=resolve(output,'plan.json'),video=resolve(output,'story.mp4');
 await assemble(source,draft,resolve(output,'voice/narration.json'),background,plan);
 await renderStory({planPath:plan,outputPath:video});
 await writeFile(resolve(output,'review-needed.json'),JSON.stringify({status:'preview-ready',video,source,background,visualReviewRequired:true,listeningReviewRequired:true,published:false},null,2));
 console.log(video);
}catch(error){await writeFile(resolve(output,'error.json'),JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2));throw error;}
