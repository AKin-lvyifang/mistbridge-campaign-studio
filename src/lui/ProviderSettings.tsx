import { useEffect, useRef, useState } from 'react';
import { KeyRound, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Field, Modal } from '../ui';
import { looksLikeCredential } from './credentials';
import { parseProviderStatus } from './types';

interface Props { open: boolean; onOpenChange(open: boolean): void; onChanged(): void; staticPreview?: boolean }
type Preset='custom'|'deepseek'|'openai';
const PRESETS={
  custom:{providerName:'',baseUrl:'',model:''},
  deepseek:{providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash'},
  openai:{providerName:'OpenAI',baseUrl:'https://api.openai.com/v1',model:'gpt-4.1-mini'},
};

/** API keys are transient uncontrolled form input, never Project/chat/React state. */
export default function ProviderSettings({open,onOpenChange,onChanged,staticPreview=false}:Props){
 const input=useRef<HTMLInputElement>(null);
 const [preset,setPreset]=useState<Preset>('custom'),[providerName,setName]=useState(''),[baseUrl,setBase]=useState(''),[model,setModel]=useState('');
 const [configured,setConfigured]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState(''),[approved,setApproved]=useState(false);
 const clearKey=()=>{if(input.current)input.current.value='';};
 useEffect(()=>{
  if(!open){clearKey();return;}setMessage('');setApproved(false);if(staticPreview){setLoading(false);return;}setLoading(true);
  let active=true;const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),4000);
  fetch('/api/lui/status',{cache:'no-store',signal:abort.signal}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
   const s=parseProviderStatus(data);if(!active)return;setConfigured(s.configured===true);
   if(s.configured){setPreset(s.preset==='deepseek'||s.preset==='openai'?s.preset:'custom');setName(s.providerName||'');setBase(s.baseUrl||'');setModel(s.model||'');}
  }).catch(()=>{if(active)setMessage('无法读取本地模型服务状态。请使用完整桌面版。');}).finally(()=>{clearTimeout(timer);if(active)setLoading(false);});
  return()=>{active=false;abort.abort();clearTimeout(timer);clearKey();};
 },[open,staticPreview]);
 function edit(value:string,setter:(value:string)=>void){clearKey();setApproved(false);if(looksLikeCredential(value)){setter('');setMessage('疑似密钥只能填写在下方遮罩输入框中。');return;}setter(value);setMessage('');}
 function choose(value:Preset){clearKey();setApproved(false);setPreset(value);setName(PRESETS[value].providerName);setBase(PRESETS[value].baseUrl);setModel(PRESETS[value].model);setMessage('');}
 const endpoint=baseUrl.trim().replace(/\/+$/,'')+'/chat/completions';
 async function configure(){
  if(staticPreview||busy||loading)return;
  if(!approved){setMessage('请先确认下方服务地址与数据发送说明。');return;}
  if(!input.current?.value.trim()||!providerName.trim()||!model.trim()){setMessage('请填写服务名称、模型 ID 和该服务的新密钥。');return;}
  try{const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||/\/chat\/completions\/?$/.test(url.pathname))throw new Error();}
  catch{setMessage('Base URL 必须是 HTTPS 服务根路径，可含 /v1；不要填写密钥、查询参数或 /chat/completions。');clearKey();return;}
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/lui/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset,providerName:providerName.trim(),baseUrl:baseUrl.trim(),model:model.trim(),key:input.current.value.trim()}),signal:AbortSignal.timeout(8000)});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'配置无效，请检查服务地址、模型与密钥格式。');}
   setConfigured(true);clearKey();onChanged();setApproved(false);
   setMessage('已用于本次会话。之前的请求与模型对话已清除。尚未调用模型；首次发送时才验证连通性与工具调用。');
  }catch(error){setMessage(error instanceof Error?error.message:'配置失败。');onChanged();}
  finally{clearKey();setBusy(false);}
 }
 async function clearSession(){
  if(staticPreview||busy||loading)return;setBusy(true);clearKey();setApproved(false);
  try{const r=await fetch('/api/lui/session/clear',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error();setConfigured(false);setMessage('本次会话密钥、请求与模型对话已清除。');onChanged();}
  catch{setMessage('清除结果待确认。请重开此面板检查，或退出应用结束本地服务。');}finally{setBusy(false);}
 }
 return <Modal open={open} onOpenChange={value=>{if(!value)clearKey();onOpenChange(value);}} title="大模型服务设置" description="兼容 Chat Completions 工具调用接口。不同协议需要独立适配器，不能只更换密钥。">
  {staticPreview?<div className="callout">此网页预览没有本地模型服务，不接收 API Key。请在完整桌面版中配置服务。</div>:<>
   <div className="provider-privacy"><ShieldCheck size={18}/><div><strong>仅保存于本次本地服务会话</strong><p>密钥不会写入工程、浏览器存储、日志或导出文件。改变服务时必须重新输入密钥；退出服务后清除。</p></div></div>
   <form onSubmit={event=>{event.preventDefault();void configure();}}>
    <div className="field-grid"><Field label="服务预设"><select value={preset} disabled={busy||loading} onChange={e=>choose(e.target.value as Preset)}><option value="custom">自定义兼容 API</option><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select></Field><Field label="服务名称"><input value={providerName} onChange={e=>edit(e.target.value,setName)} maxLength={80} disabled={busy||loading} placeholder="例如：我的模型服务"/></Field></div>
    <Field label="Base URL" hint="填写公网 HTTPS 根路径（可含 /v1）。不支持内网、localhost 或自动重定向。"><input type="url" value={baseUrl} onChange={e=>{setPreset('custom');edit(e.target.value,setBase);}} disabled={busy||loading} maxLength={1000} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false}/></Field>
    <Field label="模型 ID" hint="使用服务商文档中的准确 ID；该模型必须支持工具调用。"><input value={model} onChange={e=>edit(e.target.value,setModel)} disabled={busy||loading} maxLength={200} placeholder="填写该服务支持的模型 ID" autoComplete="off" spellCheck={false}/></Field>
    <Field label="该服务的 API Key" hint="请自行输入新密钥，不要放入聊天、服务地址或模型字段。"><input ref={input} type="password" name="model-session-secret" autoComplete="new-password" aria-label="该服务的 API Key" spellCheck={false} autoCapitalize="none" maxLength={512} placeholder="遮罩输入 · 提交或改动服务后清空" disabled={busy||loading}/></Field>
    <div className="provider-destination"><span>实际请求目标</span><strong>{baseUrl?endpoint:'尚未指定服务地址'}</strong><small>模型：{model||'尚未指定'}</small></div>
    <label className="provider-consent"><input type="checkbox" checked={approved} disabled={busy||loading||!baseUrl||!model} onChange={e=>setApproved(e.target.checked)}/><span>我确认此目标服务，允许发送对话与精简工程摘要。API Key 只作为该目标的 HTTPS 认证头发送；调用费用由该服务账户承担。</span></label>
    <div className="provider-session-status">{loading?'正在读取本地会话配置':configured?'已有会话配置 · 提交会替换配置并清除旧对话':'尚未配置模型服务'} · 未进行真实账户验证</div>
    {message&&<div className="callout" role="status">{message}</div>}
    <div className="dialog-actions"><Button type="button" onClick={()=>{clearKey();onOpenChange(false);}}>关闭</Button><Button type="button" variant="danger" icon={<Trash2 size={14}/>} disabled={!configured||busy||loading} onClick={()=>void clearSession()}>清除会话</Button><Button type="submit" variant="primary" icon={busy?<LoaderCircle size={14} className="spin"/>:<KeyRound size={14}/>} disabled={busy||loading||!approved}>用于本次会话</Button></div>
   </form>
  </>}
 </Modal>;
}
