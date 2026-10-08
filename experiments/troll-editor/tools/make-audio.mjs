/** Original, deterministic synthesis. No sampled recordings or copied melodies. */
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
const out = resolve(process.argv[2] || 'experiments/troll-editor/assets');
mkdirSync(out, {recursive:true});
const SR=48000, TAU=Math.PI*2;
let seed=76183;
const noise=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2147483648-1;};
const make=(seconds)=>({l:new Float32Array(Math.ceil(seconds*SR)),r:new Float32Array(Math.ceil(seconds*SR))});
function put(b,at,duration,fn,amp=1,pan=0) {let p=Math.round(at*SR);for(let j=0;j<duration*SR;j++){const i=p+j;if(i<0||i>=b.l.length)continue;const v=fn(j/SR,j)*amp; b.l[i]+=v*Math.sqrt((1-pan)*0.5);b.r[i]+=v*Math.sqrt((1+pan)*0.5);}}
function save(name,b) {let peak=0;for(let i=0;i<b.l.length;i++)peak=Math.max(peak,Math.abs(b.l[i]),Math.abs(b.r[i]));const gain=0.87/Math.max(peak,0.00001);const bytes=Buffer.alloc(44+b.l.length*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(SR,24);bytes.writeUInt32LE(SR*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(b.l.length*4,40);for(let i=0;i<b.l.length;i++){bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,b.l[i]*gain))*32767),44+i*4);bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,b.r[i]*gain))*32767),46+i*4);}writeFileSync(resolve(out,name+'.wav'),bytes);}
const configs=[{name:'troll',bpm:132,root:41.203,melody:[0,0,7,10,7,3,0,-2,0,7,12,10,7,3,5,3],grit:2.2},{name:'ironic',bpm:116,root:43.654,melody:[0,7,3,10,0,3,7,5,0,12,10,7,3,0,-2,3],grit:1.5},{name:'velocity',bpm:144,root:46.249,melody:[0,12,7,10,3,7,5,10,0,12,15,10,7,5,3,7],grit:2.5}];
for(const c of configs){const b=make(36),beat=60/c.bpm;for(let n=0;n*beat<36;n++){
 const t=n*beat;
 // Pitch-swept punch and click, with off-beat Brazilian-funk-inspired variation.
 for(const dt of (n%4===2?[0,beat*.75]:[0])) put(b,t+dt,.32,(s)=>Math.sin(TAU*(48*s+7.3*(1-Math.exp(-s*34))))*Math.exp(-s*13)+noise()*.12*Math.exp(-s*150),.82);
 if(n%2===1)put(b,t,.19,s=>(noise()*.68+Math.sin(TAU*182*s)*.32)*Math.exp(-s*26),.34);
 for(let h=0;h<2;h++)put(b,t+h*beat/2,.062,s=>noise()*Math.exp(-s*85),h?.105:.08,h?.28:-.28);
 if(n%8===7)for(let h=0;h<4;h++)put(b,t+beat*.5+h*beat/8,.04,s=>noise()*Math.exp(-s*130),.07,h%2?.4:-.4);
 const bf=c.root*2**([0,0,-2,3][Math.floor(n/4)%4]/12);
 put(b,t,beat*.92,s=>{const a=Math.min(1,s/.008)*Math.exp(-s*2.2);return Math.tanh((Math.sin(TAU*bf*s)+.22*Math.sin(TAU*bf*2*s))*c.grit)*a;},.30);
 for(let h=0;h<2;h++){const step=c.melody[(n*2+h)%c.melody.length];const hz=329.63*2**(step/12);put(b,t+h*beat/2,beat*.48,s=>{const a=Math.min(1,s/.002)*Math.exp(-s*19);return (Math.sin(TAU*hz*s)*.7+Math.sin(TAU*hz*1.48*s)*.25+Math.sin(TAU*hz*2.01*s)*.12)*a;},.29,h?.16:-.16);}
 }
 for(let i=0;i<b.l.length;i++){const fade=Math.min(1,(b.l.length-i)/(SR*.04));b.l[i]=Math.tanh(b.l[i]*1.22)*fade;b.r[i]=Math.tanh(b.r[i]*1.22)*fade;}
 save(c.name,b);
}
let b=make(.9);put(b,0,.9,s=>(Math.sin(TAU*(38*s+9*(1-Math.exp(-s*28))))*.9+noise()*.5*Math.exp(-s*18))*Math.exp(-s*7),.9);save('impact',b);
b=make(.6);put(b,0,.6,s=>{const env=Math.sin(Math.PI*s/.6)**1.5;return (Math.sin(TAU*(900*s-720*s*s))*.55+noise()*.23)*env;});save('record-stop',b);
b=make(.65);put(b,0,.65,s=>noise()*Math.sin(Math.PI*s/.65)**2*.8);save('whoosh',b);
b=make(.75);put(b,0,.75,s=>(Math.sin(TAU*1318.5*s)*.7+Math.sin(TAU*1977.7*s)*.3)*Math.exp(-s*8)*Math.min(1,s/.002));save('ping',b);
writeFileSync(resolve(out,'audio-provenance.json'),JSON.stringify({created:'2026-10-07',method:'Original deterministic synthesizer tools/make-audio.mjs; no external samples, vocals, or copied melodies.',purpose:'Style audition beds, not the named commercial reference songs.',sampleRate:SR,channels:2,tracks:configs.map(({name,bpm})=>({file:name+'.wav',bpm,durationSeconds:36,dropSeconds:0})),sfx:['impact.wav','record-stop.wav','whoosh.wav','ping.wav']},null,2)+'\n');
console.log('Wrote 3 original 36-second beds and 4 sound cues to '+out);
