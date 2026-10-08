import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {probeMedia} from '../../src/server/media/probe.js';
import {speechTranscriptWarnings} from '../story-background/speech-validation.js';
import {groupWords,type Word} from '../story-background/schema.js';

// Explicit local revalidation for ASR quantization, never a timing repair.
const chapterDir=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Usage: recover-phrase.ts FAILED_VOICE_CHAPTER_DIR');
const request=JSON.parse(await readFile(resolve(chapterDir,'request.json'),'utf8'));
const original=JSON.parse(await readFile(resolve(chapterDir,'validation.json'),'utf8'));
const transcript=JSON.parse(await readFile(resolve(chapterDir,'transcript-1.json'),'utf8'));
const audioPath=resolve(chapterDir,'narration.wav'),info=await probeMedia(audioPath);
const audioSha256=createHash('sha256').update(await readFile(audioPath)).digest('hex');
if(audioSha256!==original.audioSha256)throw new Error('Saved narration hash changed');
const words:Word[]=transcript.words.map((w:any)=>({text:w.text.trim(),start:w.startSeconds,end:w.endSeconds}));
const issues=speechTranscriptWarnings(request.script,transcript.text);
let previousEnd=0;
for(const word of words){
 if(!/^\S+$/u.test(word.text)||![word.start,word.end].every(Number.isFinite)||word.start<previousEnd-1e-6||word.end<word.start||word.end>info.durationSeconds+.04)issues.push('Invalid real provider word span');
 previousEnd=word.end;
}
if(!words.some(w=>w.start===w.end))throw new Error('This recovery applies only to zero-duration provider words');
if(groupWords(words,3).some(g=>g.end<=g.start))issues.push('A complete phrase has no positive span');
if(issues.length)throw new Error(issues.join('; '));
const record={audioPath,audioSha256,policy:'Explicit phrase-only acceptance of provider-quantized zero-duration words. Retain original timestamps; positive nonoverlapping phrase spans required.',zeroLengthProviderWords:words.filter(w=>w.start===w.end),transcriptWarnings:issues,sourceTranscript:resolve(chapterDir,'transcript-1.json'),speechRegenerated:false,timestampsModified:false,listeningReviewPerformed:false};
await writeFile(resolve(chapterDir,'phrase-revalidation.json'),JSON.stringify(record,null,2),{flag:'wx'});
await writeFile(resolve(chapterDir,'narration.json'),JSON.stringify({path:audioPath,script:request.script,voiceLabel:`${request.synthesis?.voiceLabel??`${request.voice} / ${request.speechModel}`}${request.tempo.multiplier===1?'':` / ${request.tempo.multiplier}× tempo (pitch preserved)`}`,words,alignmentMethod:`${request.transcriptionModel} final-audio timestamps; quantized zero-duration words retained for phrase-only captions; no estimated boundaries`},null,2),{flag:'wx'});
console.log(JSON.stringify(record,null,2));
