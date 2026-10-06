import { ASSETS, TERRAINS, generateMap, validateProject } from '../domain';
import type { MapObject, Project, StoryNode } from '../types';
import { projectRevision } from './context';
import type { CommandChange, DiffStats, LuiCommand, PlaceObject, Proposal, Region } from './types';

export class CommandError extends Error { constructor(message:string){super(message);this.name='CommandError';} }
const fail=(message:string):never=>{throw new CommandError(message);};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function shape(value:unknown,required:string[],optional:string[]=[]):Record<string,unknown>{
  if(!record(value))return fail('命令参数必须是 JSON 对象。');
  if(required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))return fail('命令含有缺失或未允许的字段。');
  return value;
}
function number(value:unknown,min:number,max:number,label:string,integer=false):number{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))return fail(`${label}必须为 ${min}–${max} 的${integer?'整数':'有限数值'}。`);
  return value;
}
function text(value:unknown,max:number,label:string,nonempty=true):string{if(typeof value!=='string'||value.length>max||(nonempty&&!value.trim()))return fail(`${label}必须是${nonempty?'非空':''}文本，最多 ${max} 字符。`);return value;}
function array<T>(value:unknown,max:number,parse:(v:unknown)=>T):T[]{if(!Array.isArray(value)||!value.length||value.length>max)return fail(`列表需有 1–${max} 项。`);return value.map(parse);}
const identifier=(v:unknown)=>text(v,200,'ID');
const ids=(v:unknown)=>{const result=array(v,200,identifier);if(new Set(result).size!==result.length)fail('同一列表不能重复引用 ID。');return result;};
function region(value:unknown):Region{const r=shape(value,['x','y','width','height']);return{x:number(r.x,0,479,'区域 X',true),y:number(r.y,0,479,'区域 Y',true),width:number(r.width,1,480,'区域宽度',true),height:number(r.height,1,480,'区域高度',true)};}
function story(value:unknown):StoryNode{
  const s=shape(value,['id','name','enabled','delay','kind','text','player','x','y','duration'],['objectId']);
  if(typeof s.enabled!=='boolean')fail('剧情启用状态必须是布尔值。');
  if(!['dialogue','camera','move','victory'].includes(s.kind as string))fail('只支持定时对白、镜头、移动、胜利节点。');
  return{id:identifier(s.id),name:text(s.name,240,'剧情名称'),enabled:s.enabled as boolean,delay:number(s.delay,0,86400,'触发秒数',true),kind:s.kind as StoryNode['kind'],text:text(s.text,10000,'剧情文本',false),player:number(s.player,1,8,'剧情玩家',true),x:number(s.x,0,479.999,'剧情 X'),y:number(s.y,0,479.999,'剧情 Y'),duration:number(s.duration,0,3600,'持续秒数',true),...(s.objectId!==undefined?{objectId:identifier(s.objectId)}:{})};
}
function placement(value:unknown):PlaceObject{
  const o=shape(value,['id','nativeId','player','x','y','rotation','label']);const nativeId=number(o.nativeId,0,65535,'原生 ID',true);
  if(!ASSETS.some(a=>a.id===nativeId))fail(`原生 ID ${nativeId} 不在已核对的目录中。`);
  return{id:identifier(o.id),nativeId,player:number(o.player,0,8,'玩家',true),x:number(o.x,0,479.999,'对象 X'),y:number(o.y,0,479.999,'对象 Y'),rotation:number(o.rotation,0,360,'朝向'),label:text(o.label,500,'对象名称',false)};
}
/** Reject extras, coercions, non-finite numbers, code/script intents and unsupported catalog IDs. */
export function validateCommands(value:unknown):LuiCommand[]{
  return array(value,24,raw=>{
    if(!record(raw)||typeof raw.type!=='string')return fail('缺少命令类型。');
    switch(raw.type){
      case 'paint_terrain':{const c=shape(raw,['type','region','terrain']);const terrain=number(c.terrain,0,255,'地形 ID',true);if(!TERRAINS.some(t=>t.id===terrain))fail('地形 ID 不在已核对的目录中。');return{type:'paint_terrain',region:region(c.region),terrain};}
      case 'set_elevation':{const c=shape(raw,['type','region','elevation']);return{type:'set_elevation',region:region(c.region),elevation:number(c.elevation,0,16,'原生高度',true)};}
      case 'place_objects':{const c=shape(raw,['type','objects']);return{type:'place_objects',objects:array(c.objects,128,placement)};}
      case 'move_objects':{const c=shape(raw,['type','moves']);const moves=array(c.moves,128,v=>{const o=shape(v,['id','x','y']);return{id:identifier(o.id),x:number(o.x,0,479.999,'对象 X'),y:number(o.y,0,479.999,'对象 Y')};});if(new Set(moves.map(o=>o.id)).size!==moves.length)fail('移动命令不能重复引用同一对象。');return{type:'move_objects',moves};}
      case 'remove_objects':case 'remove_story':{const c=shape(raw,['type','ids']);return{type:raw.type,ids:ids(c.ids)};}
      case 'generate_map':{const c=shape(raw,['type','seed','size','theme','forest']);if(!['river','highland','coast'].includes(c.theme as string))fail('不支持的地图主题。');return{type:'generate_map',seed:number(c.seed,0,0xffffffff,'种子',true),size:number(c.size,36,480,'地图尺寸',true),theme:c.theme as 'river'|'highland'|'coast',forest:number(c.forest,0,100,'森林密度')};}
      case 'add_story':{const c=shape(raw,['type','nodes']);return{type:'add_story',nodes:array(c.nodes,40,story)};}
      case 'edit_story':{const c=shape(raw,['type','node']);return{type:'edit_story',node:story(c.node)};}
      default:return fail(`不允许的命令：${String(raw.type).slice(0,80)}。`);
    }
  });
}
const coordinate=(p:Project,x:number,y:number)=>{if(x>=p.map.width||y>=p.map.height)fail('坐标超出当前地图范围；未进行裁剪或部分应用。');};
function objectFor(p:Project,id:string):MapObject{const object=p.objects.find(o=>o.id===id);if(!object)return fail(`找不到对象 ${id}。`);if(object.locked)fail(`对象 ${object.label||id} 已锁定，不能由助手修改。`);return object;}
function placeBounds(p:Project,o:{nativeId:number;x:number;y:number}){coordinate(p,o.x,o.y);const a=ASSETS.find(a=>a.id===o.nativeId);if(a&&(o.x<a.size/2||o.y<a.size/2||o.x>p.map.width-a.size/2||o.y>p.map.height-a.size/2))fail('对象占地超出地图边缘。');}
export function describeCommand(c:LuiCommand):CommandChange{
  switch(c.type){
    case 'paint_terrain':return{label:`绘制${TERRAINS.find(t=>t.id===c.terrain)?.name??c.terrain}`,detail:`(${c.region.x}, ${c.region.y}) · ${c.region.width} × ${c.region.height} 格 · 原生地形 ${c.terrain}`,destructive:false};
    case 'set_elevation':return{label:`设为原生高度 ${c.elevation}`,detail:`(${c.region.x}, ${c.region.y}) · ${c.region.width} × ${c.region.height} 格`,destructive:false};
    case 'place_objects':return{label:`放置 ${c.objects.length} 个对象`,detail:c.objects.map(o=>`${o.label||o.nativeId} / P${o.player} / (${o.x}, ${o.y})`).join('；'),destructive:false};
    case 'move_objects':return{label:`移动 ${c.moves.length} 个对象`,detail:c.moves.map(o=>`${o.id} → (${o.x}, ${o.y})`).join('；'),destructive:false};
    case 'remove_objects':return{label:`删除 ${c.ids.length} 个对象`,detail:c.ids.join('、'),destructive:true};
    case 'generate_map':return{label:`重新生成 ${c.size} × ${c.size} 地图`,detail:`主题 ${c.theme} · 种子 ${c.seed} · 森林 ${c.forest}% · 替换地图和对象，并清空当前剧情`,destructive:true};
    case 'add_story':return{label:`追加 ${c.nodes.length} 个定时剧情节点`,detail:c.nodes.map(n=>`${n.delay}s ${n.name}（${n.kind}）${n.text?`：${n.text}`:''}`).join('；'),destructive:false};
    case 'edit_story':return{label:`替换剧情节点「${c.node.name}」`,detail:`${c.node.id} · ${c.node.delay}s · ${c.node.kind} · ${c.node.text}`,destructive:true};
    case 'remove_story':return{label:`删除 ${c.ids.length} 个剧情节点`,detail:c.ids.join('、'),destructive:true};
  }
}
export function diffProjects(before:Project,after:Project,mapReplaced=false):DiffStats{
  const stats:DiffStats={terrainTiles:0,elevationTiles:0,objectsAdded:0,objectsMoved:0,objectsRemoved:0,storyAdded:0,storyEdited:0,storyRemoved:0,mapReplaced};
  for(let y=0;y<Math.max(before.map.height,after.map.height);y++)for(let x=0;x<Math.max(before.map.width,after.map.width);x++){
    const a=x<before.map.width&&y<before.map.height?before.map.tiles[y*before.map.width+x]:undefined;
    const b=x<after.map.width&&y<after.map.height?after.map.tiles[y*after.map.width+x]:undefined;
    if(a?.terrain!==b?.terrain)stats.terrainTiles++;if(a?.elevation!==b?.elevation)stats.elevationTiles++;
  }
  const oldObjects=new Map(before.objects.map(o=>[o.id,o])),newObjects=new Map(after.objects.map(o=>[o.id,o]));
  for(const [id,o]of newObjects){const old=oldObjects.get(id);if(!old)stats.objectsAdded++;else if(old.x!==o.x||old.y!==o.y||old.nativeId!==o.nativeId||old.rotation!==o.rotation)stats.objectsMoved++;}
  for(const id of oldObjects.keys())if(!newObjects.has(id))stats.objectsRemoved++;
  const oldNodes=new Map(before.story.map(n=>[n.id,n])),newNodes=new Map(after.story.map(n=>[n.id,n]));
  for(const[id,node]of newNodes){const old=oldNodes.get(id);if(!old)stats.storyAdded++;else if(JSON.stringify(old)!==JSON.stringify(node))stats.storyEdited++;}
  for(const id of oldNodes.keys())if(!newNodes.has(id))stats.storyRemoved++;
  return stats;
}
/** Pure, atomic dry run. Nothing is committed until applyProposal succeeds. */
export function previewCommands(project:Project,input:unknown):Proposal{
  const commands=validateCommands(input),next=structuredClone(project),changes:CommandChange[]=[];let budget=0,selectedId:string|null=null;
  if(commands.filter(c=>c.type==='generate_map').length>1)fail('一次提案最多重新生成一张地图。');
  if(commands.some((c,i)=>c.type==='generate_map'&&i!==0))fail('重新生成地图必须是提案的第一步。');
  for(const c of commands){
    changes.push(describeCommand(c));
    switch(c.type){
      case 'paint_terrain':case 'set_elevation':{
        const r=c.region;coordinate(next,r.x+r.width-1,r.y+r.height-1);budget+=r.width*r.height;if(budget>500000)fail('单次提案超过 500000 次地块操作预算。');
        for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++){const tile=next.map.tiles[y*next.map.width+x];if(c.type==='paint_terrain')tile.terrain=c.terrain;else tile.elevation=c.elevation;}break;
      }
      case 'place_objects':for(const o of c.objects){if(next.objects.some(v=>v.id===o.id))fail(`对象 ID ${o.id} 已存在。`);placeBounds(next,o);const a=ASSETS.find(a=>a.id===o.nativeId)!;next.objects.push({...o,category:a.category});selectedId??=o.id;}break;
      case 'move_objects':for(const move of c.moves){const o=objectFor(next,move.id);placeBounds(next,{...o,...move});o.x=move.x;o.y=move.y;selectedId??=o.id;}break;
      case 'remove_objects':for(const id of c.ids){objectFor(next,id);if(next.native?.importedObjectIds.includes(id))fail('不能从 LUI 删除原生导入对象；其已有触发器引用需要在原生编辑器中检查。');}next.objects=next.objects.filter(o=>!c.ids.includes(o.id));break;
      case 'generate_map':if(next.native)fail('原生导入工程不能重新生成地图；请先新建工程以保留原始数据。');Object.assign(next,generateMap(c),{seed:c.seed,story:[]});budget+=c.size*c.size;break;
      case 'add_story':for(const node of c.nodes){if(next.story.some(n=>n.id===node.id))fail(`剧情 ID ${node.id} 已存在。`);next.story.push({...node});}break;
      case 'edit_story':{const index=next.story.findIndex(n=>n.id===c.node.id);if(index<0)fail(`找不到剧情节点 ${c.node.id}。`);next.story[index]={...c.node};break;}
      case 'remove_story':for(const id of c.ids)if(!next.story.some(n=>n.id===id))fail(`找不到剧情节点 ${id}。`);next.story=next.story.filter(n=>!c.ids.includes(n.id));break;
    }
  }
  const diagnostics=validateProject(next),errors=diagnostics.filter(d=>d.severity==='error');
  if(errors.length)fail(`提案未应用：${errors.slice(0,4).map(d=>d.message).join(' ')}`);
  const stats=diffProjects(project,next,commands.some(c=>c.type==='generate_map'));
  if(!stats.mapReplaced&&!Object.values(stats).some(v=>typeof v==='number'&&v>0))fail('此提案不会改变工程。');
  return{baseRevision:projectRevision(project),commands,next,changes,stats,warnings:[...new Set(diagnostics.filter(d=>d.severity==='warning').map(d=>d.message))].slice(0,8),destructive:changes.some(c=>c.destructive),selectedId};
}
/** Re-run validation on apply, then let App.commit own the single undo transaction. */
export function applyProposal(project:Project,proposal:Proposal,confirmDestructive=false):Project{
  if(projectRevision(project)!==proposal.baseRevision)fail('工程已更改，此提案已过期。请基于当前工程重新请求。');
  const checked=previewCommands(project,proposal.commands);
  if(checked.destructive&&!confirmDestructive)fail('请明确确认删除或替换内容后再应用。');
  return checked.next;
}
