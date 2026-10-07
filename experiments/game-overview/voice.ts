import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {narrate} from '../story-background/narrate.js';

const [draftArg,outputArg,...flags]=process.argv.slice(2);
if(!draftArg||!outputArg)throw new Error('Usage: node --import tsx experiments/game-overview/voice.ts DRAFT.json NEW_OUTPUT_DIR [--reuse VOICE_DIR] [--tempo 1.1] [--reuse-input VOICE_DIR]');
let reuse:string|undefined,audioLabel:string|undefined,tempo=1,reuseInput=false;
for(let i=0;i<flags.length;i+=2){
 if(!flags[i+1])throw new Error('Missing flag value');
 if(flags[i]==='--reuse')reuse=resolve(flags[i+1]!);
 else if(flags[i]==='--reuse-input'){reuse=resolve(flags[i+1]!);reuseInput=true;}
 else if(flags[i]==='--tempo')tempo=Number(flags[i+1]);
 else if(flags[i]==='--audio-label')audioLabel=flags[i+1];
 else throw new Error('Unknown flag');
}
const draftPath=resolve(draftArg),output=resolve(outputArg);
const draft=JSON.parse(await readFile(draftPath,'utf8'));
await mkdir(output,{recursive:false});
await writeFile(resolve(output,'input-draft.json'),JSON.stringify(draft,null,2));
const results=await Promise.allSettled(draft.chapters.map(async(chapter:{id:string,narration:string})=>{
 const chapterPath=resolve(output,`${chapter.id}-draft.json`);
 await writeFile(chapterPath,JSON.stringify({narration:chapter.narration},null,2));
 return narrate(chapterPath,resolve(output,chapter.id),{tempo,allowZeroLengthWords:true,...(audioLabel?{audioLabel}:{}),...(reuse?{audioPath:resolve(reuse,chapter.id,reuseInput?'input-narration.wav':'narration.wav')}:{})});
}));
await writeFile(resolve(output,'results.json'),JSON.stringify(results.map((r,i)=>({chapter:draft.chapters[i].id,status:r.status,...(r.status==='fulfilled'?{path:r.value}:{error:String(r.reason)})})),null,2));
if(results.some(r=>r.status==='rejected'))throw new Error('At least one chapter failed; review saved audio/transcript evidence before resuming. Do not regenerate to evade a mismatch.');
console.log(output);
