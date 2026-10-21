import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {frame as kitFrame,palette} from './assets/motion-modules.mjs';
import {poseFrame,poses,palette as charPalette} from './assets/character-modules.mjs';
const base=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(base,'../../..');
const output=process.env.LAUNCH_OUTPUT||path.join(repo,'demo-output','agent-replay-launch-final');fs.mkdirSync(output,{recursive:true});
const T=JSON.parse(fs.readFileSync(path.join(base,'timeline.json')));
const args=process.argv.slice(2),preview=args.includes('--preview'),clean=args.includes('--clean');
const get=(n,f)=>{let i=args.indexOf(n);return i<0?f:args[i+1]};
const width=Number(get('--width','1920')),scale=width/1920;
const dir=path.join(output,preview?'checks':clean?'clean-frames':'frames');fs.mkdirSync(dir,{recursive:true});
const font=id=>fs.readFileSync(path.join(base,'assets',`${id}.woff2`)).toString('base64');
const html=fs.readFileSync(path.join(base,'film.html'),'utf8').replace('__INTER__',font('inter')).replace('__MONO__',font('mono')).replace('__TIMELINE__',JSON.stringify(T)).replace('__VIDEO__',fs.readFileSync(path.join(base,'assets/product-source.mp4')).toString('base64'));
const chrome=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await chromium.launch({headless:true,executablePath:chrome});
let errors=[];
try{const p=await b.newPage({viewport:{width:1920,height:1080}});p.on('pageerror',e=>errors.push(e.message));
await p.setContent(html,{waitUntil:'load'});await p.evaluate(()=>window.ready);
// Consume actual motion-kit source, not just a copied poster. Match film palette.
palette.blue='#ff6979';
const sprite=(id)=>Array.from({length:48},(_,i)=>`data:image/svg+xml;base64,${Buffer.from(kitFrame(id,i/30).replace(/<text[^>]*>[^<]*<\/text>/g,'')).toString('base64')}`);
await p.evaluate(async({cursor,lock})=>{const decode=async src=>{const im=new Image();im.src=src;await im.decode();return im};window.kitCursorFrames=await Promise.all(cursor.map(decode));window.kitLockFrames=await Promise.all(lock.map(decode));},{cursor:sprite('living-cursor'),lock:sprite('focus-lock')});
charPalette.blue='#ff6979';
const characterSprites=Object.fromEntries(Object.keys(poses).map(name=>[name,`data:image/svg+xml;base64,${Buffer.from(poseFrame(name).replace('width="256" height="256"','width="512" height="512"')).toString('base64')}`]));
await p.evaluate(async sprites=>{window.characterSprites={};for(const [name,src] of Object.entries(sprites)){let im=new Image();im.src=src;await im.decode();window.characterSprites[name]=im}},characterSprites);
const times=preview?[0,.9,1.6,2.2,2.8,3.5,4.5,5.6,6.05,6.25,6.7,7.5,8.6,8.8,9.55,9.8,10.7,11.4,12.7,13.6,14.5,15.4,16.3,17.7,18.9,19.9,20.3,21.2,22.3,23.5,25,26.5,28.5,29.8]:Array.from({length:Number(get('--to',String(T.duration*T.fps)))-Number(get('--from','0'))},(_,i)=>(i+Number(get('--from','0')))/T.fps);
for(let i=0;i<times.length;i++){
const t=times[i];const png=await p.evaluate(async({t,clean,scale})=>{await window.render(t,clean);const s=document.getElementById('film');if(scale===1)return s.toDataURL('image/png').split(',')[1];let d=document.createElement('canvas');d.width=Math.round(1920*scale);d.height=Math.round(1080*scale);d.getContext('2d').drawImage(s,0,0,d.width,d.height);return d.toDataURL('image/png').split(',')[1]},{t,clean,scale});
fs.writeFileSync(path.join(dir,preview?`t-${t.toFixed(2).replace('.','-')}.png`:`${String(Math.round(t*T.fps)).padStart(4,'0')}.png`),Buffer.from(png,'base64'));
if(i%90===0||preview)console.log(`${clean?'clean':'master'} ${i+1}/${times.length} t=${t.toFixed(2)}`);
}
fs.writeFileSync(path.join(output,preview?'preview-report.json':clean?'clean-render-report.json':'render-report.json'),JSON.stringify({T,width,clean,frames:times.length,errors,motionKit:['living-cursor','focus-lock'],source:'assets/motion-modules.mjs'},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await b.close()}
