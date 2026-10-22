import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const OM=window.OM, W=1920,H=1080,DUR=24;
const {clamp,lerp,tween,ease}=OM;
const p=(t,a,b,curve=ease.expoOut)=>tween(t,a,b,curve);
const renderer=new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
document.body.prepend(renderer.domElement);renderer.domElement.id='film';
const scene=new THREE.Scene();scene.background=new THREE.Color('#efeee8');
const camera=new THREE.PerspectiveCamera(34,W/H,.1,120);
scene.add(new THREE.HemisphereLight(0xffffff,0xb0bad1,1.9));
const key=new THREE.DirectionalLight(0xfff7eb,3.2);key.position.set(-8,12,17);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-14,right:14,top:12,bottom:-12,near:1,far:45});key.shadow.bias=-.0004;key.shadow.normalBias=.025;scene.add(key);
const fill=new THREE.DirectionalLight(0xa9c8ff,1.5);fill.position.set(8,-2,9);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#eeede6',roughness:.88}));floor.position.z=-.6;floor.receiveShadow=true;scene.add(floor);
const mat=(color,roughness=.35)=>new THREE.MeshStandardMaterial({color,roughness,metalness:0});
const blue=mat('#1855df',.28),white=mat('#fffdf5'),dark=mat('#122b50'),pale=mat('#bed4ff');
function rounded(w,h,d,r,material){const m=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,4,r),material);m.castShadow=true;m.receiveShadow=true;return m}
function ball(r,material,x,y,z,parent){const m=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),material);m.position.set(x,y,z);parent.add(m);m.castShadow=true;return m}

// One persistent actor, built from real 3D geometry. Its front faces the camera (+Z).
const actor=new THREE.Group();scene.add(actor);
const body=rounded(.84,.88,.52,.19,blue);actor.add(body);
const face=rounded(.63,.42,.07,.13,white);face.position.set(0,.05,.285);actor.add(face);
// A high-resolution face is rigged by emotion, gaze and eyelids, independently of body motion.
const faceCanvas=document.createElement('canvas');faceCanvas.width=1024;faceCanvas.height=640;
const fg=faceCanvas.getContext('2d'),faceTexture=new THREE.CanvasTexture(faceCanvas);faceTexture.colorSpace=THREE.SRGBColorSpace;
const expression=new THREE.Mesh(new THREE.PlaneGeometry(.62,.388),new THREE.MeshBasicMaterial({map:faceTexture,transparent:true,toneMapped:false}));expression.position.set(0,.055,.328);actor.add(expression);
const emotions=[
 {t:0,name:'curious',eye:1,gazeX:.3,gazeY:0,brow:0,smile:.1},
 {t:2.05,name:'determined',eye:.68,gazeX:.55,gazeY:-.1,brow:.35,smile:0},
 {t:3.32,name:'surprised',eye:1.6,gazeX:-.25,gazeY:-.1,brow:-.8,smile:-1},
 {t:4.05,name:'suspicious',eye:.65,gazeX:-.7,gazeY:.08,brow:.65,smile:-.2},
 {t:5.72,name:'focused',eye:.7,gazeX:-.8,gazeY:.35,brow:.4,smile:0},
 {t:8.65,name:'thinking',eye:.8,gazeX:-.75,gazeY:-.3,brow:-.3,smile:-.15},
 {t:11.55,name:'aha',eye:1.25,gazeX:-.45,gazeY:.1,brow:-.55,smile:.6},
 {t:12.35,name:'confident',eye:.75,gazeX:-.5,gazeY:.1,brow:.2,smile:.35},
 {t:14.98,name:'joy',eye:.14,gazeX:0,gazeY:0,brow:-.3,smile:1},
 {t:16.2,name:'proud',eye:.85,gazeX:-.5,gazeY:-.2,brow:-.1,smile:.55},
 {t:20,name:'pull',eye:.55,gazeX:-.7,gazeY:.2,brow:.5,smile:0},
 {t:21.4,name:'invite',eye:1.05,gazeX:0,gazeY:0,brow:-.2,smile:.8},
];
function emotionAt(t){let i=0;while(i<emotions.length-1&&t>=emotions[i+1].t)i++;const b=emotions[i],a=emotions[Math.max(0,i-1)],k=p(t,b.t,b.t+.18,ease.sineInOut),out={name:b.name};for(const key of ['eye','gazeX','gazeY','brow','smile'])out[key]=lerp(a[key],b[key],k);return out}
function drawFace(t){
 const e=emotionAt(t);fg.clearRect(0,0,1024,640);fg.lineCap='round';fg.lineJoin='round';
 let blink=1;for(const at of [1.65,4.4,8.95,10.45,13.05,18.75]){const d=Math.abs(t-at);if(d<.085)blink=Math.min(blink,.05+.95*d/.085)}
 const eyeH=90*e.eye*blink,eyeY=275,ink='#102c59';
 for(const side of [-1,1]){const x=512+side*208;
  fg.fillStyle=ink;
  if(e.name==='joy'){fg.strokeStyle=ink;fg.lineWidth=30;fg.beginPath();fg.moveTo(x-61,290);fg.quadraticCurveTo(x,205,x+61,290);fg.stroke();}
  else{fg.beginPath();fg.ellipse(x+e.gazeX*24,eyeY+e.gazeY*20,61,Math.max(5,eyeH),side*e.brow*.13,0,Math.PI*2);fg.fill();
   if(eyeH>30){fg.fillStyle='#fff';fg.beginPath();fg.ellipse(x-14+e.gazeX*34,eyeY-25+e.gazeY*25,17,20,0,0,7);fg.fill();fg.globalAlpha=.55;fg.beginPath();fg.arc(x+23+e.gazeX*25,eyeY+22,7,0,7);fg.fill();fg.globalAlpha=1}}
  fg.strokeStyle=ink;fg.lineWidth=19;fg.beginPath();const by=125+e.brow*18;
  fg.moveTo(x-65,by-side*e.brow*34);fg.quadraticCurveTo(x,by-16,x+65,by+side*e.brow*34);fg.stroke();
 }
 fg.strokeStyle=ink;fg.lineWidth=20;fg.beginPath();
 if(e.smile<-.7){fg.ellipse(512,465,29,43,0,0,7);fg.stroke()}
 else{fg.moveTo(457,450);fg.quadraticCurveTo(512,450+e.smile*110,567,450);fg.stroke()}
 if(e.smile>.45){fg.fillStyle='#e7a0aa';fg.globalAlpha=.42;for(const x of [213,811]){fg.beginPath();fg.ellipse(x,399,49,20,0,0,7);fg.fill()}fg.globalAlpha=1}
 faceTexture.needsUpdate=true;return e;
}
const handL=ball(.115,blue,-.58,-.14,.08,actor),handR=ball(.115,blue,.58,-.14,.08,actor);
const footL=rounded(.23,.18,.34,.075,dark),footR=footL.clone();footL.position.set(-.23,-.53,.03);footR.position.set(.23,-.53,.03);actor.add(footL,footR);
const antenna=new THREE.Group();antenna.position.set(0,.48,0);actor.add(antenna);const stalk=rounded(.065,.18,.065,.025,pale);stalk.position.y=.04;antenna.add(stalk);ball(.075,blue,0,.17,0,antenna);
const interaction=new THREE.Group();scene.add(interaction);
const haloMaterial=new THREE.MeshBasicMaterial({color:'#2e6dff',transparent:true,opacity:0,depthWrite:false});
const halo=new THREE.Mesh(new THREE.RingGeometry(.38,.405,64),haloMaterial);interaction.add(halo);
const halo2=new THREE.Mesh(new THREE.RingGeometry(.52,.532,64),haloMaterial.clone());interaction.add(halo2);

const board=new THREE.Group();scene.add(board);
const shell=rounded(1,1,.19,.06,white);board.add(shell);
const surface=document.createElement('canvas');surface.width=1800;surface.height=1125;const g=surface.getContext('2d');
const tex=new THREE.CanvasTexture(surface);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=renderer.capabilities.getMaxAnisotropy();
const screen=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false}));screen.position.z=.103;board.add(screen);
const contact=new THREE.Mesh(new THREE.PlaneGeometry(.97,.95),new THREE.ShadowMaterial({opacity:.13}));contact.receiveShadow=true;contact.position.z=.105;board.add(contact);
const ui={ink:'#192b49',muted:'#5f708b',blue:'#2868ef',line:'#d5ddeb',red:'#d13d54',green:'#08725b',bg:'#fbfcff'};
function box(x,y,w,h,r=16,fill='#fff',stroke){g.beginPath();g.roundRect(x,y,w,h,r);if(fill){g.fillStyle=fill;g.fill()}if(stroke){g.strokeStyle=stroke;g.lineWidth=2;g.stroke()}}
function text(s,x,y,size=28,col=ui.ink,weight=500,font='Inter'){g.font=`${weight} ${size}px ${font}`;g.fillStyle=col;g.fillText(s,x,y)}
function line(x,y,xx,yy,col=ui.line,width=2){g.beginPath();g.moveTo(x,y);g.lineTo(xx,yy);g.strokeStyle=col;g.lineWidth=width;g.stroke()}
function landingText(s,x,y,size,col,at,t){const k=t<at?0:t>at+.65?1:OM.spring(t-at,.53,24),scale=lerp(.72,1,k);g.save();g.translate(x,y);g.scale(scale,scale);text(s,0,0,size,col,650,'Mono');g.restore()}
function header(){box(0,0,1800,1125,20,ui.bg);box(0,0,1800,83,20,'#fff');for(let i=0;i<3;i++){g.beginPath();g.arc(40+i*25,41,7,0,7);g.fillStyle=['#eea5a5','#ebd497','#99cbb7'][i];g.fill()}text('agent replay',145,51,26,ui.ink,650);text('BUILT-IN DEMO · RECONSTRUCTED VIEW',1015,50,19,ui.muted,500,'Mono');line(0,83,1800,83)}
const codeLines=['def put(self, key, value):','    self._data[key] = value','    if len(self._data) > self.capacity:','        self._data.popitem(last=True)'];
// The same small detail carries each boundary; no full-window cross-fades.
const FALSE_X=206+32*.602*31;
function clipBox(r){g.beginPath();g.roundRect(r.x,r.y,r.w,r.h,r.r||0);g.clip()}
function codeCarry(t){return OM.morphRect(t,7.95,8.72,{x:696,y:891,w:28,h:28,r:14},{x:111,y:380,w:1560,h:364,r:12},{curve:ease.cubicInOut})}
function testCarry(t){return OM.morphRect(t,13.42,14.25,{x:FALSE_X,y:672,w:96,h:4,r:2},{x:85,y:346,w:1630,h:400,r:22},{curve:ease.quintInOut})}
function productCarry(t){return OM.morphRect(t,16.95,17.85,{x:125,y:692,w:245,h:4,r:2},{x:0,y:83,w:1800,h:1042,r:16},{curve:ease.quintInOut})}
function drawPrompt(t){
 box(0,0,1800,1125,60,'#fff');g.save();g.translate(100,0);g.scale(.27,1);
 const typed=OM.typeOn(t,.3,'Replay the last run',{cps:12});text(typed.str,0,655,300,ui.ink,500);
 if(t<2.35&&typed.caret){g.font='500 300px Inter';box(g.measureText(typed.str).width+16,380,9,320,2,ui.blue)}g.restore();
 box(1400,170,285,785,130,ui.blue);g.save();g.translate(1460,0);g.scale(.27,1);text('↵',0,690,400,'#fff',600);g.restore();
}
function drawUI(t){
 g.clearRect(0,0,1800,1125);
 if(t<3.08)drawPrompt(t);
 if(t>=2.43){
  // The return key's tiny centre opens the working surface, rather than swapping its texture.
  g.save();if(t<3.08){g.beginPath();g.arc(1542,562,Math.max(.01,2300*p(t,2.43,3.08,ease.quintInOut)),0,Math.PI*2);g.clip()}
  header();
  const reading=p(t,8.2,8.8)*(1-p(t,16.5,16.95));
  g.save();g.globalAlpha=lerp(1,.25,reading);text('Fix LRU cache eviction',85,164,38,ui.ink,650);text('Codex  /  Python  /  17 events',85,207,23,ui.muted,450,'Mono');
  text(t<8.4?'The run said “Done.”':'Inspect the turning point.',85,300,48,ui.ink,600);g.restore();
  box(85,346,1630,400,22,'#f1f4fa');
  if(t<8.72){g.save();g.globalAlpha=1-p(t,8.2,8.68);text('pytest -q',125,410,25,ui.muted,500,'Mono');
   if(t<3.32)text('Running tests…',125,560,76,ui.ink,650,'Mono');else landingText('8 failed',125,560,104,ui.red,3.32,t);
   text('6 passed',135,622,32,ui.muted,500,'Mono');g.save();g.globalAlpha*=t>3.9&&t<5.5?.4:1;
   box(1300,435,340,110,55,t>3.32?'#f9e6e9':'#e7edf7');text(t>3.32?'REGRESSION':'RUNNING',1340,505,30,t>3.32?ui.red:ui.blue,650,'Mono');g.restore();g.restore();
  }
  if(t>=7.95&&t<14.25){
   const r=codeCarry(t);g.save();clipBox(r);box(111,430,1560,314,12,'#f1f4fa');
   text('src/cachekit/lru.py',125,402,23,ui.muted,500,'Mono');
   codeLines.forEach((str,i)=>{
    if(i===2)str=t>=11.65?'    if len(self._data) > self.capacity:':'    if len(self._data) >= self.capacity:';
    if(i===3)str=t>=12.2?'        self._data.popitem(last=False)':'        self._data.popitem(last=True)';
    const active=i===(t<11.25?2:3),colour=t>=12.2?ui.green:ui.blue;
    if(active)box(111,430+i*64,1560,58,7,t>=12.2?'#dcefe9':'#e2ebff');
    g.save();g.globalAlpha=active?1:.42;text(String(18+i),128,470+i*64,25,ui.muted,450,'Mono');text(str,206,470+i*64,32,active?(t>=12.2?colour:ui.ink):ui.muted,500,'Mono');g.restore();
   });
   if(t>=12.2)line(FALSE_X,674,FALSE_X+96*p(t,12.2,12.55),674,ui.green,4);
   g.restore();
  }
  // A two-pixel underline quietly grows into the historical test surface.
  if(t>=13.42){const r=testCarry(t);g.save();clipBox(r);box(r.x,r.y,r.w,r.h,r.r,'#f1f4fa',ui.green);
   g.save();g.globalAlpha=p(t,13.7,14.05);g.translate(r.x,r.y);g.scale(r.w/1630,r.h/400);
   text('HISTORICAL TEST RESULT',40,68,24,ui.muted,500,'Mono');
   if(t<15)text('Replaying tests…',40,217,62,ui.blue,650,'Mono');else landingText('14 passed',40,217,104,ui.green,15,t);
   text(t<15?'pytest -q':'All checks recovered in this demo run.',45,287,30,ui.muted,450);
   if(t>=15)line(40,348,285,348,ui.green,4);g.restore();g.restore();
  }
  const timelineOpacity=lerp(1,.22,reading);g.save();g.globalAlpha=timelineOpacity;
  text('EXECUTION TIMELINE',85,825,19,ui.muted,600,'Mono');
  const labels=['READ','SEARCH','EDIT','TEST','EDIT','PASS'],positions=[200,455,710,965,1220,1475];
  line(170,905,1640,905,'#d6deec',7);let scrub=lerp(965,710,p(t,6.05,7.65,ease.sineInOut));if(t>8.3)scrub=lerp(710,1475,p(t,12.65,15));line(170,905,scrub,905,ui.blue,7);
  positions.forEach((x,i)=>{box(x-64,875,128,60,14,i===3&&t<8.3?'#f9e6e9':'#fff',ui.line);text(labels[i],x-42,914,22,i===3&&t<8.3?ui.red:ui.muted,600,'Mono')});
  if(t<8.72||t>=12.65){g.save();g.globalAlpha*=t<12.65?1-p(t,7.95,8.25):p(t,12.65,13);g.beginPath();g.arc(scrub,905,14,0,7);g.fillStyle=ui.blue;g.fill();g.restore()}
  g.restore();
  if(t>=7.95&&t<8.72){const r=codeCarry(t);box(r.x,r.y,r.w,r.h,r.r,null,ui.blue)}
  text('BUILT-IN DEMO HISTORY',85,1042,19,ui.muted,450,'Mono');text('Recorded history · no autonomous repair',1120,1042,19,ui.muted,450);
  // The green result rule becomes the lower edge of actual product footage.
  if(t>=16.95){const r=productCarry(t);g.save();clipBox(r);box(0,83,1800,1042,0,'#0c1016');g.drawImage(video,0,83,1800,1042);
   if(t>17.75){g.save();g.globalAlpha=p(t,17.75,17.95);box(20,94,820,48,7,'#101824');text('ACTUAL PRODUCT · BUILT-IN DEMO RECORDING',40,126,23,'#bed4ff',500,'Mono');g.restore()}g.restore();
  }
  // A quiet detail at the window edge is planted before it carries the closing move.
  if(t>18.5){g.save();g.globalAlpha=p(t,18.5,18.8);g.fillStyle=ui.blue;g.beginPath();g.arc(1705,940,7,0,7);g.fill();g.restore()}
  g.restore();
 }
 tex.needsUpdate=true;
}

// A separate crisp title layer lives on the desk; it never replaces the physical scene.
function plaque(w,h){const cv=document.createElement('canvas');cv.width=1800;cv.height=Math.round(1800*h/w);const texture=new THREE.CanvasTexture(cv);texture.colorSpace=THREE.SRGBColorSpace;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));scene.add(mesh);return {cv,texture,mesh}}
const title=plaque(16,3),sub=plaque(16,1);
function paintTitle(t){const k=p(t,21.05,21.65);const q=title.cv.getContext('2d');q.clearRect(0,0,title.cv.width,title.cv.height);q.textAlign='center';q.fillStyle=ui.ink;q.font='650 133px Inter';q.fillText(t<20?'Don’t stop at “Done.”':'AGENT REPLAY',900,150);q.font='450 38px Inter';q.fillStyle=ui.muted;q.fillText(t<20?'Replay the run. Inspect the evidence.':'Replay the run. Inspect the evidence.',900,238);title.texture.needsUpdate=true;title.mesh.position.set(0,t<20?5:lerp(5,2.35,k),-.35);
const s=sub.cv.getContext('2d');s.clearRect(0,0,1800,sub.cv.height);s.textAlign='center';s.fillStyle=ui.blue;s.font='500 35px Mono';s.fillText('lyz1116-found.github.io/agent-replay/',900,55);s.fillStyle=ui.muted;s.font='450 20px Mono';s.fillText('OPEN SOURCE  /  CODING AGENT DEBUGGER',900,101);sub.texture.needsUpdate=true;sub.mesh.position.set(0,-3.35,-.35);sub.mesh.visible=t>21.65;
}
// The screen collapses into this physical play token, with the actor carrying its edge.
const token=rounded(1.65,1.65,.3,.35,blue);scene.add(token);const tri=new THREE.Shape();tri.moveTo(-.23,-.35);tri.lineTo(.36,0);tri.lineTo(-.23,.35);tri.closePath();const icon=new THREE.Mesh(new THREE.ShapeGeometry(tri),new THREE.MeshBasicMaterial({color:'#fffdf5'}));icon.position.z=.17;token.add(icon);

const KEYS=[{t:0,x:0,y:.5,zoom:.83},{t:2.35,x:0,y:.5,zoom:.83},{t:3.3,x:.3,y:.2,zoom:.94},{t:3.85,x:.3,y:.2,zoom:.94},{t:4.55,x:5.1,y:-1.45,zoom:2.35,curve:ease.expoInOut},{t:5.3,x:5.1,y:-1.45,zoom:2.35},{t:5.8,x:4.15,y:-1.85,zoom:1.75},{t:7.9,x:.8,y:-.95,zoom:1.35,curve:ease.sineInOut},{t:8.75,x:.6,y:.1,zoom:1.5},{t:10.95,x:.6,y:.1,zoom:1.5},{t:11.65,x:1.25,y:-.4,zoom:1.48},{t:12.6,x:1.25,y:-.4,zoom:1.48},{t:14.5,x:.5,y:.3,zoom:1.08},{t:16.45,x:.5,y:.3,zoom:1.08},{t:17.65,x:0,y:.7,zoom:.82},{t:19.7,x:0,y:.7,zoom:.82},{t:21.4,x:0,y:.6,zoom:.84},{t:24,x:0,y:.6,zoom:.84}];
const HAND=[{t:0,x:-4.8,y:-1.6},{t:.4,x:-4.8,y:-1.6},{t:1.95,x:3.6,y:-1.6},{t:2.4,x:3.6,y:-1.6},{t:3.1,x:4.7,y:-1.4},{t:3.55,x:4.7,y:-1.4},{t:3.85,x:5.1,y:-1.65},{t:5.45,x:5.1,y:-1.65},{t:5.75,x:1.016,y:-2.415},{t:6.05,x:1.016,y:-2.415},{t:7.65,x:-.774,y:-2.415},{t:8.2,x:-.774,y:-2.415},{t:8.75,x:3.6,y:.15},{t:10.9,x:3.6,y:.15},{t:11.65,x:3.9,y:-.8},{t:12.6,x:3.9,y:-.8},{t:13.4,x:-4.9,y:-3.5},{t:13.8,x:-4.9,y:-3.5},{t:15,x:4.8,y:-1.4},{t:16.7,x:4.8,y:-1.4},{t:18,x:5.4,y:-2.7},{t:19.7,x:6.2,y:-2.7},{t:20.65,x:6.2,y:-2.7},{t:21.4,x:1.5,y:-.9},{t:24,x:1.5,y:-.9}];
const clicks=[2.35,5.85,10.0,11.65,12.2,13.4,20.0];
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));const bokeh=new BokehPass(scene,camera,{focus:22,aperture:.000035,maxblur:.006});composer.addPass(bokeh);composer.addPass(new OutputPass());
let TRACK={};const video=document.getElementById('product');
function project(obj){if(!obj.visible)return {x:0,y:0,w:0,h:0,op:0};const b=new THREE.Box3().setFromObject(obj),pts=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const v=new THREE.Vector3(x,y,z).project(camera);pts.push([(v.x+1)*W/2,(1-v.y)*H/2])}const x=Math.min(...pts.map(v=>v[0])),y=Math.min(...pts.map(v=>v[1]));return {x,y,w:Math.max(...pts.map(v=>v[0]))-x,h:Math.max(...pts.map(v=>v[1]))-y,op:1}}
function handAt(t){let i=0;while(i<HAND.length-2&&t>HAND[i+1].t)i++;const a=HAND[i],b=HAND[i+1],k=p(t,a.t,b.t,ease.sineInOut);return {x:lerp(a.x,b.x,k),y:lerp(a.y,b.y,k)}}
async function seek(t){
 t=clamp(t,0,24);if(t>=16.95){const vt=9.4+clamp(t-17.85,0,2.8);if(Math.abs(video.currentTime-vt)>.005)await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=reject;video.currentTime=vt})}
 drawUI(t);paintTitle(t);title.mesh.material.opacity=clamp(1-p(t,3,3.5)+p(t,21.12,21.6));
 const open=p(t,2.4,3.05,ease.quintInOut),close=p(t,20,20.65,ease.quintInOut),carry=p(t,20.65,21.4,ease.quintInOut);
 const bw=lerp(8.8,13,open),bh=lerp(1.48,8.12,open);
 const impact=(at)=>t>at&&t<at+1?OM.ring(t-at,9,24):0;
 const boardHit=impact(2.98)*.018+impact(3.32)*.012+impact(15)*.009;
 board.scale.set(lerp(bw,1.65,close)*(1+boardHit),lerp(bh,1.65,close)*(1-boardHit*.6),1);board.position.set(4.994*close*(1-carry),lerp(lerp(-.4,-2.599,close),-.9,carry),0);board.rotation.set(.018*(1-close)+boardHit,-.025*(1-close)+boardHit*.5,-.014*(1-close)+boardHit*.4);
 screen.scale.set(.972,.955,1);board.visible=t<20.65;token.visible=t>=20.65;token.position.copy(board.position);
 const h=handAt(t),velocity=(handAt(t+.025).x-handAt(t-.025).x)/.05,moving=Math.abs(velocity)>.03;
 const grab=t>=5.75&&t<8.1,thinking=t>=8.9&&t<11.4;
 const startled=Math.sin(clamp((t-3.32)/.52)*Math.PI),reactionSize=1+.24*p(t,3.32,3.5)*(1-p(t,5.45,5.7));
 let sq=0,anticipation=0;for(const hit of clicks){sq+=OM.press(t,hit,{depth:.24}).sq;if(t>=hit-.16&&t<hit)anticipation+=Math.sin((t-hit+.16)/.16*Math.PI)*.12}
 let hop=0;for(const [at,dur,height] of [[14.98,.65,.75],[15.63,.43,.28]])if(t>at&&t<at+dur)hop+=Math.sin((t-at)/dur*Math.PI)*height;
 const step=moving&&!grab&&t<20?Math.abs(Math.sin(t*18))*.085:0;
 actor.position.set(h.x-startled*.19,h.y+hop+startled*.28+step-anticipation,.67+hop*.45+startled*.13);
 const size=1.12*reactionSize;
 actor.scale.set(size*(1+sq*.45+startled*.15+anticipation*.3),size*(1-sq*.35-startled*.16-anticipation*.6),1.12);
 const lean=clamp(velocity*.028,-.2,.2),turn=thinking?-.08:grab?.1:0;
 actor.rotation.set(.035+startled*.13,thinking?-.12:grab?-.06:Math.sin(hop*2)*.14,-lean+turn+impact(15.63)*.12);
 footL.rotation.z=moving?Math.sin(t*23)*.32:hop>0?-.22:0;footR.rotation.z=-footL.rotation.z;
 footL.position.y=-.53+(moving?Math.max(0,Math.sin(t*23))*.055:0);footR.position.y=-.53+(moving?Math.max(0,-Math.sin(t*23))*.055:0);
 handL.position.set(thinking?-.3:grab?-.56/size:-.56,thinking?-.15:grab?-.35/size:hop>0?.35:-.12,thinking?.46:grab?-.39:.15);
 const wave=t>21.85&&t<22.55?Math.sin((t-21.85)*24)*.13:0;
 handR.position.set(.56+wave,t>2.1&&t<2.5?.9:hop>0?.48:t>=21.4?.36+Math.abs(wave):grab?-.35:-.12,t<2.5?.32:.15);
 antenna.rotation.z=clamp(-lean*.7+impact(3.32)*.75+impact(15.63)*.6,-.5,.5);
 const emotion=drawFace(t);
 const last=clicks.filter(at=>at<=t).at(-1),age=t-(last??-10),ring=age>=0&&age<.42;
 interaction.visible=ring;interaction.position.set(actor.position.x+(grab?-.56:.4),actor.position.y+(grab?-.35:.22),.13);
 const spread=ring?p(t,last,last+.42,ease.quadOut):1;interaction.scale.setScalar(.3+spread*1.4);halo.material.opacity=ring?.25*(1-spread):0;halo2.material.opacity=ring?.08*(1-spread):0;
 const cam=OM.camera(t,KEYS);const float=(!moving||t>21.4)?0:.027;let shakeX=0,shakeY=0;for(const [at,amp] of [[2.98,.025],[3.32,.055],[12.2,.025],[15,.045],[21.25,.035]])if(t>=at&&t<at+.6){const s=OM.shake(t,at,{amp,decay:12,seed:Math.round(at*100)});shakeX+=s.x;shakeY+=s.y}
 camera.position.set(cam.x+float*Math.sin(t*1.7)+shakeX,cam.y+1.65+shakeY,22/cam.zoom);camera.lookAt(cam.x+shakeX,cam.y+shakeY,0);camera.updateMatrixWorld();
 bokeh.uniforms.focus.value=camera.position.distanceTo(new THREE.Vector3(cam.x,cam.y,.35));composer.render();
 TRACK={operator:project(actor),workspace:project(board.visible?board:token)};window.__emotion=emotion.name;
 document.getElementById('clock').textContent=`${t.toFixed(1)} / 24`;document.getElementById('scrub').value=t;
 return true;
}
window.__seek=seek;window.__track=()=>TRACK;window.__meta={dur:DUR,fps:60,cuts:[],inFrame:{operator:[0,24,'whole']}};
window.__events=()=>clicks.map((t,i)=>({t,name:['replay-click','grab-timeline','inspect-comparison','compare-reverted','direction-revealed','replay-tests','fold-window'][i]}));
window.__ready=Promise.all([document.fonts.load('500 32px Inter'),document.fonts.load('500 32px Mono'),new Promise((r,j)=>{if(video.readyState>=2)r();else {video.onloadeddata=r;video.onerror=j}})]).then(()=>seek(0)).then(()=>document.getElementById('loading').remove());
let playing=false,current=Number(new URLSearchParams(location.search).get('t')||0),epoch=0,busy=false;
function play(){playing=!playing;epoch=performance.now()-current*1000;document.getElementById('play').textContent=playing?'Pause':'Play'}
document.getElementById('play').onclick=play;document.getElementById('scrub').oninput=async e=>{playing=false;current=+e.target.value;await seek(current)};document.onkeydown=e=>{if(e.code==='Space'){e.preventDefault();play()}};
async function loop(now){if(playing&&!busy){busy=true;current=Math.min(23.99,(now-epoch)/1000);await seek(current);if(current>=23.99)playing=false;busy=false}requestAnimationFrame(loop)}
window.__ready.then(async()=>{await seek(current);requestAnimationFrame(loop)});
