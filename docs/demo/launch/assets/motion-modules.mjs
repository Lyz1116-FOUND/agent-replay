export const palette = { blue:'#83b9ff', red:'#ff7687', green:'#84e0ba', ink:'#edf2f9', muted:'#8597ae', edge:'#34475f', panel:'#111a26' };
const clamp = x => Math.min(1, Math.max(0,x));
const ease = x => 1 - (1-clamp(x))**3;
const smooth = (a,b,t) => { const x=clamp((t-a)/(b-a)); return x*x*(3-2*x); };
const lerp=(a,b,p)=>a+(b-a)*p;
const fmt=x=>Number(x).toFixed(2);
export const definitions = [
  { id:'living-cursor', width:256, height:256, duration:1.6, poster:.98, anchor:[128,128], usage:'好奇探出 → 快速抵达 → 轻微压缩停住。单次动作；末帧居中，可接任意路径。' },
  { id:'event-stream', width:1600, height:500, duration:2.5, poster:1, anchor:[800,250], usage:'三轨过程纹理，左右穿行；切到锁定前冻结，再降低外围事件强度。不是特定运行数据。' },
  { id:'focus-lock', width:640, height:360, duration:1.6, poster:1.3, anchor:[320,180], usage:'透明中心的四角收束，套在现有事件上。选框内不自带内容；锁定时使用一次。' },
  { id:'backtrack-trail', width:1600, height:600, duration:2, poster:1.2, anchor:[200,300], usage:'从右侧失败点回溯到左侧候选修改。端点、路径可在源码修改，不代表自动根因定位。' },
  { id:'operator-insert', width:640, height:240, duration:1.6, poster:1.15, anchor:[320,120], usage:'独立的 > → >= 插入模块。放到重构代码行中；用透明视频或源码保留清晰字形。' },
];
export const chips = ['read','search','edit','test','failed'];
const C=palette;
function svg(w,h,body,font='') { return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><style>${font}text{font-family:KitMono,monospace}</style><filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5"/></filter></defs>${body}</svg>`; }
function chipBody(kind,x=0,y=0,opacity=1,scale=1){
 const config={read:['READ','file contents',C.blue],search:['SEARCH','find references','#b4a0ff'],edit:['EDIT','workspace change',C.blue],test:['TEST','run checks',C.green],failed:['TEST','failed',C.red]}[kind];
 const [title,subtitle,color]=config;
 return `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${scale})" opacity="${fmt(opacity)}"><rect x="1" y="1" width="238" height="82" rx="11" fill="${C.panel}" fill-opacity=".96" stroke="${color}" stroke-opacity=".36"/><rect x="1" y="21" width="2" height="42" rx="1" fill="${color}"/><circle cx="24" cy="26" r="3" fill="${color}"/><text x="38" y="31" fill="${color}" font-size="14" font-weight="600" letter-spacing="1.6">${title}</text><text x="23" y="59" fill="${C.muted}" font-size="12">${subtitle}</text><path d="M199 26h18m-9-4v8" fill="none" stroke="${color}" stroke-opacity=".4"/></g>`;
}
export function chip(kind,font=''){ return svg(240,84,chipBody(kind),font); }
function cursor(t){
 let x=128,y=128,sx=1,sy=1;
 if(t<.3){const p=smooth(0,.3,t);x=128-11*p;sx=1-.12*p;sy=1+.12*p;}
 else if(t<.68){const p=ease((t-.3)/.38);x=lerp(117,165,p);y=128-14*Math.sin(p*Math.PI);sx=1+.28*Math.sin(p*Math.PI);sy=1-.18*Math.sin(p*Math.PI);}
 else {const p=ease((t-.68)/.35);x=lerp(165,128,p);const beat=Math.sin(clamp((t-.68)/.35)*Math.PI);sx=1+.2*beat;sy=1-.2*beat;}
 const alpha=1-smooth(.6,1.1,t);
 return `<path d="M85 132 Q110 122 ${fmt(x)} ${fmt(y)}" stroke="${C.blue}" stroke-width="3" stroke-linecap="round" opacity="${fmt(.24*alpha)}" fill="none"/><ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(16*sx)}" ry="${fmt(16*sy)}" fill="${C.blue}" opacity=".32" filter="url(#glow)"/><ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(11*sx)}" ry="${fmt(11*sy)}" fill="${C.blue}"/><path d="M${fmt(x-4)} ${fmt(y-2)}v5m8-5v5" fill="none" stroke="#102033" stroke-width="1.5" stroke-linecap="round"/>`;
}
function stream(t){
 let s='';
 for(let row=0;row<3;row++){
  const cy=92+row*145;
  s+=`<path d="M0 ${cy}H1600" stroke="${C.edge}" stroke-opacity=".4"/>`;
  for(let j=0;j<8;j++){
   const speed=100+row*45;
   let x=((j*285 +row*125-t*speed+2600)%2280)-300;
   const y=cy-42;
   const kinds=['read','search','read','edit','test','read','failed','edit'];
   const opacity=row===1?.88:.42;
   s+=chipBody(kinds[(j+row)%8],x,y,opacity,row===1?1:.88);
   s+=`<path d="M${fmt(x+245)} ${cy}h34" stroke="${C.edge}" stroke-opacity=".5" stroke-dasharray="3 6"/>`;
  }
 }
 for(let i=0;i<36;i++){
  const x=((i*127-t*210+5000)%1840)-120, y=25+(i*71)%445;
  s+=`<path d="M${fmt(x)} ${y}h${20+(i*17)%62}" stroke="${C.muted}" stroke-opacity=".12" stroke-linecap="round"/>`;
 }
 return s;
}
function lock(t){
 const p=ease(t/.65), a=smooth(0,.12,t), w=lerp(600,410,p),h=lerp(310,180,p),x=320-w/2,y=180-h/2;
 const color=t<.8?C.blue:C.red, corner=24;
 let s=`<g opacity="${fmt(a)}">`;
 [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]].forEach(([xx,yy,dx,dy])=>{
  s+=`<path d="M${fmt(xx)} ${fmt(yy+dy*corner)}V${fmt(yy)}H${fmt(xx+dx*corner)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
 });
 const scan=lerp(y+12,y+h-12,smooth(.1,.7,t));
 s+=`<path d="M${fmt(x+10)} ${fmt(scan)}H${fmt(x+w-10)}" stroke="${C.blue}" stroke-width="1" opacity="${fmt(.5*(1-smooth(.65,.85,t)))}"/>`;
 s+=`<circle cx="${fmt(x+w+14)}" cy="${fmt(y)}" r="3" fill="${color}"/><text x="${fmt(x)}" y="${fmt(y-16)}" fill="${color}" font-size="11" letter-spacing="2">${t<.8?'INSPECT':'SELECTED'}</text></g>`;
 return s;
}
function point(p){const u=1-p;return {x:u*u*u*1400+3*u*u*p*1180+3*u*p*p*480+p*p*p*200,y:u*u*u*300+3*u*u*p*80+3*u*p*p*520+p*p*p*300};}
function trail(t){
 const p=smooth(.12,1.6,t);let s=`<path d="M1400 300C1180 80 480 520 200 300" fill="none" stroke="${C.edge}" stroke-width="1.5" stroke-dasharray="3 11" opacity=".65"/>`;
 for(let i=0;i<45;i++){const q=Math.max(0,p-i*.006);const pt=point(q);s+=`<circle cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="${fmt(2.5+2.5*(1-i/45))}" fill="${C.blue}" opacity="${fmt(.6*(1-i/45))}"/>`;}
 [.25,.5,.75].forEach(q=>{const pt=point(q),on=p>=q;s+=`<circle cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="5" fill="${on?C.blue:C.panel}" stroke="${C.blue}" stroke-opacity="${on?'.8':'.25'}"/>`;});
 const pt=point(p);s+=`<circle cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="13" fill="${C.blue}" opacity=".35" filter="url(#glow)"/><circle cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="7" fill="${C.blue}"/>`;
 if(p>.98){const r=10+12*smooth(1.6,1.95,t);s+=`<circle cx="200" cy="300" r="${fmt(r)}" fill="none" stroke="${C.blue}" stroke-opacity="${fmt(.6*(1-smooth(1.65,2,t)))}"/>`;}
 return s;
}
function operator(t){
 const p=smooth(.5,.85,t),flash=smooth(.5,.65,t)*(1-smooth(1.1,1.4,t));
 return `<defs><clipPath id="eq"><rect x="325" y="40" width="${fmt(p*90)}" height="150"/></clipPath></defs><rect x="216" y="36" width="220" height="168" rx="18" fill="${C.red}" fill-opacity="${fmt(flash*.09)}" stroke="${C.red}" stroke-opacity="${fmt(flash*.45)}"/><text x="238" y="162" fill="${C.ink}" font-size="120" font-weight="500">&gt;</text><g clip-path="url(#eq)"><text x="325" y="162" fill="${C.red}" font-size="120" font-weight="500">=</text></g><path d="M325 65V175" stroke="${C.red}" stroke-width="2" opacity="${fmt((1-p)*smooth(.2,.45,t))}"/>`;
}
export function frame(id,t,font=''){
 const d=definitions.find(d=>d.id===id);const fn={'living-cursor':cursor,'event-stream':stream,'focus-lock':lock,'backtrack-trail':trail,'operator-insert':operator}[id];
 if(!d||!fn)throw Error(id);
 return svg(d.width,d.height,fn(t),font);
}
