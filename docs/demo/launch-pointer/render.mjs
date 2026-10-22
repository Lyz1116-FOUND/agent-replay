import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const output=path.resolve(process.env.POINTER_OUTPUT||path.join(root,'demo-output/agent-replay-pointer-release'));fs.mkdirSync(output,{recursive:true});
const args=process.argv.slice(2),arg=(key,d)=>args.includes(key)?args[args.indexOf(key)+1]:d;
const preview=args.includes('--preview'),serve=args.includes('--serve');
const fps=Number(arg('--fps','60')),total=24*fps;
await build({entryPoints:[path.join(here,'composition.mjs')],bundle:true,format:'esm',outfile:path.join(output,'composition.js'),logLevel:'warning'});
const files={
 '/': [path.join(here,'film.html'),'text/html'],
 '/composition.js':[path.join(output,'composition.js'),'text/javascript'],
 '/motion.js':[path.join(root,'demo-output/onetake-skill/lib/motion.js'),'text/javascript'],
 '/inter.woff2':[path.join(here,'../launch/assets/inter.woff2'),'font/woff2'],
 '/mono.woff2':[path.join(here,'../launch/assets/mono.woff2'),'font/woff2'],
 '/product.mp4':[path.join(here,'../launch/assets/product-source.mp4'),'video/mp4']
};
const server=http.createServer((req,res)=>{const file=files[new URL(req.url,'http://localhost').pathname];if(!file){res.writeHead(404);res.end();return}const [name,type]=file;const size=fs.statSync(name).size;const range=req.headers.range;if(range){const m=/bytes=(\d+)-(\d*)/.exec(range);if(!m){res.writeHead(416);res.end();return}const start=+m[1],end=m[2]?Math.min(+m[2],size-1):size-1;res.writeHead(206,{'Content-Type':type,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});fs.createReadStream(name,{start,end}).pipe(res)}else{res.writeHead(200,{'Content-Type':type,'Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(name).pipe(res)}});
await new Promise(r=>server.listen(Number(arg('--port',serve?'4318':'0')),'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
if(serve){console.log(url);await new Promise(()=>{});}else{
const gpu=arg('--gpu',process.platform==='darwin'?'metal':'swiftshader');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:[`--use-angle=${gpu}`,...(gpu==='swiftshader'?['--enable-unsafe-swiftshader']:[])]});
const errors=[];const start=Date.now();
try{
const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto(url);await page.evaluate(()=>window.__ready);await page.locator('#controls').evaluate(el=>el.style.display='none');
const times=preview?[.8,2.52,2.78,3.5,4.75,7.9,8.16,8.42,8.72,9.3,12.6,13.55,13.85,14.2,15.25,17.14,17.48,17.8,19.5,20.2,20.55,20.8,21.2,21.7,23.8]:Array.from({length:Number(arg('--to',String(total)))-Number(arg('--from','0'))},(_,i)=>(Number(arg('--from','0'))+i)/fps);
const dir=path.join(output,preview?'checks':'frames');fs.mkdirSync(dir,{recursive:true});
await page.evaluate(()=>{
 const c=document.createElement('canvas');c.width=1920;c.height=1080;window.captureCanvas=c;window.captureContext=c.getContext('2d',{willReadFrequently:true});
 const lut=new Float32Array(256);for(let i=0;i<256;i++){const s=i/255;lut[i]=s<=.04045?s/12.92:((s+.055)/1.055)**2.4}window.linearLUT=lut;
 window.encodeFrame=async(t,samples,fps)=>{
  const ctx=window.captureContext,c=window.captureCanvas,src=document.getElementById('film');
  if(samples===1){await window.__seek(t);ctx.drawImage(src,0,0);return c.toDataURL('image/png').split(',')[1]}
  const accum=new Float32Array(1920*1080*3);let data;
  for(let j=0;j<samples;j++){await window.__seek(Math.max(0,t+(j/(samples-1)-.5)/(fps*2)));ctx.drawImage(src,0,0);data=ctx.getImageData(0,0,1920,1080);const a=data.data;for(let i=0,k=0;i<a.length;i+=4){accum[k++]+=window.linearLUT[a[i]]/samples;accum[k++]+=window.linearLUT[a[i+1]]/samples;accum[k++]+=window.linearLUT[a[i+2]]/samples}}
  const a=data.data;for(let i=0,k=0;i<a.length;i+=4)for(let ch=0;ch<3;ch++){const l=accum[k++];a[i+ch]=Math.round(255*(l<=.0031308?l*12.92:1.055*l**(1/2.4)-.055))}ctx.putImageData(data,0,0);return c.toDataURL('image/png').split(',')[1];
 };
});
const sampleHistogram={};
for(let i=0;i<times.length;i++){
 const t=times[i],fast=[[2.4,3.12],[3.8,4.62],[5.28,5.95],[20,21.4]].some(([a,b])=>t>=a&&t<=b),samples=preview?1:Math.max(Number(arg('--samples','8')),fast?16:0);sampleHistogram[samples]=(sampleHistogram[samples]||0)+1;
 const png=await page.evaluate(({t,samples,fps})=>window.encodeFrame(t,samples,fps),{t,samples,fps});
 fs.writeFileSync(path.join(dir,preview?`t-${t.toFixed(2)}.png`:`${String(Math.round(t*fps)).padStart(4,'0')}.png`),Buffer.from(png,'base64'));
 if(i%30===0||preview)console.log(`${i+1}/${times.length} · ${t.toFixed(2)}s · ${((Date.now()-start)/1000).toFixed(1)}s elapsed`);
}
// Scrambled seeks must produce exactly the same GPU image.
const a=await page.evaluate(async()=>{await window.__seek(11.9);return document.getElementById('film').toDataURL()});await page.evaluate(()=>window.__seek(3));const b=await page.evaluate(async()=>{await window.__seek(11.9);return document.getElementById('film').toDataURL()});
const framing=[];for(let t=0;t<24;t+=.2){const q=await page.evaluate(async t=>{await window.__seek(t);return window.__track(t).operator},t);if(q.x<0||q.x+q.w>1920||q.y<0||q.y+q.h>1080)framing.push({t,...q})}
const report={url,duration:24,fps,resolution:[1920,1080],frames:times.length,shutter:preview?0:180,samples:preview?1:'8–16',sampleHistogram,linearLight:true,renderer:'Three.js / Metal / BokehPass',deterministic:a===b,framingFailures:framing,errors,seconds:(Date.now()-start)/1000};
fs.writeFileSync(path.join(output,preview?'preview-report.json':`render-${arg('--from','0')}-${arg('--to',String(total))}.json`),JSON.stringify(report,null,2));
if(errors.length||a!==b||framing.length)throw Error(JSON.stringify(report));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r))}
}
