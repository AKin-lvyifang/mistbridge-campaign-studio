import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, CircleAlert, LoaderCircle, MessageSquareText, Settings2, Square, Undo2, X } from 'lucide-react';
import type { Project } from '../types';
import { Button } from '../ui';
import { makeProjectContext, projectRevision } from './context';
import { applyProposal, previewCommands } from './engine';
import { EMPTY_PROVIDER_STATUS, parseProviderStatus } from './types';
import type { ChatResponse, ConversationMessage, Proposal, ProviderStatus } from './types';
import { DiffPreview } from './DiffPreview';
import { CREDENTIAL_WARNING, looksLikeCredential } from './credentials';
import { requestLuiCancellation } from './cancel';
import './lui.css';

export interface ChatPanelProps {
  project: Project;
  onApply: (next: Project, label: string) => void;
  onSelect: (id: string | null) => void;
  onUndo?: () => void;
  canUndo?: boolean;
  selectedObjectId?: string | null;
  disabled?: boolean;
  onOpenSettings?: () => void;
  statusRefresh?: number;
}
type Turn = ConversationMessage & { id: number; local?: boolean };
async function responseBody(response: Response) {
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error('服务返回了无法读取的响应，请检查本地服务。'); }
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '大模型请求失败，未应用任何修改。');
  return data;
}
function checkReply(data: any): ChatResponse {
  if (!data || typeof data.message !== 'string' || data.message.length > 20000
    || !Array.isArray(data.commands) || data.commands.length > 24
    || !Array.isArray(data.toolResults) || data.toolResults.length > 24
    || typeof data.model !== 'string' || !data.usage
    || !Number.isFinite(data.usage.promptTokens) || !Number.isFinite(data.usage.completionTokens)) {
    throw new Error('服务返回的提案格式无效；没有应用任何修改。');
  }
  if (data.toolResults.some((r: any) => !r || typeof r.name !== 'string' || typeof r.ok !== 'boolean' || typeof r.message !== 'string')) {
    throw new Error('工具结果格式无效。');
  }
  return data;
}

export default function ChatPanel({project,onApply,onSelect,onUndo,canUndo=false,selectedObjectId=null,disabled=false,onOpenSettings,statusRefresh=0}: ChatPanelProps) {
  const [turns,setTurns] = useState<Turn[]>([]), [input,setInput] = useState('');
  const [busy,setBusy] = useState(false), [cancelling,setCancelling] = useState(false), [error,setError] = useState('');
  const [status,setStatus] = useState<ProviderStatus>(EMPTY_PROVIDER_STATUS);
  const [checking,setChecking] = useState(false), [statusError,setStatusError] = useState(''), [retryStatus,setRetryStatus] = useState(0);
  const [loadedRefresh,setLoadedRefresh] = useState<number|null>(null);
  const [proposal,setProposal] = useState<Proposal|null>(null), [proposalBase,setProposalBase] = useState<Project|null>(null);
  const [confirmed,setConfirmed] = useState(false), [lastReply,setLastReply] = useState<ChatResponse|null>(null);
  const [lastAppliedRevision,setLastAppliedRevision] = useState<string|null>(null);
  const controller = useRef<AbortController|null>(null), activeRequestId = useRef<string|null>(null);
  const generation = useRef(0), ids = useRef(0), latestProject = useRef(project), appliedContent = useRef<Project|null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  latestProject.current = project;
  const revision = useMemo(() => projectRevision(project), [project]);
  const stale = !!proposal && proposal.baseRevision !== revision;
  const serviceName = status.providerName.trim() || '大模型';
  // A changed settings prop disables sending immediately, before its effect runs.
  const canSend = !disabled && !checking && !statusError && loadedRefresh === statusRefresh && status.configured;
  const addLocal = (content: string) => setTurns(old => [...old,{id:++ids.current,role:'assistant',content,local:true}]);

  useEffect(() => {
    // A configuration write can succeed even when its response times out. Start fresh
    // before refreshing status so an uncertain write can never reuse old-provider history.
    generation.current++;
    const requestId = activeRequestId.current;
    activeRequestId.current = null;
    controller.current?.abort(); controller.current = null;
    if (requestId) void requestLuiCancellation(requestId);
    setBusy(false); setCancelling(false); setTurns([]); setInput('');
    setProposal(null); setProposalBase(null); setConfirmed(false); setLastReply(null);
    setError(''); setStatusError(''); setLastAppliedRevision(null); appliedContent.current = null;
    setStatus(EMPTY_PROVIDER_STATUS); setLoadedRefresh(null);
    if (disabled) { setChecking(false); return; }
    let active = true;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
    setChecking(true);
    void fetch('/api/lui/status',{signal:abort.signal,cache:'no-store'})
      .then(responseBody).then(parseProviderStatus).then(data => {
        if (active && !abort.signal.aborted) { setStatus(data); setLoadedRefresh(statusRefresh); }
      }).catch(e => {
        if (!active) return;
        setStatusError(abort.signal.aborted ? '无法连接本地服务。' : (e as Error).message);
        setStatus(EMPTY_PROVIDER_STATUS);
      }).finally(() => { clearTimeout(timer); if (active) setChecking(false); });
    return () => { active = false; abort.abort(); clearTimeout(timer); };
  }, [disabled,statusRefresh,retryStatus]);
  useEffect(() => () => {
    generation.current++;
    const requestId = activeRequestId.current;
    activeRequestId.current = null;
    controller.current?.abort(); controller.current = null;
    if (requestId) void requestLuiCancellation(requestId);
  }, []);
  useEffect(() => {
    generation.current++;
    const requestId = activeRequestId.current;
    activeRequestId.current = null;
    controller.current?.abort(); controller.current = null;
    if (requestId) void requestLuiCancellation(requestId);
    setBusy(false); setCancelling(false); setTurns([]); setInput('');
    setProposal(null); setProposalBase(null); setConfirmed(false); setLastReply(null);
    setError(''); setLastAppliedRevision(null); appliedContent.current = null;
  }, [project.id]);
  useEffect(() => { scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'}); }, [turns,busy]);
  useEffect(() => {
    if (appliedContent.current) {
      // App.commit supplies its timestamp. Record the committed revision only once.
      const expected = appliedContent.current;
      if (project.map === expected.map && project.objects === expected.objects && project.story === expected.story) {
        setLastAppliedRevision(revision); appliedContent.current = null;
      }
    }
  }, [project,revision]);

  const cancel = () => {
    const seq = ++generation.current, requestId = activeRequestId.current;
    activeRequestId.current = null;
    controller.current?.abort(); controller.current = null;
    setBusy(false); setError('');
    addLocal('已请求停止本次生成；迟到的回复将被丢弃，没有应用修改。');
    if (requestId) {
      setCancelling(true);
      void requestLuiCancellation(requestId).then(ok => {
        if (!ok && seq === generation.current) setError('已丢弃本次请求，但未能确认本地服务的取消回执；模型可能仍在处理。');
      }).finally(() => { if (seq === generation.current) setCancelling(false); });
    }
  };
  const submit = async () => {
    const content = input.trim();
    if (looksLikeCredential(content)) { setInput(''); setError(CREDENTIAL_WARNING); return; }
    if (!content || busy || cancelling || controller.current || !canSend) return;
    if (turns.some(t => looksLikeCredential(t.content))) { setTurns([]); setError(CREDENTIAL_WARNING); return; }
    if (proposal) { setError('请先应用或丢弃当前提案，再发送下一条指令。'); return; }
    const seq = ++generation.current, abort = new AbortController(), requestId = crypto.randomUUID();
    controller.current = abort; activeRequestId.current = requestId;
    setBusy(true); setError(''); setInput(''); setLastReply(null);
    const user: Turn = {id:++ids.current,role:'user',content};
    const history = [...turns,user]; setTurns(history);
    const snapshot = latestProject.current;
    // Explicit bounded content only. The backend supplies the configured model and
    // rejects a changed session revision before transmitting any of this history.
    let remaining = 40000;
    const messages: ConversationMessage[] = history.slice(-20).reverse().map(({role,content}) => {
      const bounded = content.slice(0,Math.min(12000,remaining));
      remaining -= bounded.length; return {role,content:bounded};
    }).filter(m => m.content.length > 0).reverse();
    const timer = setTimeout(() => { abort.abort(); void requestLuiCancellation(requestId); }, 185000);
    try {
      const response = await fetch('/api/lui/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({requestId,messages,context:makeProjectContext(snapshot,selectedObjectId),sessionRevision:status.sessionRevision}),
        signal:abort.signal,
      });
      const result = checkReply(await responseBody(response));
      if (seq !== generation.current || abort.signal.aborted) return;
      if (looksLikeCredential(JSON.stringify(result))) throw new Error('模型响应包含疑似凭据，已拦截；没有应用任何修改。');
      setLastReply(result); setTurns(old => [...old,{id:++ids.current,role:'assistant',content:result.message}]);
      if (result.commands.length) {
        const draft = previewCommands(snapshot,result.commands);
        setProposal(draft); setProposalBase(snapshot); setConfirmed(false);
        if (projectRevision(latestProject.current) !== draft.baseRevision) setError('生成期间工程已改变；此提案已过期。请丢弃并重新请求。');
      }
    } catch(e) {
      if (seq !== generation.current) return;
      const message = abort.signal.aborted ? '请求已停止或超时，没有应用任何修改。' : (e as Error).message;
      setError(message); addLocal(`本次请求未应用：${message}`);
    } finally {
      clearTimeout(timer);
      if (seq === generation.current) { controller.current = null; activeRequestId.current = null; setBusy(false); }
    }
  };
  const discard = () => {
    setProposal(null); setProposalBase(null); setConfirmed(false); setError('');
    addLocal('用户已丢弃上一份提案，工程未改变。');
  };
  const apply = () => {
    if (!proposal || stale || !canSend) return;
    try {
      const next = applyProposal(latestProject.current,proposal,confirmed);
      appliedContent.current = next; setLastAppliedRevision(null);
      onApply(next,`${serviceName} · ${proposal.changes.length} 项编辑`); onSelect(proposal.selectedId);
      setProposal(null); setProposalBase(null); setConfirmed(false); setError('');
      addLocal(`用户已确认并应用 ${proposal.changes.length} 项编辑：${proposal.changes.map(c=>c.label).join('；')}。可通过编辑器撤销。`);
    } catch(e) { setError((e as Error).message); }
  };
  const canUndoProposal = !!onUndo && canUndo && lastAppliedRevision === revision;
  const resetConversation = () => {
    if (busy || cancelling) return;
    setTurns([]); setLastReply(null); setError(''); setProposal(null); setProposalBase(null); setConfirmed(false);
  };

  return <section className="lui-panel" aria-label="大模型助手">
    <header className="lui-header">
      <div><MessageSquareText size={17}/><strong>大模型助手</strong><span className={`lui-status ${canSend?'ready':''}`}>{disabled?'网页预览':checking?'检查服务':canSend?'已配置':'未配置'}</span></div>
      <div>{onOpenSettings && !disabled && <Button tip="大模型会话设置" icon={<Settings2 size={14}/>} onClick={onOpenSettings}/>}<Button disabled={busy||cancelling||!turns.length} onClick={resetConversation}>新对话</Button></div>
    </header>
    {disabled ? <div className="lui-empty"><MessageSquareText size={25}/><strong>请在本地完整版使用大模型助手</strong><p>此网页预览不会连接模型，也不接受 API 密钥。离线地图与剧情编辑仍可使用。</p></div> : <>
      <div className="lui-privacy">
        {canSend ? <><strong>发送至 {serviceName}</strong><dl className="lui-destination"><dt>Base URL</dt><dd>{status.baseUrl}</dd><dt>请求端点</dt><dd>{status.endpoint}</dd><dt>模型</dt><dd>{status.model}</dd></dl></> : <strong>配置服务后，将在此显示发送地址和模型。</strong>}
        <p>每次发送包含近期至多 20 条对话（共 40,000 字符内）、地图摘要与至多 144 个采样格、150 个对象、40 个剧情节点。名称和对白可能包含在摘要中。原生文件副本、自定义 AI 脚本和 API 密钥不会进入对话。所有编辑先预览，再由你应用。</p>
      </div>
      {statusError && <div className="lui-error" role="alert"><CircleAlert size={14}/><span>{statusError}</span><Button onClick={()=>setRetryStatus(v=>v+1)}>重试</Button></div>}
      {!checking && !status.configured && !statusError && <div className="lui-configure"><strong>配置大模型服务后，用一句话编辑地图</strong><p>支持兼容 OpenAI Chat Completions 的服务。密钥仅保留在本地服务当前会话，退出后清除。</p><Button onClick={onOpenSettings} disabled={!onOpenSettings}>打开大模型设置</Button></div>}
      <div ref={scroll} className="lui-messages" role="log" aria-live="polite" aria-relevant="additions">
        {!turns.length && canSend && <div className="lui-suggestions"><p>试试这些指令：</p>{['把 (12, 12) 起的 8 × 8 格设为高度 5','在 (30, 30) 放置玩家 1 的斥候','新增一个 10 秒后显示的对白：“援军到了。”'].map(s=><button key={s} onClick={()=>setInput(s)}>{s}</button>)}</div>}
        {turns.map(t=><div className={`lui-message ${t.role} ${t.local?'local':''}`} key={t.id}><small>{t.local?'编辑器':t.role==='user'?'你':serviceName}</small><p>{t.content}</p></div>)}
        {busy && <div className="lui-thinking"><LoaderCircle size={14} className="spin"/> 正在规划并检查工具调用…</div>}
      </div>
      {error && <div className="lui-error" role="alert"><CircleAlert size={14}/><span>{error}</span></div>}
      {proposal && proposalBase && <div className={`lui-proposal ${stale?'stale':''}`}>
        <div className="lui-proposal-title"><strong>{stale?'提案已过期':'待确认编辑提案'}</strong><span>{proposal.changes.length} 项编辑 · 尚未应用</span></div>
        <DiffPreview before={proposalBase} proposal={proposal}/>
        <div className="lui-diff-stats"><span>地形 {proposal.stats.terrainTiles} 格</span><span>高度 {proposal.stats.elevationTiles} 格</span><span>对象 +{proposal.stats.objectsAdded} / 移动 {proposal.stats.objectsMoved} / −{proposal.stats.objectsRemoved}</span><span>剧情 +{proposal.stats.storyAdded} / 改 {proposal.stats.storyEdited} / −{proposal.stats.storyRemoved}</span></div>
        <ol className="lui-change-list">{proposal.changes.map((c,i)=><li key={i}><strong>{c.label}</strong><p>{c.detail}</p></li>)}</ol>
        {!!proposal.warnings.length && <details><summary>{proposal.warnings.length} 条检查提示</summary><ul>{proposal.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}
        <details><summary>查看精确命令参数</summary><pre>{JSON.stringify(proposal.commands,null,2)}</pre></details>
        {proposal.destructive && <label className="lui-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={stale||!canSend}/>我已检查上述删除或替换内容，确认应用</label>}
        <div className="lui-actions"><Button onClick={discard} icon={<X size={14}/>}>丢弃</Button><Button variant="primary" disabled={!canSend||stale||(proposal.destructive&&!confirmed)} onClick={apply} icon={<Check size={14}/>}>应用到工程</Button></div>
      </div>}
      {lastReply && <details className="lui-tool-results"><summary>{lastReply.model} · {lastReply.rounds} 轮 · {lastReply.toolResults.length} 次工具调用 · {lastReply.usage.promptTokens+lastReply.usage.completionTokens} tokens</summary>{lastReply.toolResults.map((r,i)=><p key={i}>{r.ok?'已暂存':'已拒绝'} · {r.name}<br/>{r.message}</p>)}</details>}
      {canUndoProposal && <Button className="lui-undo" icon={<Undo2 size={14}/>} onClick={()=>{onUndo?.();setLastAppliedRevision(null);addLocal('用户撤销了上一份已应用提案。当前工程以最新上下文为准。');}}>撤销刚才的编辑</Button>}
      <form className="lui-compose" onSubmit={e=>{e.preventDefault();void submit();}}>
        <textarea aria-label="向大模型描述编辑要求" placeholder="描述地形、单位或剧情的修改…" value={input} onChange={e=>{if(looksLikeCredential(e.target.value)){e.target.value='';setInput('');setError(CREDENTIAL_WARNING);}else setInput(e.target.value);}} maxLength={4000} rows={3} disabled={!canSend||busy||cancelling} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>
        <div><Button type="button" className="lui-model" onClick={onOpenSettings} disabled={!onOpenSettings} title={canSend?`${serviceName} · ${status.model}`:'配置服务地址与模型'}>{canSend?status.model:'未配置模型'}</Button><small>⌘ / Ctrl + Enter</small>{busy?<Button type="button" onClick={cancel} icon={<Square size={13}/>}>停止</Button>:<Button type="submit" variant="primary" disabled={!canSend||cancelling||!input.trim()||!!proposal} icon={<ArrowUp size={15}/>}>{cancelling?'正在停止':'发送'}</Button>}</div>
      </form>
    </>}
  </section>;
}
