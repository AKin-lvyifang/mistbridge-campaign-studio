import { describe, expect, it } from 'vitest';
import { createProject } from '../src/domain';
import { makeProjectContext, projectRevision } from '../src/lui/context';
import { applyProposal, diffProjects, previewCommands, validateCommands } from '../src/lui/engine';
import type { Project, StoryNode } from '../src/types';

const fresh=()=>createProject({size:36});
const elevation={type:'set_elevation',region:{x:10,y:10,width:3,height:4},elevation:9};
const node:StoryNode={id:'lui-story-1',name:'援军抵达',enabled:true,delay:10,kind:'dialogue',text:'援军到了。',player:1,x:10,y:10,duration:8};
const object={id:'lui-scout-1',nativeId:448,player:1,x:20,y:20,rotation:0,label:'新斥候'};

describe('LUI typed atomic edits',()=>{
  it('writes actual native elevation and previews exactly changed tiles without changing source',()=>{
    const p=fresh(),before=JSON.stringify(p);const proposal=previewCommands(p,[elevation]);
    expect(JSON.stringify(p)).toBe(before);expect(proposal.stats.elevationTiles).toBe(12);expect(proposal.stats.terrainTiles).toBe(0);
    const next=applyProposal(p,proposal);expect(next.map.tiles[10*36+10].elevation).toBe(9);expect(p.map.tiles[10*36+10].elevation).not.toBe(9);
  });
  it('paints verified native terrain without modifying elevation',()=>{
    const p=fresh(),r={x:1,y:1,width:2,height:2};const result=previewCommands(p,[{type:'paint_terrain',region:r,terrain:22}]);
    expect(result.next.map.tiles[37].terrain).toBe(22);expect(result.next.map.tiles[37].elevation).toBe(p.map.tiles[37].elevation);
  });
  it('places native catalog objects with derived category and selects them',()=>{
    const result=previewCommands(fresh(),[{type:'place_objects',objects:[object]}]);
    expect(result.next.objects.at(-1)).toEqual({...object,category:'unit'});expect(result.selectedId).toBe(object.id);expect(result.stats.objectsAdded).toBe(1);
  });
  it('supports placement and reference by a later move command in one proposal',()=>{
    const result=previewCommands(fresh(),[{type:'place_objects',objects:[object]},{type:'move_objects',moves:[{id:object.id,x:25,y:21}]}]);
    expect(result.next.objects.find(o=>o.id===object.id)?.x).toBe(25);
  });
  it('validates the complete transaction and never leaves partial writes',()=>{
    const p=fresh(),before=JSON.stringify(p);expect(()=>previewCommands(p,[elevation,{type:'move_objects',moves:[{id:'missing',x:10,y:10}]}])).toThrow('找不到对象');expect(JSON.stringify(p)).toBe(before);
  });
  it('requires an explicit destructive confirmation and has no hidden mutation',()=>{
    const p=fresh(),id=p.objects.find(o=>o.category==='decoration')!.id;
    const draft=previewCommands(p,[{type:'remove_objects',ids:[id]}]);expect(draft.destructive).toBe(true);expect(()=>applyProposal(p,draft)).toThrow('明确确认');expect(applyProposal(p,draft,true).objects.some(o=>o.id===id)).toBe(false);
  });
  it('checks the content revision even if updatedAt is unchanged',()=>{
    const p=fresh(),draft=previewCommands(p,[elevation]),changed=structuredClone(p);changed.map.tiles[0].elevation=16;
    expect(()=>applyProposal(changed,draft)).toThrow('过期');expect(projectRevision(changed)).not.toBe(projectRevision(p));
  });
  it('revalidates commands instead of trusting a modified preview snapshot',()=>{
    const p=fresh(),draft=previewCommands(p,[elevation]);draft.next.map.tiles[0].terrain=999;const next=applyProposal(p,draft);expect(next.map.tiles[0]).toEqual(p.map.tiles[0]);
  });
  it('rejects edits to locked objects and imported object deletions',()=>{
    const p=fresh();p.objects[0].locked=true;
    expect(()=>previewCommands(p,[{type:'move_objects',moves:[{id:p.objects[0].id,x:10,y:10}]}])).toThrow('锁定');
    p.objects[0].locked=false;p.native={version:'1.59',filename:'source.aoe2scenario',sha256:'a'.repeat(64),originalBase64:'AAAA',importedObjectIds:p.objects.map(o=>o.id),importedTriggerCount:0};
    expect(()=>previewCommands(p,[{type:'remove_objects',ids:[p.objects[0].id]}])).toThrow('原生导入对象');
    expect(()=>previewCommands(p,[{type:'generate_map',seed:1,size:36,theme:'river',forest:30}])).toThrow('原生导入工程');
  });
  it('generates deterministic seeded maps with explicit story clearing',()=>{
    const command={type:'generate_map',seed:7654,size:40,theme:'highland',forest:45};const a=previewCommands(fresh(),[command]),b=previewCommands(fresh(),[command]);
    expect(a.next.map).toEqual(b.next.map);expect(a.next.objects).toEqual(b.next.objects);expect(a.next.story).toEqual([]);expect(a.stats.mapReplaced).toBe(true);expect(a.destructive).toBe(true);
  });
  it('adds, edits and removes real supported story nodes',()=>{
    const p=fresh(),add=previewCommands(p,[{type:'add_story',nodes:[node]}]);expect(add.stats.storyAdded).toBe(1);
    const edit=previewCommands(add.next,[{type:'edit_story',node:{...node,text:'守住桥头！'}}]);expect(edit.stats.storyEdited).toBe(1);
    const remove=previewCommands(edit.next,[{type:'remove_story',ids:[node.id]}]);expect(remove.stats.storyRemoved).toBe(1);
  });
  it('rejects nonexistent movement references and unsupported conditional story kinds',()=>{
    expect(()=>previewCommands(fresh(),[{type:'add_story',nodes:[{...node,kind:'move',objectId:'missing'}]}])).toThrow('引用的对象不存在');
    expect(()=>validateCommands([{type:'add_story',nodes:[{...node,kind:'on_death'}]}])).toThrow('只支持');
  });
  it.each([
    [{type:'execute_script',code:'alert(1)'}],
    [{...elevation,elevation:NaN}], [{...elevation,elevation:17}], [{...elevation,elevation:'4'}],
    [{...elevation,region:{x:-1,y:0,width:1,height:1}}],
    [{...elevation,arbitrary:{secret:'not-allowed'}}],
    [{type:'place_objects',objects:[{...object,nativeId:65534}]}],
    [{type:'place_objects',objects:[{...object,nativeReferenceId:1}]}],
    [{type:'remove_objects',ids:['same','same']}], [],
  ])('rejects unsafe or malformed commands %#',commands=>expect(()=>validateCommands(commands)).toThrow());
  it('rejects partially out-of-map rectangles, oversized budgets and invalid footprints',()=>{
    const p=fresh();expect(()=>previewCommands(p,[{...elevation,region:{x:35,y:35,width:2,height:2}}])).toThrow('超出');
    expect(()=>previewCommands(p,[{type:'place_objects',objects:[{...object,nativeId:109,x:1}]}])).toThrow('占地');
    expect(()=>validateCommands(Array.from({length:25},()=>elevation))).toThrow('1–24');
  });
  it('counts coordinate-aware diffs across resized maps',()=>{
    const p=fresh(),b=structuredClone(p);b.map.tiles=b.map.tiles.map(t=>({...t,elevation:16}));expect(diffProjects(p,b).elevationTiles).toBe(1296);
  });
});

describe('LUI data minimization',()=>{
  it('never includes native original bytes, AI scripts or arbitrary project fields',()=>{
    const p=fresh() as Project&{apiKey:string};p.apiKey='forbidden-marker';p.customAi='private-ai-marker';p.native={version:'1.59',filename:'hidden-file-name',sha256:'a'.repeat(64),originalBase64:'private-native-marker',importedObjectIds:[],importedTriggerCount:0};
    const content=JSON.stringify(makeProjectContext(p));for(const value of ['private-native-marker','private-ai-marker','forbidden-marker','originalBase64','apiKey','hidden-file-name'])expect(content).not.toContain(value);
  });
  it('bounds context and includes the selected object even beyond the sample cap',()=>{
    const p=createProject({size:240,forest:90});const chosen=p.objects.at(-1)!;const context=makeProjectContext(p,chosen.id);
    expect(context.objects.items.length).toBeLessThanOrEqual(150);expect(context.map.samples.length).toBeLessThanOrEqual(144);expect(context.story.items.length).toBeLessThanOrEqual(40);expect(context.objects.items[0].id).toBe(chosen.id);
  });
});

import { looksLikeCredential } from '../src/lui/credentials';
describe('LUI accidental credential protection',()=>{
  it.each(['sk-'+'X'.repeat(32),'My key is sk-'+'0'.repeat(32),'Authorization: Bearer '+'f'.repeat(24),'api_key="'+'z'.repeat(24)+'"'])('detects an artificial credential pattern %#',value=>expect(looksLikeCredential(value)).toBe(true));
  it.each(['把高度设为 5','Use the API key settings','Make scout lui-scout-1234567890','seed 4294967295'])('permits ordinary editing text %#',value=>expect(looksLikeCredential(value)).toBe(false));
});

import { requestLuiCancellation } from '../src/lui/cancel';
describe('explicit request-scoped LUI cancellation',()=>{
  it('posts only the original request ID with a bounded abort signal',async()=>{
    let observed:{url:unknown;options?:RequestInit}|undefined;
    const mock:typeof fetch=async(url,options)=>{observed={url,options};return new Response('{}',{status:200});};
    expect(await requestLuiCancellation('old-request-id',mock)).toBe(true);
    expect(observed?.url).toBe('/api/lui/cancel');expect(observed?.options?.method).toBe('POST');expect(JSON.parse(observed?.options?.body as string)).toEqual({requestId:'old-request-id'});expect(observed?.options?.signal).toBeInstanceOf(AbortSignal);
  });
  it('reports transport failure without throwing or repeating the request',async()=>{
    let count=0;const mock:typeof fetch=async()=>{count++;throw new Error('test offline');};expect(await requestLuiCancellation('id',mock)).toBe(false);expect(count).toBe(1);
  });
  it('reports HTTP rejection and skips an absent request ID',async()=>{
    let count=0;const mock:typeof fetch=async()=>{count++;return new Response('{}',{status:409});};expect(await requestLuiCancellation('id',mock)).toBe(false);expect(await requestLuiCancellation('',mock)).toBe(false);expect(count).toBe(1);
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatPanel from '../src/lui/ChatPanel';
import { EMPTY_PROVIDER_STATUS, parseProviderStatus } from '../src/lui/types';
const providerStatus={configured:true,providerName:'Example Models',baseUrl:'https://models.example/v1',endpoint:'https://models.example/v1/chat/completions',model:'vendor/custom-model:2',preset:'custom',storage:'session-memory',sessionRevision:4};
describe('generic model assistant status and labels',()=>{
  it('accepts an editable compatible model and exposes no unallowlisted status fields',()=>{
    expect(parseProviderStatus({...providerStatus,key:'synthetic-secret',headers:{Authorization:'synthetic'}})).toEqual(providerStatus);
  });
  it.each(['deepseek','openai','custom'])('accepts preset %s without a hardcoded model list',preset=>{
    expect(parseProviderStatus({...providerStatus,preset}).model).toBe('vendor/custom-model:2');
  });
  it('has no fabricated default model or destination before local status is loaded',()=>{
    expect(EMPTY_PROVIDER_STATUS.configured).toBe(false);
    expect(EMPTY_PROVIDER_STATUS.model).toBe('');expect(EMPTY_PROVIDER_STATUS.baseUrl).toBe('');
    expect(parseProviderStatus(EMPTY_PROVIDER_STATUS)).toEqual(EMPTY_PROVIDER_STATUS);
  });
  it.each([
    null, {configured:true,provider:'deepseek',model:'old-model',models:[]},
    {...providerStatus,sessionRevision:-1}, {...providerStatus,sessionRevision:'4'},
    {...providerStatus,configured:'true'}, {...providerStatus,model:''},
    {...providerStatus,endpoint:'https://other.example/chat/completions'},
    {...providerStatus,baseUrl:'http://models.example/v1'},
    {...providerStatus,baseUrl:'https://user:pass@models.example/v1',endpoint:'https://user:pass@models.example/v1/chat/completions'},
    {...providerStatus,baseUrl:'https://models.example/v1?key=synthetic',endpoint:'https://models.example/v1?key=synthetic/chat/completions'},
    {...providerStatus,storage:'persistent'},
  ])('rejects malformed or unsafe public status %#',value=>expect(()=>parseProviderStatus(value)).toThrow());
  it('keeps static preview generic, with no model controls or credential field',()=>{
    const html=renderToStaticMarkup(React.createElement(ChatPanel,{project:fresh(),onApply:()=>{},onSelect:()=>{},disabled:true,onOpenSettings:()=>{}}));
    expect(html).toContain('大模型助手');expect(html).toContain('请在本地完整版使用大模型助手');expect(html).toContain('不会连接模型');
    expect(html).not.toContain('DeepSeek');expect(html).not.toContain('<textarea');expect(html).not.toContain('type="password"');expect(html).not.toContain('大模型会话设置');
  });
  it('does not show a hardcoded model dropdown before configuration',()=>{
    const html=renderToStaticMarkup(React.createElement(ChatPanel,{project:fresh(),onApply:()=>{},onSelect:()=>{}}));
    expect(html).toContain('未配置模型');expect(html).toContain('配置服务后');expect(html).not.toContain('<select');expect(html).not.toContain('deepseek-flash');
  });
});
