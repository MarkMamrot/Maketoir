"use client";

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

type ViewTab = 'inbox' | 'settings' | 'learnings';
type ThreadSummary = {
  id: number; customer_email: string | null; subject: string; snippet: string; unread_count: number;
  category: string | null; enquiry_subtype: string | null; classification_confidence: number | null;
  urgency: string; workflow_status: string; is_starred: number; starred_at: string | null; last_message_at: string; draft_status: string | null;
};
type Draft = {
  id: number; target_message_id: number; compose_type: string; recipient_email: string | null; version: number; status: string; subject: string; current_body: string; confidence: number | null;
  needs_information: number; escalation_reason: string | null; tool_provenance_json: string; last_error: string | null;
};
type ThreadDetail = {
  thread: ThreadSummary;
  messages: Array<{ id: number; direction: string; from_address: string; subject: string; body_plain: string; message_at: string; attachment_metadata_json: string }>;
  drafts: Draft[];
  events: Array<{ event_type: string; actor_type: string; created_at: string }>;
  otherConversations: Array<{ id: number; subject: string; category: string | null; workflow_status: string; last_message_at: string; unread_count: number }>;
};
type ManualComposer = {
  composeType: 'manual_reply' | 'forward'; targetMessageId: number; recipientEmail: string;
  subject: string; body: string; operationKey: string;
};
type Settings = {
  enabled: boolean; timezone: string; runTimes: string[]; mode: 'draft' | 'send'; lookbackDays: number;
  retentionMode: 'keep_all' | 'limited'; retentionDays: number; lightModelId: string; capableModelId: string; enabledTools: string[];
  guidelines: string; helperEmails: string[]; learningEnabled: boolean; lastRunAt: string | null; lastError: string | null;
};
type KnowledgeDocument = { documentKey: 'style' | 'knowledge'; filename: string; markdown: string; version: number; updatedAt: string };
type LearningCandidate = {
  id: number; rule_key: string; rule_type: 'style' | 'fact' | 'policy'; title: string; proposed_markdown: string;
  status: string; evidence_count: number; confidence: number; auto_activated: number;
};

function toTime(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

const TOOL_LABELS: Record<string, string> = {
  find_customer_by_email: 'Customer details', get_customer_recent_orders: 'Recent customer orders',
  get_order_details: 'Order details and status', search_products: 'IMS product search',
  get_stock_by_branch: 'Live stock by branch', find_similar_products: 'Similar products',
  get_branch_details: 'Branch details', get_business_policies: 'Business policies',
};

function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
async function parseResponseJson(response: Response): Promise<any> {
  const raw = await response.text();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { error: raw.slice(0, 500) }; }
}
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
function shortUrlLabel(value: string): string {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return value;
  }
}
function renderEmailBodyWithHyperlinks(value: string): ReactNode {
  const lines = String(value || '').split(/\r?\n/);
  return lines.map((line, lineIndex) => {
    const quotedLink = line.match(/^\s*"([^"]+)"\s*<([^>\s]+)>\s*$/);
    if (quotedLink && isHttpUrl(quotedLink[2])) {
      return <span key={`line-${lineIndex}`}><a href={quotedLink[2]} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{quotedLink[1]}</a>{lineIndex < lines.length - 1 ? '\n' : ''}</span>;
    }
    const labeledLink = line.match(/^\s*([^<>]{1,140}?)\s*<([^>\s]+)>\s*$/);
    if (labeledLink && isHttpUrl(labeledLink[2])) {
      return <span key={`line-${lineIndex}`}><a href={labeledLink[2]} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{labeledLink[1].trim()}</a>{lineIndex < lines.length - 1 ? '\n' : ''}</span>;
    }
    const parts: ReactNode[] = [];
    const regex = /<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>"]+)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      const index = match.index;
      const url = (match[1] || match[2] || '').trim();
      if (index > cursor) parts.push(<span key={`text-${lineIndex}-${cursor}`}>{line.slice(cursor, index)}</span>);
      parts.push(<a key={`link-${lineIndex}-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{shortUrlLabel(url)}</a>);
      cursor = index + match[0].length;
    }
    if (cursor < line.length) parts.push(<span key={`tail-${lineIndex}-${cursor}`}>{line.slice(cursor)}</span>);
    if (!parts.length) parts.push(<span key={`plain-${lineIndex}`}>{line}</span>);
    if (lineIndex < lines.length - 1) parts.push('\n');
    return <span key={`line-${lineIndex}`}>{parts}</span>;
  });
}
function categoryStyle(value: string | null): string {
  if (value === 'customer_enquiry') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (value === 'junk') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (value === 'other') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-500 border-gray-200';
}

export function CustomerServiceView({ databaseId: _databaseId }: { databaseId: string }) {
  const [tab, setTab] = useState<ViewTab>('inbox');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPage, setLoadedPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [manualComposer, setManualComposer] = useState<ManualComposer | null>(null);
  const replyActionPending = useRef(false);
  const conversationScrollRef = useRef<HTMLElement | null>(null);
  const conversationHeaderRef = useRef<HTMLDivElement | null>(null);
  const latestMessageRef = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [candidates, setCandidates] = useState<LearningCandidate[]>([]);

  async function loadThreads(preferredId?: number | null, page = 1, append = false) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, category, unread: String(unreadOnly), page: String(page), pageSize: '50' });
      const response = await fetch(`/api/customer-service/inbox/threads?${params}`);
      const data = await parseResponseJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to load inbox');
      const pageRows: ThreadSummary[] = [...(data.rows || [])].sort((left, right) =>
        Number(right.is_starred || 0) - Number(left.is_starred || 0)
        || Number(right.category === 'customer_enquiry') - Number(left.category === 'customer_enquiry')
        || toTime(right.last_message_at) - toTime(left.last_message_at),
      );
      const rows = append
        ? [...threads, ...pageRows.filter(row => !threads.some(thread => thread.id === row.id))]
        : pageRows;
      setThreads(rows); setTotal(data.total || 0); setLoadedPage(page);
      setSelectedId(current => {
        if (preferredId !== undefined) {
          if (preferredId === null) return rows[0]?.id ?? null;
          return rows.some(thread => thread.id === preferredId) ? preferredId : (rows[0]?.id ?? null);
        }
        if (current && rows.some(thread => thread.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (cause: any) { setError(cause.message); } finally { setLoading(false); }
  }
  async function loadDetail(threadId: number) {
    try {
      const response = await fetch(`/api/customer-service/inbox/threads/${threadId}`); const data = await parseResponseJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to load conversation'); setDetail(data);
    } catch (cause: any) { setError(cause.message); }
  }
  async function loadSettings() {
    const response = await fetch('/api/customer-service/settings'); const data = await response.json();
    if (response.ok) { setSettings(data.settings); setDays(data.settings.lookbackDays); }
  }
  async function loadKnowledge() {
    const response = await fetch('/api/customer-service/knowledge'); const data = await response.json();
    if (response.ok) setDocuments(data.documents || []);
  }
  async function loadCandidates() {
    const response = await fetch('/api/customer-service/learnings'); const data = await response.json();
    if (response.ok) setCandidates(data.candidates || []);
  }

  useEffect(() => { loadThreads(); loadSettings(); loadKnowledge(); loadCandidates(); }, []);
  useEffect(() => { setManualComposer(null); if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId]);
  useEffect(() => { const timer = setTimeout(() => loadThreads(), 250); return () => clearTimeout(timer); }, [query, category, unreadOnly]);
  useEffect(() => {
    if (!detail) return;
    const frame = requestAnimationFrame(() => {
      const container = conversationScrollRef.current;
      const message = latestMessageRef.current;
      if (container && message) {
        const headerHeight = conversationHeaderRef.current?.offsetHeight ?? 0;
        container.scrollTop += message.getBoundingClientRect().top
          - container.getBoundingClientRect().top
          - headerHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [detail?.thread.id, detail?.messages.length, detail?.drafts[0]?.id]);
  useEffect(() => {
    if (tab === 'settings' && !models.length) fetch('/api/ai/gemini-models').then(r => r.json()).then(d => setModels(d.models || [])).catch(() => {});
  }, [tab, models.length]);

  async function runInbox() {
    setBusyAction('sync'); setError(''); setNotice('');
    try {
      const syncResponse = await fetch('/api/customer-service/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) });
      const sync = await syncResponse.json(); if (!syncResponse.ok) throw new Error(sync.error || 'Email sync failed');
      const processResponse = await fetch('/api/customer-service/process', { method: 'POST' });
      const processed = await processResponse.json(); if (!processResponse.ok) throw new Error(processed.error || 'AI processing failed');
      setNotice(`Loaded ${sync.threads} threads and ${sync.messages} messages. Classified ${processed.classified}; drafted ${processed.drafted}.`);
      await loadThreads();
    } catch (cause: any) { setError(cause.message); } finally { setBusyAction(''); }
  }
  async function patchThreadById(threadId: number, input: Record<string, string>) {
    const response = await fetch(`/api/customer-service/inbox/threads/${threadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = await parseResponseJson(response);
    if (!response.ok) throw new Error(data.error || 'Update failed');
    await Promise.all([loadDetail(threadId), loadThreads(threadId)]);
  }
  async function patchThread(input: Record<string, string>) {
    if (!selectedId) return;
    await patchThreadById(selectedId, input);
  }
  async function toggleThreadStar(threadId: number, isStarred: number) {
    setBusyAction(`star-${threadId}`);
    setError('');
    try {
      await patchThreadById(threadId, { starred: isStarred ? 'false' : 'true' });
      setNotice(isStarred ? 'Removed follow-up star.' : 'Starred for follow-up.');
    } catch (cause: any) {
      setError(cause.message || 'Unable to update star.');
    } finally {
      setBusyAction('');
    }
  }
  async function toggleStar() {
    if (!detail) return;
    await toggleThreadStar(detail.thread.id, detail.thread.is_starred);
  }
  async function mailboxAction(action: 'read' | 'unread' | 'archive') {
    if (!selectedId) return; setBusyAction(action);
    try {
      const response = await fetch(`/api/customer-service/inbox/threads/${selectedId}/mailbox-action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await parseResponseJson(response);
      if (!response.ok) {
        if (data?.reconnectRequired) {
          throw new Error('Gmail needs to be reconnected with mailbox permissions. Go to Setup > Connections, reconnect Gmail, then try again.');
        }
        throw new Error(data.error || 'Gmail update failed');
      }
      await loadThreads(action === 'archive' ? null : selectedId); if (action !== 'archive') await loadDetail(selectedId); else setDetail(null);
    } catch (cause: any) { setError(cause.message); } finally { setBusyAction(''); }
  }
  function updateDraftBody(body: string) {
    if (!activeDraft) return;
    setDetail(previous => previous ? { ...previous, drafts: previous.drafts.map(draft => draft.id === activeDraft.id ? { ...draft, current_body: body } : draft) } : previous);
  }
  async function saveDraft(): Promise<number | null> {
    const draft = activeDraft; if (!draft) return null;
    const response = await fetch(`/api/customer-service/inbox/drafts/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: draft.version, body: draft.current_body }) });
    const data = await parseResponseJson(response); if (!response.ok) throw new Error(data.error || 'Draft save failed');
    setDetail(previous => previous ? { ...previous, drafts: previous.drafts.map(item => item.id === draft.id ? { ...item, version: data.version } : item) } : previous);
    return draft.id;
  }
  async function replyAction(action: 'gmail-draft' | 'send') {
    if (replyActionPending.current) return;
    replyActionPending.current = true;
    setBusyAction(action); setError('');
    try {
      const draftId = await saveDraft(); if (!draftId) throw new Error('No draft is available');
      const response = await fetch(`/api/customer-service/inbox/drafts/${draftId}/${action}`, { method: 'POST' });
      const data = await parseResponseJson(response); if (!response.ok) throw new Error(data.error || 'Reply action failed');
      setNotice(action === 'send'
        ? data.status === 'confirming'
          ? 'Gmail delivery is being confirmed. Do not send this reply again.'
          : 'Reply sent.'
        : 'Draft saved to Gmail.');
      if (selectedId) await Promise.all([loadDetail(selectedId), loadThreads(selectedId)]);
    } catch (cause: any) { setError(cause.message); } finally {
      replyActionPending.current = false;
      setBusyAction('');
    }
  }
  function startManualCompose(message: ThreadDetail['messages'][number], composeType: 'manual_reply' | 'forward') {
    const prefix = composeType === 'forward' ? 'Fwd:' : 'Re:';
    const subject = new RegExp(`^${prefix}`, 'i').test(message.subject || detail?.thread.subject || '')
      ? (message.subject || detail?.thread.subject || '')
      : `${prefix} ${message.subject || detail?.thread.subject || ''}`;
    const forwardedBody = composeType === 'forward'
      ? `\n\n---------- Forwarded message ----------\nFrom: ${message.from_address}\nDate: ${new Date(message.message_at).toLocaleString()}\nSubject: ${message.subject || detail?.thread.subject || ''}\n\n${message.body_plain}`
      : '';
    setManualComposer({
      composeType,
      targetMessageId: message.id,
      recipientEmail: composeType === 'forward' ? '' : detail?.thread.customer_email || '',
      subject,
      body: forwardedBody,
      operationKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    });
  }
  async function sendManualMessage() {
    if (!selectedId || !manualComposer || replyActionPending.current) return;
    replyActionPending.current = true;
    setBusyAction('manual-send'); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/customer-service/inbox/threads/${selectedId}/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualComposer),
      });
      const data = await parseResponseJson(response);
      if (!response.ok) throw new Error(data.error || 'Message could not be sent');
      setNotice(data.status === 'confirming'
        ? 'Gmail delivery is being confirmed. Do not send this message again.'
        : manualComposer.composeType === 'forward' ? 'Message forwarded.' : 'Reply sent.');
      setManualComposer(null);
      await Promise.all([loadDetail(selectedId), loadThreads(selectedId)]);
    } catch (cause: any) {
      setError(cause.message);
      setManualComposer(previous => previous ? {
        ...previous,
        operationKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      } : previous);
    } finally {
      replyActionPending.current = false;
      setBusyAction('');
    }
  }
  async function saveSettings() {
    if (!settings) return;
    if (settings.mode === 'send' && !window.confirm('Automatic send will email every successfully classified customer enquiry without review. Continue?')) return;
    setBusyAction('settings');
    try {
      const response = await fetch('/api/customer-service/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      const data = await parseResponseJson(response); if (!response.ok) throw new Error(data.error || 'Settings save failed');
      setSettings(data.settings); setNotice('Customer service settings saved.');
    } catch (cause: any) { setError(cause.message); } finally { setBusyAction(''); }
  }
  async function saveDocument(document: KnowledgeDocument) {
    setBusyAction(document.documentKey);
    try {
      const response = await fetch('/api/customer-service/knowledge', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentKey: document.documentKey, markdown: document.markdown, reason: 'Manual edit' }) });
      const data = await parseResponseJson(response); if (!response.ok) throw new Error(data.error || 'Knowledge save failed');
      setNotice(`${document.filename} saved as version ${data.version}.`); await loadKnowledge();
    } catch (cause: any) { setError(cause.message); } finally { setBusyAction(''); }
  }
  async function reviewCandidate(candidate: LearningCandidate, status: 'active' | 'rejected') {
    setBusyAction(`candidate-${candidate.id}`);
    try {
      const response = await fetch('/api/customer-service/learnings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: candidate.id, status, markdown: candidate.proposed_markdown }),
      });
      const data = await parseResponseJson(response); if (!response.ok) throw new Error(data.error || 'Learning review failed');
      await Promise.all([loadCandidates(), loadKnowledge()]);
    } catch (cause: any) { setError(cause.message); } finally { setBusyAction(''); }
  }

  const latestMessage = detail?.messages[detail.messages.length - 1];
  const activeDraft = !manualComposer && latestMessage?.direction === 'inbound'
    ? detail?.drafts.find(draft => draft.target_message_id === latestMessage.id && draft.compose_type === 'ai_reply' && draft.status !== 'sent')
    : undefined;
  return <div className="h-[calc(100vh-7rem)] min-h-[640px] flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden">
    <header className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3 bg-gray-50">
      <div className="mr-auto"><h1 className="text-lg font-bold text-gray-900">Customer Service</h1><p className="text-xs text-gray-500">{total} cached conversations, {settings?.retentionMode === 'limited' ? `retained for ${settings.retentionDays} days` : 'history kept until you change retention'}</p></div>
      <nav className="flex border border-gray-300 rounded-md overflow-hidden bg-white">{(['inbox', 'settings', 'learnings'] as ViewTab[]).map(item => <button key={item} onClick={() => setTab(item)} className={`px-3 py-1.5 text-xs font-semibold capitalize ${tab === item ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{item}</button>)}</nav>
    </header>
    {(error || notice) && <div className={`px-4 py-2 text-sm border-b ${error ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{error || notice}</div>}

    {tab === 'inbox' && <>
      <div className="px-4 py-2 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sender, subject, or message" className="min-w-52 flex-1 max-w-md border border-gray-300 rounded-md px-3 py-2 text-sm" />
        <select value={category} onChange={e => setCategory(e.target.value)} className="border border-gray-300 rounded-md px-2 py-2 text-sm"><option value="">All categories</option><option value="customer_enquiry">Customer enquiries</option><option value="junk">Junk</option><option value="other">Other</option><option value="unclassified">Unclassified</option></select>
        <label className="flex items-center gap-2 px-2 text-xs text-gray-600"><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> Unread only</label>
        <input type="number" min={1} max={90} value={days} onChange={e => setDays(Math.max(1, Math.min(90, Number(e.target.value))))} className="w-16 border border-gray-300 rounded-md px-2 py-2 text-sm" title="Lookback days" />
        <button onClick={runInbox} disabled={!!busyAction} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold disabled:opacity-50">{busyAction === 'sync' ? 'Working...' : 'Get Emails'}</button>
        <span className="text-xs text-gray-500">{threads.length} of {total}</span>
        {threads.length < total && <button onClick={() => loadThreads(selectedId, loadedPage + 1, true)} disabled={loading || !!busyAction} className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md text-sm font-semibold disabled:opacity-50">{loading ? 'Loading...' : 'Load more'}</button>}
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-r border-gray-200 overflow-y-auto">{loading && <p className="p-4 text-sm text-gray-500">Loading inbox...</p>}{!loading && !threads.length && <p className="p-6 text-sm text-gray-500">No matching emails. Use Get Emails to synchronize Gmail.</p>}{threads.map(thread => <button key={thread.id} onClick={() => setSelectedId(thread.id)} className={`w-full text-left px-4 py-3 border-b border-gray-100 ${selectedId === thread.id ? 'bg-blue-50' : 'hover:bg-gray-50'} ${thread.unread_count ? 'font-semibold' : ''}`}>
          <div className="flex items-center gap-2"><span onClick={event => { event.preventDefault(); event.stopPropagation(); void toggleThreadStar(thread.id, thread.is_starred); }} role="button" aria-label={thread.is_starred ? 'Unstar thread' : 'Star thread'} className={`text-base leading-none cursor-pointer select-none px-1 rounded ${thread.is_starred ? 'text-amber-600 hover:text-amber-700' : 'text-gray-300 hover:text-amber-500'} ${busyAction === `star-${thread.id}` ? 'opacity-50 pointer-events-none' : ''}`}>{thread.is_starred ? '★' : '☆'}</span><span className="text-sm truncate flex-1 text-gray-900">{thread.customer_email || 'Unknown sender'}</span><time className="text-[11px] text-gray-400 shrink-0">{new Date(thread.last_message_at).toLocaleDateString()}</time></div><p className="text-sm text-gray-800 truncate mt-0.5">{thread.subject || '(No subject)'}</p><p className="text-xs text-gray-500 truncate mt-1">{thread.snippet}</p>
          <div className="flex items-center gap-1.5 mt-2"><span className={`px-1.5 py-0.5 border rounded text-[10px] font-medium ${categoryStyle(thread.category)}`}>{(thread.category || 'unclassified').replace('_', ' ')}</span>{thread.enquiry_subtype && <span className="text-[10px] text-gray-500">{thread.enquiry_subtype.replace('_', ' ')}</span>}{['high', 'urgent'].includes(thread.urgency) && <span className="text-[10px] text-red-600">{thread.urgency}</span>}{thread.draft_status && <span className="ml-auto text-[10px] text-blue-600">{thread.draft_status}</span>}</div>
        </button>)}</aside>
        <main ref={conversationScrollRef} className="min-w-0 overflow-y-auto bg-gray-50">{!detail && <div className="h-full grid place-items-center text-sm text-gray-400">Select a conversation</div>}{detail && <div className="max-w-4xl mx-auto">
          <div ref={conversationHeaderRef} className="sticky top-0 z-10 px-5 py-3 bg-white border-b border-gray-200 flex flex-wrap items-center gap-2"><div className="mr-auto min-w-0"><h2 className="font-bold text-gray-900 truncate">{detail.thread.subject}</h2><p className="text-xs text-gray-500">{detail.thread.customer_email}</p></div><select value={detail.thread.category || ''} onChange={e => patchThread({ category: e.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-xs"><option value="">Unclassified</option><option value="customer_enquiry">Customer enquiry</option><option value="junk">Junk</option><option value="other">Other</option></select><button onClick={toggleStar} disabled={busyAction === 'star'} className={`px-2 py-1.5 border rounded text-xs font-semibold ${detail.thread.is_starred ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-300 text-gray-700'} disabled:opacity-50`}>{detail.thread.is_starred ? '★ Starred' : '☆ Star'}</button><button onClick={() => mailboxAction(detail.thread.unread_count ? 'read' : 'unread')} disabled={!!busyAction} className="px-2 py-1.5 border border-gray-300 rounded text-xs">{detail.thread.unread_count ? 'Mark read' : 'Mark unread'}</button><button onClick={() => mailboxAction('archive')} disabled={!!busyAction} className="px-2 py-1.5 border border-gray-300 rounded text-xs">Archive</button></div>
          {detail.otherConversations?.length > 0 && <section className="px-5 py-3 bg-white border-b border-gray-200"><h3 className="text-xs font-bold uppercase text-gray-500">Other conversations with this customer</h3><div className="mt-2 flex gap-2 overflow-x-auto pb-1">{detail.otherConversations.map(conversation => <button key={conversation.id} onClick={() => setSelectedId(conversation.id)} className="min-w-52 max-w-72 text-left border border-gray-200 bg-gray-50 hover:bg-blue-50 px-3 py-2 rounded"><span className="block text-xs font-semibold text-gray-800 truncate">{conversation.subject || '(No subject)'}</span><span className="block mt-1 text-[11px] text-gray-500">{new Date(conversation.last_message_at).toLocaleDateString()} · {(conversation.category || 'unclassified').replace('_', ' ')}</span></button>)}</div></section>}
          <div className="p-5 space-y-3">{[...detail.messages].sort((left, right) => toTime(left.message_at) - toTime(right.message_at)).map(message => <div key={message.id} className="space-y-2"><article ref={message.id === latestMessage?.id ? latestMessageRef : undefined} className={`border rounded-md p-4 ${message.direction === 'inbound' ? 'bg-white border-gray-200' : 'bg-blue-50 border-blue-200 ml-4'}`}><div className="flex justify-between gap-3 text-xs text-gray-500 mb-3"><span className="truncate">{message.from_address}</span><time className="shrink-0">{new Date(message.message_at).toLocaleString()}</time></div><div className="whitespace-pre-wrap font-sans text-sm leading-6 text-gray-800 break-words">{renderEmailBodyWithHyperlinks(message.body_plain)}</div>{parseJson<any[]>(message.attachment_metadata_json, []).length > 0 && <p className="mt-3 text-xs text-gray-500">{parseJson<any[]>(message.attachment_metadata_json, []).length} attachment(s), content not processed by AI</p>}<div className="mt-4 pt-3 border-t border-gray-100 flex justify-end gap-2"><button onClick={() => startManualCompose(message, 'manual_reply')} disabled={!!busyAction} className="px-2.5 py-1.5 border border-gray-300 bg-white text-gray-700 rounded text-xs font-semibold disabled:opacity-50">Reply</button><button onClick={() => startManualCompose(message, 'forward')} disabled={!!busyAction} className="px-2.5 py-1.5 border border-gray-300 bg-white text-gray-700 rounded text-xs font-semibold disabled:opacity-50">Forward</button></div></article>{manualComposer?.targetMessageId === message.id && <section className="border border-blue-300 bg-white rounded-md overflow-hidden"><div className="px-4 py-3 bg-blue-50 border-b border-blue-200"><h3 className="font-bold text-sm text-blue-900">{manualComposer.composeType === 'forward' ? 'Forward email' : 'Reply'}</h3></div><div className="p-4 space-y-3">{manualComposer.composeType === 'forward' ? <label className="block text-xs font-semibold text-gray-600">To<input type="email" value={manualComposer.recipientEmail} onChange={event => setManualComposer({ ...manualComposer, recipientEmail: event.target.value })} autoFocus className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm font-normal" /></label> : <p className="text-xs text-gray-600">To: <span className="font-semibold">{manualComposer.recipientEmail}</span></p>}<label className="block text-xs font-semibold text-gray-600">Subject<input value={manualComposer.subject} onChange={event => setManualComposer({ ...manualComposer, subject: event.target.value })} className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm font-normal" /></label><textarea value={manualComposer.body} onChange={event => setManualComposer({ ...manualComposer, body: event.target.value })} autoFocus={manualComposer.composeType === 'manual_reply'} rows={10} className="w-full border border-gray-300 rounded p-3 text-sm leading-6 resize-y outline-none focus:border-blue-500" /></div><div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2"><button onClick={() => setManualComposer(null)} disabled={busyAction === 'manual-send'} className="px-3 py-2 border border-gray-300 rounded text-sm font-semibold text-gray-600 disabled:opacity-50">Cancel</button><button onClick={sendManualMessage} disabled={busyAction === 'manual-send' || !manualComposer.recipientEmail.trim() || !manualComposer.subject.trim() || !manualComposer.body.trim()} className="px-3 py-2 bg-blue-600 text-white rounded text-sm font-semibold disabled:bg-gray-300">{busyAction === 'manual-send' ? 'Sending...' : manualComposer.composeType === 'forward' ? 'Send forward' : 'Send reply'}</button></div></section>}</div>)}
          {activeDraft && <section className="border border-blue-300 bg-white rounded-md overflow-hidden"><div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center gap-2"><h3 className="font-bold text-sm text-blue-900">AI reply draft</h3><span className="text-xs text-blue-700">{activeDraft.confidence !== null ? `${Math.round(Number(activeDraft.confidence) * 100)}% confidence` : ''}</span><span className="ml-auto text-xs text-blue-700">{activeDraft.status}</span></div>{(activeDraft.needs_information || activeDraft.escalation_reason) && <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">{activeDraft.escalation_reason || 'The AI needs more information before this can be answered reliably.'}</div>}<textarea value={activeDraft.current_body} onChange={e => updateDraftBody(e.target.value)} disabled={['sending', 'sent'].includes(activeDraft.status)} rows={12} className="w-full p-4 text-sm leading-6 resize-y outline-none disabled:bg-gray-50 disabled:text-gray-600" />{parseJson<any[]>(activeDraft.tool_provenance_json, []).length > 0 && <details className="px-4 py-2 border-t border-gray-100 text-xs text-gray-600"><summary className="cursor-pointer font-semibold">Business data used</summary><pre className="mt-2 whitespace-pre-wrap overflow-auto max-h-48">{JSON.stringify(parseJson(activeDraft.tool_provenance_json, []), null, 2)}</pre></details>}{activeDraft.last_error && <p className={`px-4 py-2 text-xs ${activeDraft.status === 'sending' ? 'text-amber-800 bg-amber-50' : 'text-red-700 bg-red-50'}`}>{activeDraft.last_error}</p>}<div className="px-4 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2"><button onClick={() => updateDraftBody('')} disabled={!!busyAction || ['sending', 'sent'].includes(activeDraft.status) || !activeDraft.current_body} className="px-3 py-2 border border-gray-300 rounded text-sm font-semibold text-gray-600 disabled:bg-gray-100 disabled:text-gray-400">Clear</button><button onClick={() => saveDraft()} disabled={!!busyAction || ['sending', 'sent'].includes(activeDraft.status)} className="px-3 py-2 border border-gray-300 rounded text-sm font-semibold disabled:bg-gray-100 disabled:text-gray-400">Save edit</button><button onClick={() => replyAction('gmail-draft')} disabled={!!busyAction || ['sending', 'sent'].includes(activeDraft.status)} className="px-3 py-2 bg-gray-700 text-white rounded text-sm font-semibold disabled:bg-gray-300">Save to Gmail Drafts</button><button onClick={() => replyAction('send')} disabled={!!busyAction || ['sending', 'sent'].includes(activeDraft.status)} className={`px-3 py-2 text-white rounded text-sm font-semibold ${activeDraft.status === 'sent' ? 'bg-gray-400' : activeDraft.status === 'sending' ? 'bg-amber-500' : 'bg-emerald-600 disabled:bg-gray-400'}`}>{busyAction === 'send' ? 'Sending...' : activeDraft.status === 'sent' ? 'Sent' : activeDraft.status === 'sending' ? 'Confirming send...' : 'Send reply'}</button></div></section>}
          {!manualComposer && !activeDraft && latestMessage?.direction === 'inbound' && detail.thread.category === 'customer_enquiry' && <p className="p-4 border border-amber-200 bg-amber-50 text-sm text-amber-800 rounded-md">No draft is available yet. Get Emails runs AI processing for unprocessed enquiries.</p>}</div>
        </div>}</main>
      </div>
    </>}

    {tab === 'settings' && settings && <div className="flex-1 overflow-y-auto p-5 bg-gray-50"><div className="max-w-4xl mx-auto space-y-6">
      <section><h2 className="text-base font-bold text-gray-900">Automation</h2><div className="mt-3 grid sm:grid-cols-2 gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} /> Scheduled inbox processing enabled</label><label className="text-sm">Timezone<input value={settings.timezone} onChange={e => setSettings({ ...settings, timezone: e.target.value })} className="mt-1 w-full border border-gray-300 rounded px-3 py-2" /></label><label className="text-sm">Run times (comma separated)<input value={settings.runTimes.join(', ')} onChange={e => setSettings({ ...settings, runTimes: e.target.value.split(',').map(item => item.trim()) })} className="mt-1 w-full border border-gray-300 rounded px-3 py-2" /></label><label className="text-sm">Automation mode<select value={settings.mode} onChange={e => setSettings({ ...settings, mode: e.target.value as 'draft' | 'send' })} className={`mt-1 w-full border rounded px-3 py-2 ${settings.mode === 'send' ? 'border-red-400 bg-red-50 text-red-800' : 'border-gray-300'}`}><option value="draft">Create drafts for review</option><option value="send">Send automatically</option></select></label></div>{settings.lastRunAt && <p className="text-xs text-gray-500 mt-3">Last run: {new Date(settings.lastRunAt).toLocaleString()}</p>}{settings.lastError && <p className="text-xs text-red-700 mt-2">Last error: {settings.lastError}</p>}</section>
      <section className="border-t border-gray-200 pt-5"><h2 className="text-base font-bold text-gray-900">Conversation history</h2><label className="mt-3 block max-w-sm text-sm">Cached history retention<select value={settings.retentionMode === 'keep_all' ? 'keep_all' : String(settings.retentionDays)} onChange={e => setSettings({ ...settings, retentionMode: e.target.value === 'keep_all' ? 'keep_all' : 'limited', retentionDays: e.target.value === 'keep_all' ? settings.retentionDays : Number(e.target.value) })} className="mt-1 w-full border border-gray-300 rounded px-3 py-2"><option value="keep_all">Keep all synced history</option><option value="90">Keep 90 days</option><option value="180">Keep 180 days</option><option value="365">Keep 365 days</option></select></label><p className="mt-2 text-xs text-gray-500">Limited retention removes only Solvantis's cached copy of inactive conversations. It does not delete Gmail mail.</p></section>
      <section className="border-t border-gray-200 pt-5"><h2 className="text-base font-bold text-gray-900">AI models</h2><div className="mt-3 grid sm:grid-cols-2 gap-4"><label className="text-sm">Light classification model<select value={settings.lightModelId} onChange={e => setSettings({ ...settings, lightModelId: e.target.value })} className="mt-1 w-full border border-gray-300 rounded px-3 py-2"><option value={settings.lightModelId}>{settings.lightModelId}</option>{models.filter(m => m.id !== settings.lightModelId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="text-sm">Capable reply model<select value={settings.capableModelId} onChange={e => setSettings({ ...settings, capableModelId: e.target.value })} className="mt-1 w-full border border-gray-300 rounded px-3 py-2"><option value={settings.capableModelId}>{settings.capableModelId}</option>{models.filter(m => m.id !== settings.capableModelId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div></section>
      <section className="border-t border-gray-200 pt-5"><h2 className="text-base font-bold text-gray-900">Read-only business data tools</h2><div className="mt-3 grid sm:grid-cols-2 gap-2">{Object.entries(TOOL_LABELS).map(([name, label]) => <label key={name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabledTools.includes(name)} onChange={e => setSettings({ ...settings, enabledTools: e.target.checked ? [...settings.enabledTools, name] : settings.enabledTools.filter(tool => tool !== name) })} /> {label}</label>)}</div><p className="text-xs text-gray-500 mt-2">These tools reuse live IMS Products, Stock Levels, Locations, Contacts and Sales Orders. They cannot write data or expose costs and internal notes.</p></section>
      <section className="border-t border-gray-200 pt-5"><h2 className="text-base font-bold text-gray-900">Reply guidelines</h2><textarea value={settings.guidelines} onChange={e => setSettings({ ...settings, guidelines: e.target.value })} rows={8} className="mt-3 w-full border border-gray-300 rounded p-3 text-sm" /><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.learningEnabled} onChange={e => setSettings({ ...settings, learningEnabled: e.target.checked })} /> Learn from edited responses</label></section>
      <button onClick={saveSettings} disabled={!!busyAction} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-semibold">Save settings</button>
    </div></div>}

    {tab === 'learnings' && <div className="flex-1 overflow-y-auto p-5 bg-gray-50"><div className="max-w-4xl mx-auto"><h2 className="text-base font-bold text-gray-900">Continuous learning</h2><p className="text-sm text-gray-600 mt-1">Repeated style edits can activate automatically. Facts and policies always wait for review.</p>
      {candidates.length > 0 && <section className="mt-5 border-y border-gray-200 divide-y divide-gray-200">{candidates.map(candidate => <div key={candidate.id} className="py-3 flex flex-col sm:flex-row sm:items-start gap-3"><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold text-gray-800">{candidate.title}</h3><span className="text-[10px] uppercase text-gray-500">{candidate.rule_type}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${candidate.status === 'active' ? 'bg-emerald-100 text-emerald-700' : candidate.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'}`}>{candidate.auto_activated ? 'auto-active' : candidate.status}</span></div><p className="text-sm text-gray-700 mt-1">{candidate.proposed_markdown}</p><p className="text-xs text-gray-500 mt-1">{candidate.evidence_count} supporting edits, {Math.round(Number(candidate.confidence) * 100)}% confidence</p></div>{candidate.status === 'pending' && <div className="flex gap-2"><button onClick={() => reviewCandidate(candidate, 'rejected')} disabled={!!busyAction} className="px-2 py-1.5 border border-gray-300 rounded text-xs">Reject</button><button onClick={() => reviewCandidate(candidate, 'active')} disabled={!!busyAction} className="px-2 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold">Approve</button></div>}</div>)}</section>}
      <h2 className="text-base font-bold text-gray-900 mt-7">Compact learning documents</h2><p className="text-sm text-gray-600 mt-1">Style is capped at 800 words; factual knowledge is capped at 1,500 words. Previous versions are retained.</p><div className="mt-5 space-y-6">{documents.map((document, index) => <section key={document.documentKey}><div className="flex items-center gap-2 mb-2"><h3 className="text-sm font-bold text-gray-800">{document.filename}</h3><span className="text-xs text-gray-500">Version {document.version}</span></div><textarea value={document.markdown} onChange={e => setDocuments(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, markdown: e.target.value } : item))} rows={document.documentKey === 'style' ? 16 : 24} className="w-full border border-gray-300 rounded p-3 font-mono text-xs leading-5" /><div className="mt-2 flex justify-between items-center"><span className="text-xs text-gray-500">{document.markdown.trim().split(/\s+/).filter(Boolean).length} words</span><button onClick={() => saveDocument(document)} disabled={!!busyAction} className="px-3 py-2 bg-gray-800 text-white rounded text-sm font-semibold">Save document</button></div></section>)}</div></div></div>}
  </div>;
}