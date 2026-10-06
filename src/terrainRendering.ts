import { nativeSpriteBounds, renderNativeObject, renderNativeTerrain, spriteKey, type NativeRenderState } from './nativeAssets';
import { ASSETS, TERRAINS } from './domain';
import type { MapObject } from './types';
import { foregroundPolygon, objectGround, projectVertex, tileTriangles, tileVertices, surfaceHeight, type HeightField, type Point, type SurfaceTriangle, type Vertex, slopeShade } from './terrainGeometry';
import { polygon, renderObject, tint } from './mapObjects';

const colors=new Map(TERRAINS.map(t=>[t.id,t.color]));
const water=new Set([1,4,22,23]);
export const terrainColor=(id:number)=>colors.get(id)||'#837b6c';
export interface Camera { x:number; y:number; zoom:number }
export interface SceneOptions { width:number; height:number; camera:Camera; grid:boolean; contours:boolean; showObjects:boolean; selected:string|null; nativeAssets?:NativeRenderState }
const mix=(a:string,b:string,t:number)=>{const n=parseInt(a.slice(1),16),m=parseInt(b.slice(1),16);return '#'+[16,8,0].map(s=>Math.round(((n>>s)&255)*(1-t)+((m>>s)&255)*t).toString(16).padStart(2,'0')).join('');};
const noise=(x:number,y:number)=>{let n=Math.imul(x+317,374761393)^Math.imul(y+571,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
function path(ctx:CanvasRenderingContext2D,points:Point[]){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();}
/** Buildings occupy a volume: sort/mask at the front of their drawn native footprint. */
export function objectDepth(o:MapObject):number{return o.x+o.y+(o.category==='building'?(ASSETS.find(a=>a.id===o.nativeId)?.size||2)*.8:0);}
export function objectBounds(o:MapObject,field:HeightField,nativeAssets?:NativeRenderState){const p=projectVertex(objectGround(field,o));const native=nativeAssets?.sprites[spriteKey(o)];if(native)return nativeSpriteBounds(native,p.x,p.y);const a=ASSETS.find(a=>a.id===o.nativeId),w=o.category==='building'?Math.max(24,(a?.size||2)*19):o.category==='decoration'?20:11,h=o.category==='building'?82:o.category==='decoration'?52:32;return {x:p.x-w,y:p.y-h,width:w*2,height:h+(o.category==='building'?w/2+3:14),point:p};}
function cornerColor(field:HeightField,x:number,y:number,own:number){let result=terrainColor(own),count=1;for(let dy=-1;dy<=0;dy++)for(let dx=-1;dx<=0;dx++){const tx=x+dx,ty=y+dy;if(tx<0||ty<0||tx>=field.map.width||ty>=field.map.height)continue;const id=field.map.tiles[ty*field.map.width+tx].terrain;if(water.has(id)!==water.has(own))continue;result=mix(result,terrainColor(id),1/++count);}return result;}
function contours(ctx:CanvasRenderingContext2D,t:SurfaceTriangle,zoom:number){const zs=t.vertices.map(v=>v.z),lo=Math.min(...zs),hi=Math.max(...zs);for(let level=Math.ceil(lo+.001);level<hi+.0001;level++){const cuts:Point[]=[];for(let i=0;i<3;i++){const a=t.vertices[i],b=t.vertices[(i+1)%3];if((a.z<level)===(b.z<level)||a.z===b.z)continue;const f=(level-a.z)/(b.z-a.z);cuts.push(projectVertex({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:level}));}if(cuts.length===2){ctx.beginPath();ctx.moveTo(cuts[0].x,cuts[0].y);ctx.lineTo(cuts[1].x,cuts[1].y);ctx.strokeStyle=level%2?'#253a3655':'#e4dcb18a';ctx.lineWidth=.7/zoom;ctx.stroke();}}}
export function renderScene(ctx:CanvasRenderingContext2D,field:HeightField,objects:MapObject[],options:SceneOptions){
 const {width,height,camera,grid,showObjects,selected}=options,{map}=field;
 const trianglesAt=(x:number,y:number)=>tileTriangles(field,x,y),step=Math.max(1,Math.min(8,Math.ceil(.18/camera.zoom))),columns=Math.ceil(map.width/step),rows=Math.ceil(map.height/step);
 const previewTriangles=(x:number,y:number):SurfaceTriangle[]=>{if(step===1)return trianglesAt(x,y);const right=Math.min(map.width,x+step),bottom=Math.min(map.height,y+step),corners:Vertex[]=[{x,y,z:0},{x:right,y,z:0},{x:right,y:bottom,z:0},{x,y:bottom,z:0},{x:(x+right)/2,y:(y+bottom)/2,z:0}];corners.forEach(v=>v.z=surfaceHeight(field,v.x,v.y));return [0,1,2,3].map(i=>{const vertices:[Vertex,Vertex,Vertex]=[corners[i],corners[(i+1)%4],corners[4]],points=vertices.map(projectVertex) as [Point,Point,Point];return {vertices,points,tileX:x,tileY:y,shade:slopeShade(...vertices),bounds:{minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))},maxDepth:right+bottom};});};
 ctx.fillStyle='#202932';ctx.fillRect(0,0,width,height);ctx.fillStyle='#788a981c';for(let y=20;y<height;y+=24)for(let x=20;x<width;x+=24)ctx.fillRect(x,y,1,1);
 ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.zoom,camera.zoom);
 // Small cutaway at the map edge exposes relief without turning every cell into a pillar.
 for(const edge of ['x','y'] as const){const length=edge==='x'?map.height:map.width;for(let i=0;i<length;i++){const x=edge==='x'?map.width-1:i,y=edge==='x'?i:map.height-1,v=tileVertices(field,x,y),indices=edge==='x'?[1,2]:[2,3],a=v[indices[0]],b=v[indices[1]];const p=[projectVertex(a),projectVertex(b),projectVertex({...b,z:-1.2}),projectVertex({...a,z:-1.2})];path(ctx,p);ctx.fillStyle=edge==='x'?'#63594a':'#796c52';ctx.fill();}}
 
 for(let sum=0;sum<columns+rows-1;sum++)for(let row=Math.max(0,sum-columns+1);row<=Math.min(rows-1,sum);row++){
  const x=(sum-row)*step,y=row*step,cx=Math.min(map.width-.5,x+step/2),cy=Math.min(map.height-.5,y+step/2),tile=map.tiles[Math.floor(cy)*map.width+Math.floor(cx)],center=projectVertex({x:cx,y:cy,z:step===1?tile.elevation:surfaceHeight(field,cx,cy)}),sx=center.x*camera.zoom+camera.x,sy=center.y*camera.zoom+camera.y;
  if(sx<-45*step*camera.zoom||sx>width+45*step*camera.zoom||sy<-(165+19*step)*camera.zoom||sy>height+(165+19*step)*camera.zoom)continue;
  const triangles=previewTriangles(x,y),base=terrainColor(tile.terrain),variation=(noise(x,y)-.5)*7;
  // An opaque underpaint keeps antialiased fan edges from revealing the dark canvas.
  path(ctx,[triangles[0].points[0],triangles[0].points[1],triangles[1].points[1],triangles[2].points[1]]);ctx.fillStyle=tint(base,variation);ctx.fill();
  for(const i of [0,3,1,2]){
   const triangle=triangles[i];path(ctx,triangle.points);
   if(camera.zoom>.30){const a=triangle.vertices[0],b=triangle.vertices[1],edge={x:(triangle.points[0].x+triangle.points[1].x)/2,y:(triangle.points[0].y+triangle.points[1].y)/2},blend=mix(cornerColor(field,a.x,a.y,tile.terrain),cornerColor(field,b.x,b.y,tile.terrain),.5),gradient=ctx.createLinearGradient(center.x,center.y,edge.x,edge.y);gradient.addColorStop(0,tint(base,triangle.shade+variation));gradient.addColorStop(1,tint(blend,triangle.shade+variation));ctx.fillStyle=gradient;}else ctx.fillStyle=tint(base,triangle.shade+variation);
   ctx.fill(); // Hairline overlap prevents antialias seams between adjacent triangles.
   ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1/camera.zoom;ctx.stroke();
   const texture=options.nativeAssets?.terrains[tile.terrain];if(texture){renderNativeTerrain(ctx,texture,triangle.points,triangle.vertices,x,y,step);path(ctx,triangle.points);ctx.fillStyle=triangle.shade<0?`rgba(0,0,0,${-triangle.shade/150})`:`rgba(255,255,255,${triangle.shade/180})`;ctx.fill();}
   if(options.contours)contours(ctx,triangle,camera.zoom);
  }
  if(camera.zoom>.45){ctx.save();path(ctx,tileVertices(field,x,y).slice(0,4).map(projectVertex));ctx.clip();
   for(let i=0;i<(water.has(tile.terrain)?2:5);i++){const u=noise(x*7+i,y*3+i),v=noise(x*5+i+91,y*11+i),p=projectVertex({x:x+u,y:y+v,z:surfaceHeight(field,x+u,y+v)});ctx.strokeStyle=water.has(tile.terrain)?'#c9e3de30':noise(x+i,y)> .5?'#d8d1a52b':'#243b302f';ctx.lineWidth=water.has(tile.terrain)?.7:.75;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+(water.has(tile.terrain)?4:1.5),p.y+(water.has(tile.terrain)?0:-1.5));ctx.stroke();}
   ctx.restore();
  }
  if(grid&&camera.zoom>.28){path(ctx,tileVertices(field,x,y).slice(0,4).map(projectVertex));ctx.strokeStyle='#17292250';ctx.lineWidth=.6/camera.zoom;ctx.stroke();}
 }
 // Objects use a depth plane. Remove only foreground terrain polygons, so ridges can
 // hide trunks and units while taller silhouettes remain visible above the crest.
 if(showObjects){const sprite=document.createElement('canvas');sprite.width=256;sprite.height=240;const sc=sprite.getContext('2d')!;
  for(const object of [...objects].sort((a,b)=>objectDepth(a)-objectDepth(b))){const bounds=objectBounds(object,field,options.nativeAssets),p=bounds.point;if((bounds.x+bounds.width)*camera.zoom+camera.x<0||bounds.x*camera.zoom+camera.x>width||(bounds.y+bounds.height)*camera.zoom+camera.y<0||bounds.y*camera.zoom+camera.y>height)continue;
   const native=options.nativeAssets?.sprites[spriteKey(object)],left=native?Math.floor(bounds.x)-3:p.x-128,top=native?Math.floor(bounds.y)-3:p.y-160,sw=native?Math.ceil(bounds.width)+6:256,sh=native?Math.ceil(bounds.height)+6:240;if(sprite.width!==sw)sprite.width=sw;if(sprite.height!==sh)sprite.height=sh;sc.clearRect(0,0,sw,sh);sc.save();sc.translate(-left,-top);if(!renderNativeObject(sc,object,p.x,p.y,options.nativeAssets))renderObject(sc,object,p.x,p.y,false);sc.globalCompositeOperation='destination-out';sc.fillStyle='#000';
   // Local candidate tiles, derived from the isometric viewing ray and sprite extent.
   const back=Math.max(0,Math.floor(bounds.y/19-(bounds.x+bounds.width)/38+field.minElevation*9/19)-1),front=Math.min(map.height-1,Math.ceil((bounds.y+bounds.height)/19-bounds.x/38+field.maxElevation*9/19)+1);
   for(let y=back;y<=front;y++)for(let x=Math.max(0,Math.floor(y+bounds.x/19)-1);x<=Math.min(map.width-1,Math.ceil(y+(bounds.x+bounds.width)/19)+1);x++){
    if(x+y+2<=objectDepth(object))continue;
    for(const t of trianglesAt(x,y)){if(t.maxDepth<=objectDepth(object)||t.bounds.maxX<bounds.x||t.bounds.minX>bounds.x+bounds.width||t.bounds.maxY<bounds.y||t.bounds.minY>bounds.y+bounds.height)continue;const points=foregroundPolygon(t,objectDepth(object));if(points.length<3||Math.max(...points.map(v=>v.x))<bounds.x||Math.min(...points.map(v=>v.x))>bounds.x+bounds.width||Math.max(...points.map(v=>v.y))<bounds.y||Math.min(...points.map(v=>v.y))>bounds.y+bounds.height)continue;path(sc,points);sc.fill();}
   }
   sc.restore();ctx.drawImage(sprite,left,top);
   if(object.id===selected){const half=(ASSETS.find(a=>a.id===object.nativeId)?.size||1)/2,footprint=[{x:object.x-half,y:object.y-half},{x:object.x+half,y:object.y-half},{x:object.x+half,y:object.y+half},{x:object.x-half,y:object.y+half}].map(v=>projectVertex({...v,z:surfaceHeight(field,v.x,v.y)}));path(ctx,footprint);ctx.strokeStyle='#b6dcff';ctx.lineWidth=1.6/camera.zoom;ctx.stroke();}
  }
 }
 ctx.restore();
}
