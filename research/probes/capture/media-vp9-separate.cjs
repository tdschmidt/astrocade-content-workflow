const fs=require('node:fs/promises');const path=require('node:path');const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root=process.env.CAPTURE_BENCH_DIR || '/tmp/astrocade-capture-bench';
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:(process.env.CHROME_EXECUTABLE || chromium.executablePath()),args:['--auto-select-tab-capture-source-by-title=AstroCaptureBench']});
try{
const runtime={browser:browser.version(),playwright:require(require.resolve('playwright/package.json',{paths:[process.env.PLAYWRIGHT_MODULE_PATH || process.cwd()]})).version,executable:process.env.CHROME_EXECUTABLE || chromium.executablePath()};console.log(runtime);
const game=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});await game.goto(require('node:url').pathToFileURL(path.join(root,'scene.html')).href);await game.evaluate(()=>document.title='AstroCaptureBench');const page=await browser.newPage({viewport:{width:800,height:600}});await page.goto(require('node:url').pathToFileURL(path.join(root,'scene.html')).href);await page.evaluate(()=>document.title='Recorder');
const available=await page.evaluate(()=>({secure:isSecureContext,devices:!!navigator.mediaDevices,display:!!navigator.mediaDevices?.getDisplayMedia,supported:MediaRecorder.isTypeSupported('video/webm;codecs=vp9')}));console.log(available);
await page.evaluate(()=>{
const button=document.createElement('button');button.textContent='Start capture';button.style='position:fixed;left:0;top:0';document.body.append(button);
window.captureReady=null;window.captureError=null;
button.onclick=async()=>{try{
const stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:30,width:1080,height:1920},audio:false,selfBrowserSurface:'include'});
button.remove();window.captureStream=stream;window.captureSettings=stream.getVideoTracks()[0].getSettings();window.recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:8000000});window.chunks=[];window.recorder.ondataavailable=e=>window.chunks.push(e.data);window.recorder.start(1000);window.captureReady=true;
}catch(e){window.captureError=String(e)}};
});
await page.getByRole('button',{name:'Start capture'}).click();
await page.waitForFunction(()=>window.captureReady||window.captureError,{},{timeout:10000});
const ready=await page.evaluate(()=>({ready:window.captureReady,error:window.captureError,settings:window.captureSettings}));console.log(ready);
if(ready.ready){await game.bringToFront();await game.evaluate(()=>window.go());await new Promise(r=>setTimeout(r,6000));await game.evaluate(()=>window.stop());const b64=await page.evaluate(async()=>{window.stop();window.beforeStopChunks=window.chunks.length;await new Promise(r=>{window.recorder.onstop=r;window.recorder.stop()});window.captureStream.getTracks().forEach(t=>t.stop());const blob=new Blob(window.chunks,{type:'video/webm'});const buf=await blob.arrayBuffer();let s='';for(const b of new Uint8Array(buf))s+=String.fromCharCode(b);return btoa(s)});const flush=await page.evaluate(()=>({beforeStopChunks:window.beforeStopChunks,afterStopChunks:window.chunks.length,chunkSizes:window.chunks.map(c=>c.size),recorderState:window.recorder.state,trackStates:window.captureStream.getTracks().map(t=>t.readyState)}));await fs.writeFile(path.join(root,'media-vp9-separate.webm'),Buffer.from(b64,'base64'));await fs.writeFile(path.join(root,'media-vp9-separate.json'),JSON.stringify({...ready,runtime,flush},null,2));console.log(flush)}
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
