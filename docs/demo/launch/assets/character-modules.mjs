// The dot observes the process. It never causes a fix or a passing test.
export const palette={blue:'#83b9ff',red:'#ff7687',green:'#84e0ba',ink:'#edf2f9',muted:'#91a1b6',edge:'#35465d',panel:'#101925'};
export const definitions=[
 {id:'curious-inspector',width:1000,height:500,duration:2.5,poster:1.75,anchor:[500,250],usage:'探近 → 停顿 → 后退半步 → 再看一眼。小点检查候选修改，不自动判定根因。'},
 {id:'regression-recoil',width:1000,height:500,duration:2.5,poster:1.2,anchor:[500,250],usage:'3→8 failed 先发生，小点随后收缩、受惊后退，再转向追查。数字来自内置 LRU Demo。'},
 {id:'evidence-match',width:1000,height:500,duration:3,poster:2.55,anchor:[500,250],usage:'小点依次看 REPORTED 和 ACTUAL，重复代码行对齐后才落下 VERIFIED；是编辑性示意。'},
 {id:'recovery-release',width:1000,height:500,duration:2.5,poster:1.75,anchor:[500,250],usage:'测试先从 RUNNING 变为 14 passed，小点才放松、轻轻浮起、安稳落下。'},
 {id:'timeline-guide',width:1000,height:500,duration:2.8,poster:1.8,anchor:[500,250],usage:'小点带路经过时间轴，走过候选编辑后折返；最后停在 EDIT，供接真实产品画面。'},
 {id:'play-invitation',width:1000,height:500,duration:2.6,poster:2.2,anchor:[650,250],usage:'小点回望、等待观众跟上，落位后展开为播放按钮。配 CTA 使用，末尾稳定不循环闪动。'},
];
const C=palette;
const clamp=x=>Math.max(0,Math.min(1,x));
const lerp=(a,b,p)=>a+(b-a)*p;
const sm=(a,b,t)=>{const p=clamp((t-a)/(b-a));return p*p*(3-2*p)};
const eo=x=>1-(1-clamp(x))**3;
const f=x=>Number(x).toFixed(2);
const text=(x,y,s,size=18,color=C.ink,extra='')=>`<text x="${f(x)}" y="${f(y)}" fill="${color}" font-size="${size}" ${extra}>${s}</text>`;
function box(x,y,w,h,color=C.edge){return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${C.panel}" fill-opacity=".96" stroke="${color}" stroke-opacity=".7"/>`}
// No face or limbs: offset highlight = direction of attention, body = intent.
// Adaptation for this film: two line eyes, no mouth/brows; mood follows events.
function eyes(r,look,mood){
 const u=r/30,dx=look*2.5;
 let d='M-8 -3v7 M6 -3v7';
 if(mood==='curious')d='M-9 -4l2 8 M5 -2l2 5';
 if(mood==='startled')d='M-8 -7v13 M6 -7v13';
 if(mood==='thinking')d='M-10 0l5 2 M4 2l5 -2';
 if(mood==='relieved')d='M-11 2q4 -7 8 0 M3 2q4 -7 8 0';
 if(mood==='invite')d='M-10 -3v7 M3 -3v7';
 return `<g transform="translate(${f(dx)} -1) scale(${f(u)})"><path d="${d}" fill="none" stroke="#102033" stroke-width="2.8" stroke-linecap="round"/></g>`;
}
function dot(x,y,{r=22,sx=1,sy=1,color=C.blue,look=1,tilt=0,trail=0,alpha=1,emotion='neutral'}={}){
 let s=`<g opacity="${f(alpha)}">`;
 for(let i=1;i<=4;i++)s+=`<ellipse cx="${f(x-i*trail)}" cy="${f(y+i*.8)}" rx="${f(r*(1-i*.17))}" ry="${f(r*.4)}" fill="${color}" opacity="${f(.13*(1-i/5))}"/>`;
 s+=`<g transform="translate(${f(x)} ${f(y)}) rotate(${f(tilt)}) scale(${f(sx)} ${f(sy)})"><circle r="${r+3}" fill="${color}" opacity=".22" filter="url(#halo)"/><circle r="${r}" fill="${color}"/>${eyes(r,look,emotion)}</g></g>`;return s;
}
function inspect(t){
 const arrive=eo((t-.15)/.65),retreat=sm(1.08,1.3,t),again=sm(1.55,1.95,t);
 const x=180+330*arrive-38*retreat+26*again,y=263-18*Math.sin(arrive*Math.PI);
 const attention=sm(.65,.9,t);
 return box(590,158,220,145)+text(618,190,'CANDIDATE',12,C.muted,'letter-spacing="2"')+text(641,258,'&gt;=',62,C.red)+`<path d="M535 250H572" stroke="${C.blue}" stroke-dasharray="2 7" opacity="${f(attention*.7)}"/>`+dot(x,y,{sx:1+.15*Math.sin(arrive*Math.PI),sy:1-.12*Math.sin(arrive*Math.PI),look:1,tilt:-10*attention,trail:8*(1-arrive)});
}
function recoil(t){
 const change=sm(.7,.85,t),reaction=clamp((t-.88)/.45),jump=Math.sin(reaction*Math.PI),back=eo((t-.95)/.5),resume=sm(1.85,2.3,t);
 const x=360-70*back+18*resume,y=280-46*jump;
 return box(500,120,340,220,change>.5?C.red:C.edge)+text(528,155,'TEST RESULT',12,C.muted,'letter-spacing="2"')+text(532,250,change>.5?'8':'3',94,C.red)+text(612,246,'failed',29,C.red)+text(530,300,change>.5?'6 passed':'11 passed',16,C.muted)+dot(x,y,{sx:1+.24*Math.sin(clamp((t-.85)/.22)*Math.PI),sy:1-.2*Math.sin(clamp((t-.85)/.22)*Math.PI),color:change>.5?C.red:C.blue,look:resume>.2?-1:1,tilt:-14*jump,trail:back>0&&back<1?-6:0});
}
function evidence(t){
 const visit=eo((t-.12)/.55),cross=sm(.85,1.5,t),settle=sm(1.75,2.15,t),stamp=sm(2.15,2.5,t);
 const x=lerp(130,310,visit)+380*cross-190*settle,y=330-30*Math.sin(cross*Math.PI);
 const lineShift=18*(1-sm(1.4,1.85,t));
 let s=box(130,120,330,145)+box(540,120,330,145);
 s+=text(155,153,'REPORTED',13,C.blue,'letter-spacing="2"')+text(565,153,'ACTUAL',13,C.green,'letter-spacing="2"');
 s+=text(155,222,'return value + 1',22,C.ink)+text(565,222+lineShift,'return value + 1',22,C.ink);
 s+=`<path d="M310 280V330H690V280" fill="none" stroke="${C.blue}" stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${f(1-sm(.6,1.8,t))}" opacity=".6"/>`;
 s+=`<rect x="149" y="191" width="286" height="43" rx="5" fill="${C.green}" opacity="${f(.09*sm(1.8,2.05,t))}"/><rect x="559" y="191" width="286" height="43" rx="5" fill="${C.green}" opacity="${f(.09*sm(1.8,2.05,t))}"/>`;
 s+=dot(x,y,{color:stamp>.5?C.green:C.blue,look:cross<.5?1:-1,trail:cross>0&&cross<1?6:0});
 s+=`<g opacity="${f(stamp)}" transform="translate(0 ${f(8*(1-stamp))})"><rect x="419" y="377" width="162" height="42" rx="7" fill="${C.panel}" stroke="${C.green}" stroke-opacity=".5"/>${text(450,404,'VERIFIED',15,C.green,'letter-spacing="1.8"')}</g>`;
 return s;
}
function recovery(t){
 const passed=sm(.85,1,t),release=clamp((t-1.1)/.8),hop=Math.sin(release*Math.PI),settle=sm(1.9,2.25,t);
 let s=box(480,120,380,220,passed>.5?C.green:C.edge);
 s+=text(508,155,'TEST RUN',12,C.muted,'letter-spacing="2"');
 if(passed<.5){s+=text(510,235,'RUNNING',37,C.muted);const x=510+220*sm(0,.85,t);s+=`<path d="M510 285H820" stroke="${C.edge}" stroke-width="3"/><path d="M510 285H${f(x)}" stroke="${C.blue}" stroke-width="3"/>`;}
 else s+=text(510,250,'14',90,C.green)+text(635,247,'passed',29,C.green)+text(510,298,'14 / 14 tests',15,C.muted);
 s+=dot(330,280-38*hop,{sx:1+.15*Math.sin(clamp((t-1)/.18)*Math.PI),sy:1-.13*Math.sin(clamp((t-1)/.18)*Math.PI),color:passed>.5?C.green:C.blue,look:1,tilt:7*hop,r:22+1.5*settle});return s;
}
function guide(t){
 const forward=eo((t-.12)/1.05),brake=sm(1.2,1.42,t),back=sm(1.5,2.1,t);
 const x=140+610*forward-250*back,y=295-14*Math.sin(back*Math.PI);
 let s=`<path d="M110 295H900" stroke="${C.edge}" stroke-width="2"/>`;
 [{x:250,label:'READ'},{x:500,label:'EDIT'},{x:750,label:'TEST'}].forEach(a=>{
  const active=a.label==='EDIT'&&back>.8;
  s+=`<circle cx="${a.x}" cy="295" r="${active?7:4}" fill="${active?C.blue:C.edge}"/><rect x="${a.x-70}" y="190" width="140" height="66" rx="10" fill="${C.panel}" stroke="${active?C.blue:C.edge}"/>${text(a.x,231,a.label,16,active?C.blue:C.muted,'text-anchor="middle" letter-spacing="1.5"')}`;
 });
 s+=dot(x,y,{sx:1+.18*brake*(1-back),sy:1-.15*brake*(1-back),look:t<1.4?1:-1,trail:t<1.2?9*(1-forward):back>0&&back<1?-5:0});
 return s;
}
function invitation(t){
 const approach=eo((t-.15)/.6),wait=sm(.85,1.1,t),arrive=sm(1.35,1.95,t),morph=sm(1.95,2.35,t);
 const x=240+170*approach+240*arrive,y=250-14*Math.sin(arrive*Math.PI),r=22+36*morph;
 let s=`<path d="M205 250H${f(x-28)}" stroke="${C.edge}" stroke-width="1.5" opacity="${f(.7*(1-morph))}"/>`;
 s+=dot(x,y,{r,look:wait>.5&&arrive<.2?-1:1,sx:1+.07*Math.sin(approach*Math.PI),sy:1-.07*Math.sin(approach*Math.PI),trail:arrive>0&&arrive<1?7:0});
 s+=`<path d="M${f(x-11)} ${f(y-22)}L${f(x+24)} ${f(y)}L${f(x-11)} ${f(y+22)}Z" fill="#080d14" opacity="${f(morph)}"/>`;
 return s;
}
const functions={'curious-inspector':inspect,'regression-recoil':recoil,'evidence-match':evidence,'recovery-release':recovery,'timeline-guide':guide,'play-invitation':invitation};
export function character(x,y,options={}){return dot(x,y,options)}
export const poses={curious:{emotion:'curious',look:1,tilt:-12,sx:.95,sy:1.05},startled:{emotion:'startled',look:1,color:C.red,sx:1.2,sy:.82,tilt:-12},thinking:{emotion:'thinking',look:-1,tilt:8},relieved:{emotion:'relieved',look:1,color:C.green,sx:1.05,sy:.95},guide:{emotion:'thinking',look:-1,trail:-8},invite:{emotion:'invite',look:-1,r:26}};
export function poseFrame(name){return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><filter id="halo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5"/></filter></defs>${dot(128,128,{r:30,...poses[name]})}</svg>`}
export function frame(id,t,font=''){
 const d=definitions.find(d=>d.id===id);if(!d)throw Error(id);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}"><defs><style>${font}text{font-family:KitMono,monospace}</style><filter id="halo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5"/></filter></defs>${functions[id](t)}</svg>`;
}
