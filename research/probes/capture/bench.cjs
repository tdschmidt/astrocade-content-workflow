const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const path = require('node:path');
const root = process.env.CAPTURE_BENCH_DIR || '/tmp/astrocade-capture-bench';
const executablePath = (process.env.CHROME_EXECUTABLE || chromium.executablePath());
const html = `<style>html,body{margin:0;overflow:hidden}canvas{display:block}</style><canvas id="c" width="1080" height="1920"></canvas><script>
const c=document.querySelector('canvas'),x=c.getContext('2d');let running=false,frame=0,raf=0;
function draw(n){
 x.fillStyle='#142438';x.fillRect(0,0,1080,1920);
 for(let yy=-1;yy<35;yy++)for(let xx=-1;xx<21;xx++){
   const dx=(xx*60+(n*9)%60),dy=yy*60+(n*13)%60;
   x.fillStyle=['#536ac1','#b45376','#339787','#dfb44b'][(xx+yy+80)%4];x.fillRect(dx,dy,48,48);
   x.strokeStyle='#ffffff';x.lineWidth=1;x.strokeRect(dx+5,dy+5,38,38);
 }
 x.fillStyle='#182336';x.fillRect(0,0,1080,195);
 x.fillStyle='#ffffff';x.font='bold 36px sans-serif';x.fillText('GAME CAPTURE / SCORE 0123456789',30,58);
 x.font='20px sans-serif';x.fillText('Fine HUD detail | dodge, collect, finish',30,94);
 for(let i=0;i<12;i++){x.fillStyle=(n&(1<<i))?'#ffffff':'#000000';x.fillRect(i*50+20,130,40,40);}
 x.fillStyle='#0c1830';x.fillRect(280,830,520,220);x.fillStyle='#ffffff';x.font='bold 44px sans-serif';x.fillText('LEVEL '+n,315,910);
 x.fillStyle='#ffe657';x.beginPath();x.arc(540+350*Math.sin(n/18),1250+200*Math.cos(n/27),45,0,7);x.fill();
}
function loop(){if(!running)return;draw(frame++);raf=requestAnimationFrame(loop)}
window.go=()=>{frame=0;running=true;loop()};window.stop=()=>{running=false;cancelAnimationFrame(raf);return frame};
window.golden=(n)=>{draw(n);return c.toDataURL('image/png').split(',')[1]};draw(0);
</script>`;
(async()=>{
 await fs.mkdir(root,{recursive:true});
 const browser=await chromium.launch({executablePath,headless:true});
 const context=await browser.newContext({viewport:{width:1080,height:1920},deviceScaleFactor:1});
 let page=await context.newPage();await page.setContent(html);
 const cdp=await context.newCDPSession(page);
 let nativeScreenRecording;
 try{nativeScreenRecording=await cdp.send('Page.startScreenRecording',{audio:false,maxWidth:1080,maxHeight:1920,frameRate:30});await cdp.send('Page.stopScreenRecording')}catch(e){nativeScreenRecording=String(e)}
 const environment={browser:browser.version(),playwright:require(require.resolve('playwright/package.json', {paths:[process.env.PLAYWRIGHT_MODULE_PATH || process.cwd()]})).version,nativeScreenRecording};
 await fs.writeFile(path.join(root,'environment.json'),JSON.stringify(environment,null,2));console.log(environment);
 for(const mode of ['builtin','jpeg90']){
  const dir=path.join(root,mode);await fs.mkdir(dir,{recursive:true});await page.close();page=await context.newPage();await page.setContent(html);
  const frames=[];let bytes=0;
  await page.screencast.start({...(mode==='builtin'?{path:path.join(dir,'capture.webm')}:{quality:90}),size:{width:1080,height:1920},onFrame:({data,timestamp})=>{frames.push({data,timestamp});bytes+=data.length}});
  const start=Date.now();await page.evaluate(()=>window.go());await new Promise(r=>setTimeout(r,6000));const drawn=await page.evaluate(()=>window.stop());await page.screencast.stop();const stop=Date.now();
  let concat='ffconcat version 1.0\n';
  for(let i=0;i<frames.length;i++){
   const name=String(i).padStart(4,'0')+'.jpg';await fs.writeFile(path.join(dir,name),frames[i].data);
   const duration=i<frames.length-1?Math.max(0.001,(frames[i+1].timestamp-frames[i].timestamp)/1000):1/30;
   concat+=`file '${name}'\noption framerate 1000\nduration ${duration.toFixed(6)}\n`;
  }
  concat+=`file '${String(frames.length-1).padStart(4,'0')}.jpg'\noption framerate 1000\n`;
  await fs.writeFile(path.join(dir,'frames.ffconcat'),concat);
  const intervals=frames.slice(1).map((f,i)=>f.timestamp-frames[i].timestamp).sort((a,b)=>a-b);
  const span=frames.at(-1).timestamp-frames[0].timestamp;
  const stats={mode,wallMs:stop-start,drawn,frames:frames.length,spanMs:span,observedFramesPerSecond:(frames.length-1)/span*1000,intervalMedianMs:intervals[Math.floor(intervals.length/2)],intervalP95Ms:intervals[Math.floor(intervals.length*.95)],intervalMaxMs:Math.max(...intervals),bytes,timestamps:frames.map(f=>f.timestamp)};
  await fs.writeFile(path.join(dir,'stats.json'),JSON.stringify(stats,null,2));console.log({...stats,timestamps:undefined});
 }
 await fs.writeFile(path.join(root,'scene.html'),html);await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
