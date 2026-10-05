import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Grid2X2, Minus, Plus, Trees, Maximize2 } from 'lucide-react';
import { ASSETS, TERRAINS } from './domain';
import { nextZoom } from './viewportMath';
import type { Project, MapObject, Tool, Tile } from './types';

const TW = 38, TH = 19, EH = 3;
const PLAYER_COLORS = ['#c4ba99','#68a9ff','#ed6966','#65c881','#edd267','#60d5df','#c899e6','#aaaaac','#f59b61'];
const terrainColor = new Map(TERRAINS.map(t=>[t.id,t.color]));
function tint(hex:string, amount:number) { const n=parseInt(hex.replace('#',''),16);return `rgb(${Math.min(255,Math.max(0,(n>>16)+amount))},${Math.min(255,Math.max(0,((n>>8)&255)+amount))},${Math.min(255,Math.max(0,(n&255)+amount))})`; }
function diamond(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number) {ctx.beginPath();ctx.moveTo(x,y-h);ctx.lineTo(x+w,y);ctx.lineTo(x,y+h);ctx.lineTo(x-w,y);ctx.closePath();}
function polygon(ctx:CanvasRenderingContext2D, points:number[][], fill:string, stroke?:string) {ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function box(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,depth:number,color:string) {
 polygon(ctx,[[x-w,y-depth],[x,y-h-depth],[x+w,y-depth],[x,y+h-depth]],tint(color,25),'#272c3370');
 polygon(ctx,[[x-w,y-depth],[x,y+h-depth],[x,y+h],[x-w,y]],tint(color,-20),'#272c3370');
 polygon(ctx,[[x,y+h-depth],[x+w,y-depth],[x+w,y],[x,y+h]],color,'#272c3370');
}
function renderObject(ctx:CanvasRenderingContext2D,o:MapObject,x:number,y:number,selected:boolean) {
 const a=ASSETS.find(a=>a.id===o.nativeId),color=PLAYER_COLORS[o.player]||PLAYER_COLORS[0];
 if(selected){ctx.lineWidth=2;ctx.strokeStyle='#b6dcff';diamond(ctx,x,y,24,12);ctx.stroke();}
 ctx.fillStyle='#0b1f2845';ctx.beginPath();ctx.ellipse(x+5,y+2,o.category==='building'?24:8,o.category==='building'?11:4,0,0,Math.PI*2);ctx.fill();
 if(o.category==='decoration') {
  if(/tree|树|forest|松|oak|pine/i.test((a?.name||'')+' '+(a?.english||''))||[349,348,350,351,411,413,414].includes(o.nativeId)) {
   ctx.fillStyle='#584e38';ctx.fillRect(x-1.5,y-15,3,17);
   const shade=((Math.floor(o.x)*13+Math.floor(o.y)*7)%15);
   polygon(ctx,[[x-11,y-7],[x,y-36],[x+11,y-7]],tint('#345e42',shade),'#253c3590');
   polygon(ctx,[[x-9,y-17],[x,y-40],[x+9,y-17]],tint('#48734c',shade));
   polygon(ctx,[[x-6,y-27],[x,y-44],[x+6,y-27]],tint('#577d54',shade));
  } else if([66,102].includes(o.nativeId)) {polygon(ctx,[[x-10,y],[x-8,y-9],[x+1,y-15],[x+11,y-7],[x+9,y+2],[x,y+5]],o.nativeId===66?'#b1a064':'#8f9693','#535d54');polygon(ctx,[[x-8,y-9],[x+1,y-15],[x+2,y-2]],o.nativeId===66?'#dec487':'#b7b9ad');}
  else { ctx.fillStyle=a?.color||'#a78751';ctx.beginPath();ctx.arc(x,y-5,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#dba86b';ctx.fillRect(x-3,y-5,6,4); }
 } else if(o.category==='building') {
  const castle=[82].includes(o.nativeId),tower=[79,598,234,235,236].includes(o.nativeId),main=[109,621,584].includes(o.nativeId);const w=Math.max(12,(a?.size||2)*TW*.40),h=w/2,wallHeight=tower?34:main?26:18;
  box(ctx,x,y,w,h,castle?36:wallHeight,'#b6aa88');
  if(castle) { [[-17,-1],[17,-1],[0,9]].forEach(([dx,dy])=>{box(ctx,x+dx,y+dy,7,4,40,'#c4baa0');for(let i=-1;i<=1;i++)box(ctx,x+dx+i*4,y+dy-37,2,1.5,5,'#d5c8a8');});ctx.fillStyle='#414441';ctx.fillRect(x-3,y-12,6,14);}
  else {const roofTop=wallHeight+(main?28:tower?16:21);polygon(ctx,[[x-w-3,y-wallHeight],[x,y-roofTop],[x+w+3,y-wallHeight],[x,y+h-wallHeight+1]],'#695c55','#4b4941');polygon(ctx,[[x,y-roofTop],[x+w+3,y-wallHeight],[x,y+h-wallHeight+1]],'#87725e');ctx.fillStyle='#45483d';ctx.fillRect(x-3,y-6,5,10);if(main){ctx.strokeStyle='#bfbba3';ctx.lineWidth=2;for(const dx of [-w*.55,w*.55]){ctx.beginPath();ctx.moveTo(x+dx,y+4);ctx.lineTo(x+dx,y-17);ctx.stroke();}}}
  ctx.strokeStyle='#b6b5a2';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y-33);ctx.lineTo(x,y-48);ctx.stroke();polygon(ctx,[[x,y-48],[x+13,y-44],[x,y-40]],color);
 } else {
  const horse=[38,448,329,561,283].includes(o.nativeId);ctx.fillStyle=horse?'#836b52':'#c8b995';
  if(horse){ctx.beginPath();ctx.ellipse(x,y-5,7,4,0,0,Math.PI*2);ctx.fill();ctx.fillRect(x-5,y-4,2,7);ctx.fillRect(x+4,y-4,2,7);ctx.fillRect(x+5,y-12,3,8);}
  ctx.fillStyle=color;ctx.fillRect(x-3,y-(horse?17:12),6,9);ctx.fillStyle='#e1c8a6';ctx.beginPath();ctx.arc(x,y-(horse?20:15),3,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#d8dce0';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x+5,y-4);ctx.lineTo(x+5,y-23);ctx.stroke();if(!horse){ctx.strokeStyle='#3d4449';ctx.beginPath();ctx.moveTo(x-2,y-3);ctx.lineTo(x-3,y+3);ctx.moveTo(x+2,y-3);ctx.lineTo(x+3,y+3);ctx.stroke();}
 }

}

interface Props {project:Project; tool:Tool; terrain:number; asset:number; player:number; brush:number; selected:string|null; onSelect:(id:string|null)=>void; onCommit:(p:Project,label:string)=>void; onHover:(tile:{x:number,y:number}|null)=>void; fitSignal:number; grid:boolean; onGrid:()=>void}
export default function MapViewport({project,tool,terrain,asset,player,brush,selected,onSelect,onCommit,onHover,fitSignal,grid,onGrid}:Props) {
 const canvasRef=useRef<HTMLCanvasElement>(null),miniRef=useRef<HTMLCanvasElement>(null),containerRef=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState({w:800,h:550}),[camera,setCamera]=useState({x:400,y:80,zoom:1}),[hover,setHover]=useState<{x:number,y:number}|null>(null),[draft,setDraft]=useState<Project|null>(null),[showObjects,setShowObjects]=useState(true),[space,setSpace]=useState(false);
 const active=draft||project; const draftRef=useRef<Project|null>(null); const interaction=useRef<{mode:'pan'|'paint'|'move'; x:number;y:number; cx:number;cy:number;id?:string}|null>(null);
 const fit=useCallback(()=>{let z=Math.min((size.w-95)/((project.map.width+project.map.height)*TW/2),(size.h-100)/((project.map.width+project.map.height)*TH/2));setCamera({x:size.w/2+(project.map.height-project.map.width)*TW/4*z,y:(size.h-(project.map.width+project.map.height)*TH/2*z)/2+35,zoom:Math.min(1.6,z)});},[size,project.map.width,project.map.height]);
 useEffect(()=>{const el=containerRef.current;if(!el)return;const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({w:r.width,h:r.height});});observer.observe(el);return()=>observer.disconnect();},[]);
 useEffect(()=>{fit();},[fit,fitSignal]);
 useEffect(()=>{const down=(e:KeyboardEvent)=>{if(e.key==='Escape'&&interaction.current){interaction.current=null;draftRef.current=null;setDraft(null);setSpace(false);return;}if(e.code==='Space'&&!/INPUT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)){e.preventDefault();setSpace(true);}},up=(e:KeyboardEvent)=>{if(e.code==='Space')setSpace(false);};window.addEventListener('keydown',down);window.addEventListener('keyup',up);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};},[]);
 const screenToMap=(sx:number,sy:number)=>{const rx=(sx-camera.x)/camera.zoom,ry=(sy-camera.y)/camera.zoom;const base={x:Math.floor(ry/TH+rx/TW),y:Math.floor(ry/TH-rx/TW)};let best=base,bestDepth=-Infinity;for(let dy=-1;dy<=4;dy++)for(let dx=-1;dx<=4;dx++){const x=base.x+dx,y=base.y+dy;if(x<0||y<0||x>=project.map.width||y>=project.map.height)continue;const tile=project.map.tiles[y*project.map.width+x],tx=(x-y)*TW/2,ty=(x+y+1)*TH/2-tile.elevation*EH;const distance=Math.abs(rx-tx)/(TW/2)+Math.abs(ry-ty)/(TH/2);if(distance<=1.001&&x+y>bestDepth){best={x,y};bestDepth=x+y;}}return best;};
 const bounds=(p:{x:number,y:number})=>p.x>=0&&p.y>=0&&p.x<project.map.width&&p.y<project.map.height;
 const zoom=(factor:number,sx=size.w/2,sy=size.h/2)=>setCamera(c=>{const z=nextZoom(c.zoom,factor),r=z/c.zoom;return{x:sx-(sx-c.x)*r,y:sy-(sy-c.y)*r,zoom:z};});
 useEffect(()=>{const c=canvasRef.current;if(!c)return;const handler=(e:WheelEvent)=>{e.preventDefault();const r=c.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);};c.addEventListener('wheel',handler,{passive:false});return()=>c.removeEventListener('wheel',handler);},[size]);
 useEffect(()=>{const c=canvasRef.current;if(!c)return;const dpr=Math.min(window.devicePixelRatio||1,2);c.width=size.w*dpr;c.height=size.h*dpr;const ctx=c.getContext('2d')!;ctx.scale(dpr,dpr);ctx.fillStyle='#202932';ctx.fillRect(0,0,size.w,size.h);
  ctx.fillStyle='#788a9830';for(let y=20;y<size.h;y+=24)for(let x=20;x<size.w;x+=24)ctx.fillRect(x,y,1,1);
  ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.zoom,camera.zoom);
  const {width,height,tiles}=active.map;
  for(let sum=0;sum<width+height-1;sum++)for(let y=Math.max(0,sum-width+1);y<=Math.min(height-1,sum);y++){const x=sum-y,t=tiles[y*width+x];if(!t)continue;const sx=(x-y)*TW/2,sy=(x+y+1)*TH/2-(t.elevation||0)*EH,screenX=sx*camera.zoom+camera.x,screenY=sy*camera.zoom+camera.y;if(screenX<-45||screenX>size.w+45||screenY<-60||screenY>size.h+50)continue;
   const color=terrainColor.get(t.terrain)||'#837b6c',noise=((x*374761393+y*668265263)>>>0)%13-6;
   if(t.elevation>0){polygon(ctx,[[sx-TW/2,sy],[sx,sy+TH/2],[sx,sy+TH/2+t.elevation*EH],[sx-TW/2,sy+t.elevation*EH]],tint(color,-28));polygon(ctx,[[sx,sy+TH/2],[sx+TW/2,sy],[sx+TW/2,sy+t.elevation*EH],[sx,sy+TH/2+t.elevation*EH]],tint(color,-45));}
   diamond(ctx,sx,sy,TW/2+.3,TH/2+.25);ctx.fillStyle=tint(color,noise);ctx.fill();
   if(grid&&camera.zoom>.38){ctx.strokeStyle='#17292230';ctx.lineWidth=.6;ctx.stroke();}
   if([1,4,22,23].includes(t.terrain)&&camera.zoom>.4){ctx.strokeStyle='#cbe2df20';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(sx-4,sy+1);ctx.lineTo(sx+5,sy+1);ctx.stroke();}
  }
  if(showObjects){[...active.objects].sort((a,b)=>(a.x+a.y)-(b.x+b.y)).forEach(o=>{const tile=tiles[Math.min(height-1,Math.max(0,Math.floor(o.y)))*width+Math.min(width-1,Math.max(0,Math.floor(o.x)))],sx=(o.x-o.y)*TW/2,sy=(o.x+o.y)*TH/2-(tile?.elevation||0)*EH;if(sx*camera.zoom+camera.x<-70||sx*camera.zoom+camera.x>size.w+70||sy*camera.zoom+camera.y<-50||sy*camera.zoom+camera.y>size.h+90)return;renderObject(ctx,o,sx,sy,o.id===selected);});}
  if(hover&&bounds(hover)){const r=tool==='terrain'?brush-1:0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const x=hover.x+dx,y=hover.y+dy;if(x<0||y<0||x>=width||y>=height||dx*dx+dy*dy>r*r+.1)continue;const t=tiles[y*width+x];diamond(ctx,(x-y)*TW/2,(x+y+1)*TH/2-(t?.elevation||0)*EH,TW/2,TH/2);ctx.fillStyle=tool==='erase'?'#ed73635e':'#beddf83a';ctx.fill();ctx.strokeStyle='#d3e8ffb0';ctx.lineWidth=1.2/camera.zoom;ctx.stroke();}if(tool==='object'){ctx.globalAlpha=.6;const a=ASSETS.find(a=>a.id===asset);renderObject(ctx,{id:'preview',nativeId:asset,player,x:hover.x+.5,y:hover.y+.5,rotation:0,label:'',category:a?.category||'unit'},(hover.x-hover.y)*TW/2,(hover.x+hover.y+1)*TH/2,false);ctx.globalAlpha=1;}}
  ctx.restore();
  const picked=active.objects.find(o=>o.id===selected);if(picked&&showObjects){const tile=tiles[Math.floor(picked.y)*width+Math.floor(picked.x)];const sx=(picked.x-picked.y)*TW/2*camera.zoom+camera.x,sy=((picked.x+picked.y)*TH/2-(tile?.elevation||0)*EH)*camera.zoom+camera.y-45*camera.zoom-16;ctx.font='600 12px system-ui';ctx.textAlign='center';const label=picked.label||`ID ${picked.nativeId}`,w=ctx.measureText(label).width+16;ctx.fillStyle='#192537ed';ctx.fillRect(sx-w/2,sy-13,w,23);ctx.strokeStyle='#8ab4ff';ctx.lineWidth=1;ctx.strokeRect(sx-w/2,sy-13,w,23);ctx.fillStyle='#edf0f5';ctx.fillText(label,sx,sy+3);}
 },[active,size,camera,hover,tool,brush,selected,grid,showObjects,asset,player]);
 useEffect(()=>{const c=miniRef.current;if(!c)return;const ctx=c.getContext('2d')!;const w=active.map.width,h=active.map.height;c.width=w;c.height=h;const image=ctx.createImageData(w,h);active.map.tiles.forEach((t,i)=>{const color=terrainColor.get(t.terrain)||'#837b6c',n=parseInt(color.slice(1),16);image.data[i*4]=n>>16;image.data[i*4+1]=(n>>8)&255;image.data[i*4+2]=n&255;image.data[i*4+3]=255;});ctx.putImageData(image,0,0);active.objects.filter(o=>o.category!=='decoration').forEach(o=>{ctx.fillStyle=PLAYER_COLORS[o.player];ctx.fillRect(o.x-1,o.y-1,2,2);});},[active]);
 const position=(e:React.PointerEvent)=>{const r=e.currentTarget.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 const hitObject=(p:{x:number,y:number})=>[...project.objects].reverse().filter(o=>Math.hypot(o.x-p.x-.5,o.y-p.y-.5)<(o.category==='building'?2:1.5)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
 const paint=(p:{x:number,y:number})=>{if(!bounds(p))return;let next=draftRef.current;if(!next)next={...project,map:{...project.map,tiles:project.map.tiles.map(t=>({...t}))},objects:[...project.objects]};if(tool==='terrain'){const r=brush-1;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const x=p.x+dx,y=p.y+dy;if(bounds({x,y})&&dx*dx+dy*dy<=r*r+.1)next.map.tiles[y*next.map.width+x]={...next.map.tiles[y*next.map.width+x],terrain};}}else if(tool==='erase'){next.objects=next.objects.filter(o=>o.locked||Math.hypot(o.x-p.x-.5,o.y-p.y-.5)>brush);}draftRef.current=next;setDraft({...next});};
 const pointerDown=(e:React.PointerEvent<HTMLCanvasElement>)=>{e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);const s=position(e),p=screenToMap(s.x,s.y);if(e.button===1||e.button===2||space||tool==='pan'){interaction.current={mode:'pan',x:s.x,y:s.y,cx:camera.x,cy:camera.y};return;}if(!bounds(p))return;if(tool==='terrain'||tool==='erase'){interaction.current={mode:'paint',x:s.x,y:s.y,cx:0,cy:0};paint(p);}else if(tool==='object'){const a=ASSETS.find(a=>a.id===asset);const o:MapObject={id:crypto.randomUUID(),nativeId:asset,player,x:p.x+.5,y:p.y+.5,rotation:0,label:a?.name||`ID ${asset}`,category:a?.category||'unit'};onCommit({...project,objects:[...project.objects,o]},`放置 ${o.label}`);onSelect(o.id);}else{const hit=hitObject(p);onSelect(hit?.id||null);if(hit&&!hit.locked)interaction.current={mode:'move',x:s.x,y:s.y,cx:0,cy:0,id:hit.id};}};
 const pointerMove=(e:React.PointerEvent<HTMLCanvasElement>)=>{const s=position(e),p=screenToMap(s.x,s.y);setHover(bounds(p)?p:null);onHover(bounds(p)?p:null);const i=interaction.current;if(!i)return;if(i.mode==='pan')setCamera(c=>({...c,x:i.cx+s.x-i.x,y:i.cy+s.y-i.y}));else if(i.mode==='paint')paint(p);else if(i.mode==='move'&&bounds(p)&&Math.hypot(s.x-i.x,s.y-i.y)>3){const next={...project,objects:project.objects.map(o=>o.id===i.id?{...o,x:p.x+.5,y:p.y+.5}:o)};draftRef.current=next;setDraft(next);}};
 const finish=()=>{if(draftRef.current){onCommit(draftRef.current,interaction.current?.mode==='move'?'移动对象':tool==='terrain'?'绘制地形':'移除对象');draftRef.current=null;setDraft(null);}interaction.current=null;};
 return <div className="viewport" ref={containerRef}>
  <canvas ref={canvasRef} tabIndex={0} aria-label="可编辑等距地图" data-testid="map-canvas" style={{width:size.w,height:size.h,cursor:space||tool==='pan'?'grab':tool==='select'?'default':'crosshair'}} onContextMenu={e=>e.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finish} onPointerCancel={()=>{interaction.current=null;draftRef.current=null;setDraft(null);}} onPointerLeave={()=>{if(!interaction.current){setHover(null);onHover(null);}}}/>
  <div className="viewport-caption"><span className="live-dot"/>等距场景 <span className="muted">/ 原创示意素材</span></div>
  <div className="view-actions"><button title="显示网格 (G)" className={grid?'active':''} onClick={onGrid}><Grid2X2 size={15}/></button><button title="显示/隐藏对象" className={showObjects?'active':''} onClick={()=>setShowObjects(!showObjects)}><Trees size={15}/></button><i/><button title="适合窗口 (F)" onClick={fit}><Maximize2 size={15}/></button></div>
  <div className="map-compass"><span>N</span><svg viewBox="0 0 30 30" aria-hidden="true"><path d="M9 23 23 9M12 9H23V20" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></div>
  <div className="minimap"><canvas ref={miniRef} title="点击定位地图" onClick={e=>{const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*project.map.width,y=(e.clientY-r.top)/r.height*project.map.height;setCamera(c=>({...c,x:size.w/2-(x-y)*TW/2*c.zoom,y:size.h/2-(x+y)*TH/2*c.zoom}));}}/><span>{active.map.width} × {active.map.height}</span></div>
  <div className="zoom-controls"><button title="缩小" onClick={()=>zoom(.8)}><Minus size={14}/></button><span>{Math.round(camera.zoom*100)}%</span><button title="放大" onClick={()=>zoom(1.25)}><Plus size={14}/></button><button title="居中" onClick={fit}><Crosshair size={14}/></button></div>
  <div className="viewport-hint">{tool==='terrain'?'拖动绘制 · 一笔一次撤销':tool==='object'?'点击放置 · 选择后可拖动':tool==='erase'?'拖动移除未锁定对象':'拖动对象 · 空格 + 拖动平移'}<span>滚轮缩放</span></div>
 </div>;
}
