/** Display-only exact-token aliases, preserving raw recognition and all timing spans. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {StoryPlanSchema} from '../story-background/schema.js';
const [planArg,aliasArg,outArg,id]=process.argv.slice(2);if(!planArg||!aliasArg||!outArg||!id)throw new Error('Usage: correct-caption-text.ts PLAN.json ALIASES.json NEW_OUTPUT_DIR NEW_PLAN_ID');
const planPath=resolve(planArg),aliasPath=resolve(aliasArg),output=resolve(outArg),raw=await readFile(planPath,'utf8'),plan=StoryPlanSchema.parse(JSON.parse(raw)),aliases=JSON.parse(await readFile(aliasPath,'utf8'));
const oldWords=structuredClone(plan.narration.words),changed=new Set<number>();
for(const alias of aliases){const w=plan.narration.words[alias.index];if(changed.has(alias.index)||!w||w.text!==alias.original||!/^\S+$/u.test(alias.display)||!alias.reason)throw new Error('Alias must match one exact original token and provide a reason');changed.add(alias.index);w.text=alias.display;}
if(plan.narration.words.some((w,i)=>w.start!==oldWords[i]!.start||w.end!==oldWords[i]!.end))throw new Error('Display aliases cannot alter timing');
plan.id=id;plan.rationale+=' Caption display applies explicit reviewed proper-name spelling/case aliases; original recognition tokens and all timing spans remain preserved in the raw evidence.';StoryPlanSchema.parse(plan);
await mkdir(output);await writeFile(resolve(output,`${id}.json`),JSON.stringify(plan,null,2));
const timeline=JSON.parse(await readFile(resolve(dirname(planPath),'claim-timeline.json'),'utf8'));
await writeFile(resolve(output,'claim-timeline.json'),JSON.stringify({...timeline,captionDisplayAliases:aliases,captionTextOnly:true},null,2));
await writeFile(resolve(output,'caption-alias-provenance.json'),JSON.stringify({sourcePlanPath:planPath,sourcePlanSha256:createHash('sha256').update(raw).digest('hex'),aliasPath,aliases,originalWords:oldWords,displayWords:plan.narration.words,wordCountUnchanged:true,timestampsUnchanged:true,waveformPath:plan.narration.path,waveformSha256:createHash('sha256').update(await readFile(plan.narration.path)).digest('hex'),audioModified:false,rawRecognitionModified:false,method:'Explicit reviewed orthographic display correction to match the approved script; not a new recognition result or an interpolated timing.'},null,2));
console.log(resolve(output,`${id}.json`));
