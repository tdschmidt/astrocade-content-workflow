const fs=require('node:fs/promises');const path=require('node:path');const cp=require('node:child_process');
const sharp=require(process.env.SHARP_MODULE_PATH || 'sharp');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root=process.env.CAPTURE_BENCH_DIR || '/tmp/astrocade-capture-bench',ffmpeg=(process.env.FFMPEG_PATH || 'ffmpeg');
function ids(file){const out=cp.execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',file,'-vf','crop=600:40:20:130,format=gray','-fps_mode','passthrough','-f','rawvideo','pipe:1'],{maxBuffer:20*1024*1024});const result=[];for(let p=0;p<out.length;p+=24000){let id=0;for(let b=0;b<12;b++){if(out[p+20*600+b*50+20]>128)id|=1<<b}result.push(id)}return result}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:(process.env.CHROME_EXECUTABLE || chromium.executablePath())});const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});await page.setContent(await fs.readFile(path.join(root,'scene.html'),'utf8'));
 const result=[];
 for(const [name,file,fps]of[['builtin',path.join(root,'builtin/capture.webm'),25],['custom',path.join(root,'builtin/from-jpegs.mp4'),30],['display',path.join(root,'media-display.webm'),30],['displaymp4',path.join(root,'media-mp4.mp4'),30],['displayvp9',path.join(root,'media-vp9-separate.webm'),30]]){
  const index=ids(file);const active=index.slice(0,fps*6);const samples=[];
  for(const sec of [1,2,3,4,5]){
   const fn=sec*fps,id=index[fn],png=path.join(root,`${name}-${sec}.png`),gold=path.join(root,`${name}-${sec}-gold.png`);
   cp.execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',file,'-vf',`select=eq(n\\,${fn})`,'-frames:v','1',png]);
   await fs.writeFile(gold,Buffer.from(await page.evaluate(n=>window.golden(n),id),'base64'));
   const a=await sharp(png).removeAlpha().raw().toBuffer(),b=await sharp(gold).removeAlpha().raw().toBuffer();let sse=0;for(let i=0;i<a.length;i++)sse+=(a[i]-b[i])**2;const psnr=10*Math.log10(255*255/(sse/a.length));
   const metric=cp.spawnSync(ffmpeg,['-hide_banner','-i',png,'-i',gold,'-lavfi','ssim','-f','null','-'],{encoding:'utf8'}).stderr.match(/All:([\d.]+)/)?.[1];
   samples.push({sec,frameNumber:fn,sceneId:id,psnrRgb:psnr,ssim:Number(metric)});
  }
  const probe=JSON.parse(cp.execFileSync((process.env.FFPROBE_PATH || 'ffprobe'),['-v','error','-show_entries','format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,avg_frame_rate','-of','json',file],{encoding:'utf8'}));
  const packets=JSON.parse(cp.execFileSync((process.env.FFPROBE_PATH || 'ffprobe'),['-v','error','-select_streams','v:0','-show_entries','packet=pts_time','-of','json',file],{encoding:'utf8'})).packets.map(p=>Number(p.pts_time)).sort((a,b)=>a-b);
  result.push({name,probe,totalFrames:index.length,uniqueActive:new Set(active).size,activeFrames:active.length,tailRepeats:index.slice(fps*6).filter(n=>n===index.at(-1)).length,firstPts:packets[0],lastPts:packets.at(-1),actualPacketRate:(packets.length-1)/(packets.at(-1)-packets[0]),samples});
 }
 await browser.close();await fs.writeFile(path.join(root,'analysis.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 const thumbs=await Promise.all(['builtin','custom'].map(async n=>({input:await sharp(path.join(root,`${n}-3.png`)).extract({left:250,top:760,width:600,height:600}).png().toBuffer(),left:n==='builtin'?0:600,top:0})));
 await sharp({create:{width:1200,height:600,channels:3,background:'#ffffff'}}).composite(thumbs).png().toFile(path.join(root,'comparison.png'));
})().catch(e=>{console.error(e);process.exitCode=1});
