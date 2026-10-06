import { ASSETS, TERRAINS } from '../domain';
import type { Project } from '../types';

/** Content fingerprint only for stale-draft detection, never authentication. Excludes the native blob. */
export function projectRevision(project: Project): string {
  const text = JSON.stringify({id:project.id,name:project.name,description:project.description,seed:project.seed,
    map:project.map,objects:project.objects,story:project.story,behavior:project.behavior,customAi:project.customAi,
    native:project.native ? {sha256:project.native.sha256,importedObjectIds:project.native.importedObjectIds}:undefined,
    updatedAt:project.updatedAt});
  let a=2166136261, b=5381;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return `${project.id}:${text.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}
/** Allowlisted, bounded data sent to DeepSeek. Never spread a Project or its native envelope. */
export function makeProjectContext(project: Project, selectedObjectId: string | null = null) {
  const counts:Record<string,number>={};let min=16,max=0;
  for(const tile of project.map.tiles){counts[tile.terrain]=(counts[tile.terrain]||0)+1;min=Math.min(min,tile.elevation);max=Math.max(max,tile.elevation);}
  const samples:number[][]=[];
  const step=Math.max(1,Math.ceil(project.map.width/12));
  for(let y=0;y<project.map.height;y+=step)for(let x=0;x<project.map.width;x+=step){const tile=project.map.tiles[y*project.map.width+x];samples.push([x,y,tile.terrain,tile.elevation]);}
  const chosen=project.objects.find(o=>o.id===selectedObjectId);
  // Prefer authored units/buildings to hundreds of generated trees. Preserve a selected tree too.
  const ordered=[...(chosen?[chosen]:[]),...project.objects.filter(o=>o.id!==chosen?.id&&o.category!=='decoration'),...project.objects.filter(o=>o.id!==chosen?.id&&o.category==='decoration')];
  const items=ordered.slice(0,150).map(o=>({id:o.id,nativeId:o.nativeId,label:o.label.slice(0,500),player:o.player,x:o.x,y:o.y,rotation:o.rotation,category:o.category,locked:!!o.locked}));
  return {projectId:project.id,revision:projectRevision(project),name:project.name,imported:!!project.native,
    map:{width:project.map.width,height:project.map.height,terrainCounts:counts,elevationRange:[min,max],samples},
    objects:{total:project.objects.length,items},story:{total:project.story.length,items:project.story.slice(0,40).map(n=>({id:n.id,name:n.name,enabled:n.enabled,delay:n.delay,kind:n.kind,text:n.text.slice(0,1000),player:n.player,x:n.x,y:n.y,duration:n.duration,...(n.objectId?{objectId:n.objectId}:{})}))},
    selectedObjectId:chosen?.id??null,
    catalog:{terrains:TERRAINS.map(t=>({id:t.id,name:t.name,passable:t.passable})),objects:ASSETS.map(a=>({id:a.id,name:a.name,english:a.english,category:a.category,size:a.size}))}};
}
