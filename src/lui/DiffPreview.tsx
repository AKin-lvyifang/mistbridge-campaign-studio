import { useEffect, useRef } from 'react';
import { TERRAINS } from '../domain';
import type { Project } from '../types';
import type { Proposal } from './types';

function MapThumbnail({project,before}:{project:Project;before?:Project}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return;
    const {width,height,tiles}=project.map;canvas.width=width;canvas.height=height;
    const colors=new Map(TERRAINS.map(t=>[t.id,t.color]));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const t=tiles[y*width+x];ctx.fillStyle=colors.get(t.terrain)??'#727777';ctx.fillRect(x,y,1,1);
      ctx.fillStyle=`rgba(255,255,255,${t.elevation*.025})`;ctx.fillRect(x,y,1,1);
      const old=before&&x<before.map.width&&y<before.map.height?before.map.tiles[y*before.map.width+x]:undefined;
      if(before&&(!old||t.terrain!==old.terrain||t.elevation!==old.elevation)){ctx.fillStyle='rgba(89,211,245,.55)';ctx.fillRect(x,y,1,1);}
    }
    const previous=new Map(before?.objects.map(o=>[o.id,o]));
    for(const o of project.objects){if(o.x<0||o.y<0||o.x>=width||o.y>=height)continue;const old=previous.get(o.id);ctx.fillStyle=before&&(!old||old.x!==o.x||old.y!==o.y)?'#fff0a4':o.category==='decoration'?'#2d4933':o.player===2?'#e78c74':'#e5e5d1';const size=o.category==='building'?2:1;ctx.fillRect(Math.floor(o.x),Math.floor(o.y),size,size);}
  },[project,before]);
  return <canvas ref={ref} role="img" aria-label={before?'提案预览，蓝色显示地形或高度变化，浅黄色显示新增或移动对象':'当前地图鸟瞰缩略图'}/>;
}
export function DiffPreview({before,proposal}:{before:Project;proposal:Proposal}){
  return <div className="lui-map-preview"><figure><MapThumbnail project={before}/><figcaption>当前 · {before.map.width} × {before.map.height}</figcaption></figure><figure><MapThumbnail project={proposal.next} before={before}/><figcaption>提案 · {proposal.next.map.width} × {proposal.next.map.height}</figcaption></figure><small>蓝：地形 / 高度变化 · 黄：新增 / 移动对象 · 鸟瞰示意</small></div>;
}
