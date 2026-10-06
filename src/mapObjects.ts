import { ASSETS } from './domain';
import type { MapObject } from './types';
import { TILE_WIDTH as TW } from './terrainGeometry';
export const PLAYER_COLORS = ['#c4ba99','#68a9ff','#ed6966','#65c881','#edd267','#60d5df','#c899e6','#aaaaac','#f59b61'];
export function tint(hex:string, amount:number) { const n=parseInt(hex.replace('#',''),16);return `rgb(${Math.min(255,Math.max(0,(n>>16)+amount))},${Math.min(255,Math.max(0,((n>>8)&255)+amount))},${Math.min(255,Math.max(0,(n&255)+amount))})`; }
function diamond(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number) {ctx.beginPath();ctx.moveTo(x,y-h);ctx.lineTo(x+w,y);ctx.lineTo(x,y+h);ctx.lineTo(x-w,y);ctx.closePath();}
export function polygon(ctx:CanvasRenderingContext2D, points:number[][], fill:string, stroke?:string) {ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function box(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,depth:number,color:string) {
 polygon(ctx,[[x-w,y-depth],[x,y-h-depth],[x+w,y-depth],[x,y+h-depth]],tint(color,25),'#272c3370');
 polygon(ctx,[[x-w,y-depth],[x,y+h-depth],[x,y+h],[x-w,y]],tint(color,-20),'#272c3370');
 polygon(ctx,[[x,y+h-depth],[x+w,y-depth],[x+w,y],[x,y+h]],color,'#272c3370');
}
export function renderObject(ctx:CanvasRenderingContext2D,o:MapObject,x:number,y:number,selected:boolean) {
 const a=ASSETS.find(a=>a.id===o.nativeId),color=PLAYER_COLORS[o.player]||PLAYER_COLORS[0];
 if(selected){ctx.lineWidth=2;ctx.strokeStyle='#b6dcff';diamond(ctx,x,y,(a?.size||1)*TW/2,(a?.size||1)*TW/4);ctx.stroke();}
 ctx.fillStyle='#0b1f2845';ctx.beginPath();ctx.ellipse(x+5,y+2,o.category==='building'?24:8,o.category==='building'?11:4,0,0,Math.PI*2);ctx.fill();
 if(o.category==='decoration') {
  if(/tree|树|forest|松|oak|pine/i.test((a?.name||'')+' '+(a?.english||''))||[349,348,350,351,411,413,414].includes(o.nativeId)) {
   ctx.fillStyle='#584e38';ctx.fillRect(x-1.5,y-15,3,17);
   const shade=((Math.floor(o.x)*13+Math.floor(o.y)*7)%15);
   if(o.nativeId===349){
    ctx.strokeStyle='#5d5139';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+1,y-28);ctx.moveTo(x+1,y-19);ctx.lineTo(x-6,y-28);ctx.stroke();
    const crowns=[[-9,-23,9], [7,-24,11],[-4,-35,11],[5,-39,8],[-11,-33,7],[12,-33,6]];
    for(const [dx,dy,r] of crowns){ctx.fillStyle=tint('#385b3c',shade+(dy<-30?13:0));ctx.beginPath();ctx.arc(x+dx,y+dy,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#b7c47622';ctx.beginPath();ctx.arc(x+dx-r*.25,y+dy-r*.3,r*.58,0,Math.PI*2);ctx.fill();}
    return;
   }
   polygon(ctx,[[x-11,y-7],[x,y-36],[x+11,y-7]],tint('#345e42',shade),'#253c3590');
   polygon(ctx,[[x-9,y-17],[x,y-40],[x+9,y-17]],tint('#48734c',shade));
   polygon(ctx,[[x-6,y-27],[x,y-44],[x+6,y-27]],tint('#577d54',shade));
  } else if([66,102,623].includes(o.nativeId)) {polygon(ctx,[[x-10,y],[x-8,y-9],[x+1,y-15],[x+11,y-7],[x+9,y+2],[x,y+5]],o.nativeId===66?'#b1a064':'#8f9693','#535d54');polygon(ctx,[[x-8,y-9],[x+1,y-15],[x+2,y-2]],o.nativeId===66?'#dec487':'#b7b9ad');}
  else if(o.nativeId===59){for(const [dx,dy] of [[-5,-3],[4,-2],[0,-8]]){ctx.fillStyle='#537847';ctx.beginPath();ctx.arc(x+dx,y+dy,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#a96b68';ctx.fillRect(x+dx,y+dy-2,2,2);}}
  else if(o.nativeId===600){ctx.strokeStyle='#bda986';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y-28);ctx.stroke();polygon(ctx,[[x,y-28],[x+12,y-25],[x,y-18]],color);}
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

