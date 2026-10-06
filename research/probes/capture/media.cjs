const fs=require('node:fs/promises');const path=require('node:path');const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root=process.env.CAPTURE_BENCH_DIR || '/tmp/astrocade-capture-bench';
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:(process.env.CHROME_EXECUTABLE || chromium.executablePath()),args:['--auto-select-tab-capture-source-by-title=AstroCaptureBench']});
try{
const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});await page.goto(require('node:url').pathToFileURL(path.join(root,'scene.html')).href);await page.evaluate(()=>document.title='AstroCaptureBench');
const available=await page.evaluate(()=>({secure:isSecureContext,devices:!!navigator.mediaDevices,display:!!navigator.mediaDevices?.getDisplayMedia,supported:MediaRecorder.isTypeSupported('video/webm;codecs=vp8')}));console.log(available);
await page.evaluate(()=>{
const button=document.createElement('button');button.textContent='Start capture';button.style='position:fixed;left:0;top:0';document.body.append(button);
window.captureReady=null;window.captureError=null;
button.onclick=async()=>{try{
const stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:30,width:1080,height:1920},audio:false,selfBrowserSurface:'include'});
button.remove();window.captureStream=stream;window.captureSettings=stream.getVideoTracks()[0].getSettings();window.recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:8000000});window.chunks=[];window.recorder.ondataavailable=e=>window.chunks.push(e.data);window.recorder.start(1000);window.go();window.captureReady=true;
}catch(e){window.captureError=String(e)}};
});
await page.getByRole('button',{name:'Start capture'}).click();
await page.waitForFunction(()=>window.captureReady||window.captureError,{},{timeout:10000});
const ready=await page.evaluate(()=>({ready:window.captureReady,error:window.captureError,settings:window.captureSettings}));console.log(ready);
if(ready.ready){await new Promise(r=>setTimeout(r,6000));const b64=await page.evaluate(async()=>{window.stop();await new Promise(r=>{window.recorder.onstop=r;window.recorder.stop()});window.captureStream.getTracks().forEach(t=>t.stop());const blob=new Blob(window.chunks,{type:'video/webm'});const buf=await blob.arrayBuffer();let s='';for(const b of new Uint8Array(buf))s+=String.fromCharCode(b);return btoa(s)});await fs.writeFile(path.join(root,'media-display.webm'),Buffer.from(b64,'base64'));await fs.writeFile(path.join(root,'media-display.json'),JSON.stringify(ready,null,2))}
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
