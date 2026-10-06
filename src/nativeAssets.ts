import type { MapObject } from './types';
export interface AssetEntry { id:string; relativePath:string; name:string; kind:string; bytes:number; previewable:boolean }
export interface AssetStatus { mounted:boolean; revision:string; counts:Record<string,number>; total:number; skipped:number; truncated:boolean; layout:string; dat:null|{id:string;version:string;sha256:string;civilizations:{id:number;name:string}[]}; storage:string; gameTested:false; cacheBytes:number }
export interface AssetPreview { assetId:string; imageUrl:string; width:number; height:number; hotspot:[number,number]; frameCount:number; frameIndex?:number; kind:'sld'|'dds'; limitations:string[]; sha256:string; revision:string }
export interface UnitBinding { unitId:number; civilizationId:number; resolved:boolean; reason?:string; assetId?:string; graphicId?:number; filename?:string; footprint?:[number,number]; frameCount?:number; angleCount?:number; childGraphics?:number; tileWidth?:number }
export interface NativeSprite { image:HTMLImageElement; hotspot:[number,number]; scale:number; assetId:string; label:string }
export interface NativeRenderState { revision:string; sprites:Record<string,NativeSprite>; terrains:Record<number,HTMLImageElement> }
export const emptyNativeRender=():NativeRenderState=>({revision:'',sprites:{},terrains:{}});
export const spriteKey=(object: Pick<MapObject,'player'|'nativeId'>)=>`${object.player}:${object.nativeId}`;
export function nativeSpriteBounds(sprite:NativeSprite,x:number,y:number){return{x:x-sprite.hotspot[0]*sprite.scale,y:y-sprite.hotspot[1]*sprite.scale,width:sprite.image.width*sprite.scale,height:sprite.image.height*sprite.scale,point:{x,y}};}
export function renderNativeObject(ctx:CanvasRenderingContext2D,object:MapObject,x:number,y:number,state?:NativeRenderState){const sprite=state?.sprites[spriteKey(object)];if(!sprite)return false;const b=nativeSpriteBounds(sprite,x,y);ctx.drawImage(sprite.image,b.x,b.y,b.width,b.height);return true;}
export const nativePixelCost=(state:NativeRenderState)=>Object.values(state.sprites).reduce((n,s)=>n+s.image.width*s.image.height,0)+Object.values(state.terrains).reduce((n,s)=>n+s.width*s.height,0);
export function canAssignPreview(state:NativeRenderState,preview:AssetPreview){return nativePixelCost(state)+preview.width*preview.height<=16*1024*1024&&Object.keys(state.sprites).length+Object.keys(state.terrains).length<16;}
export async function assetRequest<T>(path:string,value?:unknown):Promise<T>{const response=await fetch(`/api/assets/${path}`,value===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'本地素材操作失败');return result as T;}
export function loadPreviewImage(preview:AssetPreview):Promise<HTMLImageElement>{return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('预览缓存已失效，请重新解码。'));image.src=preview.imageUrl;});}
export const limitationLabels:Record<string,string>={'flat-texture-only':'仅平面纹理','no-terrain-blending':'未还原地形混合／海岸','no-water-animation':'无水面动画','standing-graphic-frame-0':'仅站立图形第 0 帧','manual-preview-civilization':'文明为手动预览选项','no-age-upgrades':'不应用时代升级','no-child-graphics':'未组合子图形','no-direction-selection':'不匹配方向','Static frame 0 main BC1 image only; animation and frame reuse are unsupported.':'仅第 0 帧主图；无动画／帧复用','Shadow, outline, damage and player-color rendering are unsupported.':'阴影／轮廓／损伤／玩家色未实现','Skipped layers and later frames are checked for boundaries, not decoded.':'其他帧与图层仅校验边界','Synthetic fixtures verified; actual game-resource appearance is unverified.':'已验证人工样本；游戏素材外观未实测'};

/** Experimental per-tile affine texture projection. No game blend masks are implied. */
export function renderNativeTerrain(ctx:CanvasRenderingContext2D,image:HTMLImageElement,points:{x:number;y:number}[],vertices:{x:number;y:number}[],x:number,y:number,step:number){
 const uv=vertices.map(v=>({x:(v.x-x)/step*image.width,y:(v.y-y)/step*image.height}));
 const u1=uv[1].x-uv[0].x,v1=uv[1].y-uv[0].y,u2=uv[2].x-uv[0].x,v2=uv[2].y-uv[0].y,det=u1*v2-u2*v1;if(Math.abs(det)<1e-6)return;
 const x1=points[1].x-points[0].x,y1=points[1].y-points[0].y,x2=points[2].x-points[0].x,y2=points[2].y-points[0].y,a=(x1*v2-x2*v1)/det,b=(y1*v2-y2*v1)/det,c=(x2*u1-x1*u2)/det,d=(y2*u1-y1*u2)/det;
 ctx.save();ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,points[0].x-a*uv[0].x-c*uv[0].y,points[0].y-b*uv[0].x-d*uv[0].y);ctx.drawImage(image,0,0);ctx.restore();
}
