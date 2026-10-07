import { readdir,readFile,mkdir,writeFile,access } from 'node:fs/promises';
import { resolve,relative,dirname,basename,join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve('data/experiments'),out=join(root,'review');
await mkdir(join(out,'posters'),{recursive:true});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url=p=>relative(out,p).split('/').map(encodeURIComponent).join('/');
const ffmpeg='/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
async function preview(input,output,audioOnly=false){
 try{await access(output);return output;}catch{}
 await mkdir(dirname(output),{recursive:true});
 const args=['-hide_banner','-loglevel','error','-nostdin','-n','-i',input];
 if(audioOnly)args.push('-vn');
 else args.push('-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-row-mt','1','-threads','4','-b:v','0','-crf','32');
 args.push('-c:a','libopus','-b:a','96k',output);
 const result=spawnSync(ffmpeg,args,{encoding:'utf8',timeout:180000});
 if(result.status!==0)throw new Error(result.stderr||'Preview encoding failed');
 return output;
}
const controls=label=>`<div class="controls"><button class="play" aria-label="Play ${esc(label)}">Play</button><input type="range" class="seek" min="0" max="100" value="0" step="0.1" aria-label="Seek ${esc(label)}"><span class="clock">0:00</span><button class="mute" aria-label="Mute ${esc(label)}">Sound on</button></div>`;
const old=new Set(['archer-troll-v1','zombie-fail-v1','mail-merge-v1','zombie-overview-v2','golem-troll-v3']);
let collection=null;
try{collection=JSON.parse(await readFile(resolve('experiments/review/current.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(collection&&!Array.isArray(collection.videos))throw new Error('Invalid current review collection');
const featured=collection?new Set(collection.videos.map(v=>v.id)):null;
if(collection&&featured.size!==collection.videos.length)throw new Error('Duplicate current review ids');
const description={
 'archer-troll-v1':'Earlier 4.8-second test with demonstration audio and the original reaction placement.',
 'zombie-fail-v1':'Earlier 8-second test with demonstration audio.',
 'mail-merge-v1':'Earlier faster narration, with the old on-screen source credit.',
 'mail-merge-v2':'Longer natural-pace narration. Source credit moved off-screen; unique train footage at 0.86× speed.',
 'zombie-fail-v5':'Earlier climax revision, superseded after a renderer bug was found in the audio delay timestamps.',
 'zombie-fail-v6':'The setup builds toward the late bomb rupture, where the main visual change and phonk drop land together. Audio timing is verified after rendering.',
 'ben10-overview-v1':'A new opening hook over rooftop flight, followed by distinct crystal and burrowing powers. Each spoken feature matches its demonstration.',
 'zombie-overview-v2':'Earlier simple-game overview, retained to compare its opening and depth with the new overview.',
 'golem-troll-v3':'Earlier timing baseline: its late drop accompanies a repeated toss, which does not establish a stronger payoff than the preceding tosses.',
};
const cards=[];
for(const folder of ['troll-editor','story-background','game-overview']){
 const dir=join(root,folder,'renders');
 let files=[];try{files=await readdir(dir);}catch{continue;}
 for(const filename of files.filter(f=>f.endsWith('.manifest.json'))){
  const manifestPath=join(dir,filename),m=JSON.parse(await readFile(manifestPath,'utf8'));
  const video=filename.replace('.manifest.json','.mp4'),path=join(dir,video),id=basename(video,'.mp4');
  try{await access(path);}catch{continue;}
  const family=id.replace(/-v\d+$/u,'');
  const version=Number(id.match(/-v(\d+)$/u)?.[1]??0);
  const latest=Math.max(...files.filter(f=>f.startsWith(family+'-v')&&f.endsWith('.manifest.json')).map(f=>Number(f.match(/-v(\d+)\.manifest\.json$/u)?.[1]??0)));
  const legacy=featured?!featured.has(id):old.has(id)||version<latest;
  const editorial=collection?.videos.find(v=>v.id===id);
  const face=m.faceAttachments?.[0];
  const posterTime=face?Math.min(face.outputStart+0.25,face.outputEnd-0.05):1;
  const poster=join(out,'posters',id+(face?'-face':'')+'.jpg');
  try{await access(poster);}catch{const p=spawnSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-ss',String(posterTime),'-i',path,'-frames:v','1','-vf','scale=360:640:force_original_aspect_ratio=decrease','-update','1',poster],{encoding:'utf8'});if(p.status!==0)throw new Error(p.stderr);}
  const previewPath=await preview(path,path.replace(/\.mp4$/u,'.webm'));
  const kind=folder==='troll-editor'?'Meme edit':folder==='game-overview'?'Game overview':'Narrated story';
  const duration=m.intendedDuration??m.output?.durationSeconds??m.duration??m.durationSeconds??0;
  const title=editorial?.title??m.plan?.title??m.title??id.replaceAll('-',' ');
  const planPath=m.planPath;
  const links=[`<a href="${url(path)}" download>Download video</a>`,`<a href="${url(manifestPath)}">Render details</a>`];
  if(planPath)links.push(`<a href="${url(planPath)}">Agent plan</a>`);
  const story=m.story??m.plan?.story;
  let credit=story?.permalink?`<p>Source: <a href="${esc(story.permalink)}" target="_blank" rel="noreferrer">${esc(story.attribution??story.title??'Original source')}</a></p>`:'';
  if(editorial?.credit)credit+=`<p>${esc(editorial.credit)}</p>`;
  const summary=editorial?.description??description[id]??(kind==='Meme edit'?'A setup and payoff, timed to the observed action.':kind==='Narrated story'?'Narration over reviewed gameplay, with short phrase captions.':'A narrated goal and feature tour, paired with the actual demonstrated actions.');
  cards.push({id,title,kind,duration,legacy,html:`<article class="card" data-id="${esc(id)}" data-kind="${esc(kind)}" data-legacy="${legacy}"><header><span class="tag">${esc(kind)}${legacy?' · earlier draft':''}</span><span class="time">${Number(duration).toFixed(1)}s</span></header><h2>${esc(title)}</h2><div class="player"><video playsinline preload="none" poster="${url(poster)}" src="${url(previewPath)}"></video>${controls(title)}</div><p class="description">${esc(summary)}</p><details><summary>Credits &amp; edit records</summary>${credit}<p class="links">${links.join(' · ')}</p></details></article>`});
 }
}
if(featured)for(const id of featured)if(!cards.some(c=>c.id===id))throw new Error(`Current collection render is missing: ${id}`);
cards.sort((a,b)=>Number(a.legacy)-Number(b.legacy)||['Game overview','Meme edit','Narrated story'].indexOf(a.kind)-['Game overview','Meme edit','Narrated story'].indexOf(b.kind)||Number(b.id==='zombie-fail-v6')-Number(a.id==='zombie-fail-v6')||a.id.localeCompare(b.id));
let audioSection='<p>The audio catalog is being prepared.</p>';
try{
 const catalog=JSON.parse(await readFile(resolve('experiments/meme-audio/catalog.json'),'utf8'));
 const assets=catalog.assets??catalog;
 const items=[];
 for(const a of assets){
  const path=resolve(a.path),label=a.name??a.id;
  const audioPreview=await preview(path,join(out,'audio',a.id+'.ogg'),true);
  items.push(`<article class="audio-item"><h3>${esc(label)}</h3><div class="player"><audio preload="none" src="${url(audioPreview)}"></audio>${controls(label)}</div><p>${esc(a.licenseSummary)}</p><p class="attribution">${esc(a.attribution??'')}</p><p><a href="${esc(a.sourceUrl)}" target="_blank" rel="noreferrer">Source &amp; credit</a></p></article>`);
 }
 audioSection=items.join('');
}catch(error){throw new Error('Audio library preview failed: '+error.message);}
const count=cards.filter(c=>!c.legacy).length;
await writeFile(join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gameplay edit experiments</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:#101215;color:#f5f6f7}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:44px 28px 72px}.eyebrow{color:#b7ff72;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700}h1{font-size:clamp(32px,5vw,60px);line-height:1.04;letter-spacing:-.045em;margin:16px 0}p{line-height:1.55;color:#c2c8d0}.intro{max-width:750px;margin-bottom:26px}.filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:28px 0}.filters button{font:inherit;color:#cdd2d9;border:1px solid #38414a;background:#1c2228;padding:10px 16px;border-radius:24px;cursor:pointer}.filters button.active{background:#b7ff72;color:#112009;border-color:#b7ff72}.filters label{font-size:14px;color:#cdd2d9;margin-left:auto}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:22px;align-items:start}.card{padding:16px;border:1px solid #333b43;border-radius:18px;background:#1a1e23}.card[hidden]{display:none}.card header{display:flex;justify-content:space-between;gap:8px}.tag{color:#b7ff72;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.time{font-size:12px;color:#abb4be}.card h2{font-size:18px;line-height:1.35;min-height:49px;margin:14px 0}.card video{display:block;width:100%;aspect-ratio:9/16;background:#070808;border-radius:10px;max-height:650px}.controls{display:flex;align-items:center;gap:8px;padding:12px 0}.controls button{border:1px solid #46525c;border-radius:7px;padding:6px 9px;color:#f3f6f8;background:#29343b;cursor:pointer;font-size:12px;white-space:nowrap}.controls .seek{width:100%;min-width:30px;accent-color:#b7ff72}.clock{font-size:12px;color:#c2c8d0}.controls .mute{font-size:10px;padding:6px}.attribution{white-space:pre-line}.description{font-size:13px;min-height:61px}.card details{border-top:1px solid #343c45;padding-top:12px;font-size:12px;line-height:1.6}.card summary{cursor:pointer;color:#d4dbe3}a{color:#c0e7ff;text-underline-offset:3px}.links a{white-space:nowrap}section{margin-top:48px}.audio-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}.audio-item{padding:18px;background:#1a1e23;border:1px solid #333b43;border-radius:14px}.audio-item h3{font-size:16px;margin:0 0 16px}.audio-item p{font-size:12px}.audio-item audio{width:100%}.note{font-size:13px;color:#a6afb8}.footer{margin-top:38px;border-top:1px solid #303942;padding-top:20px;font-size:12px}@media(max-width:620px){main{padding:28px 16px}.grid{grid-template-columns:1fr}.card{max-width:440px;width:100%;margin:auto}.filters label{margin-left:0;width:100%;margin-top:8px}.card video{max-height:none}.description{min-height:0}}
</style><main><div class="eyebrow">Editing lab · all formats</div><h1>Gameplay, three ways.</h1><p class="intro">${count} current previews in one place: meme edits, a narrated story, and a game overview. The featured set contains one selected video per style. Credits stay off the video; earlier experiments remain available below. Open the records under any player for sources and edit decisions.</p><nav class="filters" aria-label="Filter previews"><button class="active" data-filter="all">All formats</button><button data-filter="Meme edit">Meme edits</button><button data-filter="Narrated story">Narrated story</button><button data-filter="Game overview">Game overview</button><label><input id="earlier" type="checkbox"> Include earlier drafts (${cards.filter(c=>c.legacy).length})</label></nav><div class="grid">${cards.map(c=>c.html).join('')}</div><section><h2>The meme-audio library</h2><p class="note">Actual clips and music used for this experiment. Credits and reuse terms live here, off the video. Familiar meme clips without verified rights are labeled preview-only; availability does not establish a royalty-free license.</p><div class="audio-grid">${audioSection}</div></section><p class="footer">Sources, voice provenance and edit decisions are available under each player. All previews stay local. Earlier drafts retain their original audio, placement and credit treatment for comparison.</p></main><script>
let selected='all';const cards=[...document.querySelectorAll('.card')],earlier=document.querySelector('#earlier');function filter(){for(const card of cards)card.hidden=(selected!=='all'&&card.dataset.kind!==selected)||(!earlier.checked&&card.dataset.legacy==='true');for(const media of document.querySelectorAll('video'))if(media.closest('.card').hidden)media.pause()}for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{selected=button.dataset.filter;for(const other of document.querySelectorAll('[data-filter]'))other.classList.toggle('active',other===button);filter()});earlier.addEventListener('change',filter);for(const player of document.querySelectorAll('.player')){
const media=player.querySelector('video,audio'),button=player.querySelector('.play'),seek=player.querySelector('.seek'),clock=player.querySelector('.clock'),mute=player.querySelector('.mute');
button.addEventListener('click',()=>{if(media.paused)media.play().catch(()=>{button.textContent='Retry';});else media.pause()});
media.addEventListener('play',()=>button.textContent='Pause');media.addEventListener('pause',()=>button.textContent='Play');media.addEventListener('ended',()=>button.textContent='Replay');
media.addEventListener('timeupdate',()=>{seek.value=Number.isFinite(media.duration)?media.currentTime/media.duration*100:0;clock.textContent=Math.floor(media.currentTime/60)+':'+String(Math.floor(media.currentTime%60)).padStart(2,'0')});
seek.addEventListener('input',()=>{if(Number.isFinite(media.duration))media.currentTime=media.duration*Number(seek.value)/100});
mute.addEventListener('click',()=>{media.muted=!media.muted;mute.textContent=media.muted?'Muted':'Sound on'});
}
for(const media of document.querySelectorAll('video,audio'))media.addEventListener('play',()=>{for(const other of document.querySelectorAll('video,audio'))if(other!==media)other.pause()});filter();</script></html>`);
await writeFile(join(out,'index.json'),JSON.stringify(cards.map(({html,...rest})=>rest),null,2));
console.log(join(out,'index.html'));
