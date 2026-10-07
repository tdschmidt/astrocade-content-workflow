/** Explicit lexical-only review: no regenerated speech, modified waveform or guessed timestamps. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {probeMedia} from '../../src/server/media/probe.js';
import {canonicalSpeechTokens} from '../story-background/speech-validation.js';
import {groupWords,type Word} from '../story-background/schema.js';
const [directoryArg,aliasesArg]=process.argv.slice(2);
if(!directoryArg||!aliasesArg)throw new Error('Usage: recover-compounds.ts FAILED_CHAPTER_DIR REVIEWED_ALIAS_JSON');
const directory=resolve(directoryArg),aliases=JSON.parse(await readFile(resolve(aliasesArg),'utf8')) as Record<string,string>;
const request=JSON.parse(await readFile(resolve(directory,'request.json'),'utf8'));
const validation=JSON.parse(await readFile(resolve(directory,'validation.json'),'utf8'));
const transcript=JSON.parse(await readFile(resolve(directory,'transcript-1.json'),'utf8'));
const path=resolve(directory,'narration.wav'),info=await probeMedia(path),sha=createHash('sha256').update(await readFile(path)).digest('hex');
if(sha!==validation.audioSha256)throw new Error('Saved waveform changed');
let normalized=transcript.text as string;
for(const [split,joined]of Object.entries(aliases)){
 if(!/^[a-z]+(?: [a-z]+)+$/u.test(split)||!/^[a-z]+$/iu.test(joined)||split.replaceAll(' ','')!==joined.toLowerCase())throw new Error('Aliases must only join explicitly reviewed alphabetic spacing variants');
 normalized=normalized.replace(new RegExp(`\\b${split}\\b`,'giu'),joined);
}
if(JSON.stringify(canonicalSpeechTokens(normalized))!==JSON.stringify(canonicalSpeechTokens(request.script)))throw new Error('Additional substantive transcript differences remain');
const words:Word[]=transcript.words.map((w:any)=>({text:w.text.trim(),start:w.startSeconds,end:w.endSeconds}));
let previous=0;
for(const w of words){if(!/^\S+$/u.test(w.text)||![w.start,w.end].every(Number.isFinite)||w.start<previous-1e-6||w.end<w.start||w.end>info.durationSeconds+.04)throw new Error('Invalid original timing');previous=w.end;}
if(groupWords(words,3).some(g=>g.end<=g.start))throw new Error('Caption phrase must have a positive span');
const record={audioPath:path,audioSha256:sha,aliases,normalizedTranscript:normalized,policy:'Explicit reviewed proper-name/closed-compound spacing equivalence only. Canonical tokens must otherwise match exactly. Captions retain the original recognized tokens and every original timestamp.',audioRegenerated:false,audioModified:false,timestampsModified:false,listeningReviewPerformed:false};
await writeFile(resolve(directory,'compound-revalidation.json'),JSON.stringify(record,null,2),{flag:'wx'});
await writeFile(resolve(directory,'narration.json'),JSON.stringify({path,script:request.script,voiceLabel:`${request.synthesis?.voiceLabel??`${request.voice} / ${request.speechModel}`}${request.tempo.multiplier===1?'':` / ${request.tempo.multiplier}× tempo (pitch preserved)`}`,words,alignmentMethod:`${request.transcriptionModel} actual-audio timestamps; explicit compound spacing review; original words/times retained`},null,2),{flag:'wx'});
console.log(JSON.stringify(record,null,2));
