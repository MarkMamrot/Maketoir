"use client";

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { buildDashboardHash, dashboardHashParam } from './dashboardHandoff';
import {
  messageCitations,
  messageQuestions,
  plannerResponseJson,
  planningThreadTypeLabel,
  type PlanningMessage,
  type PlanningThread,
  type PlanningThreadDetail,
  type PlanningThreadType,
} from './plannerWorkspaceModel';

const THREAD_TYPES: Array<{ value: PlanningThreadType; label: string }> = [
  { value: 'strategy', label: 'Strategy' },
  { value: 'initiative', label: 'Initiative' },
  { value: 'recommendation', label: 'Recommendation' },
];

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function stateLabel(state: string): string {
  return state.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function ThreadButton({ thread, selected, onSelect }: {
  thread: PlanningThread;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${selected
        ? 'border-cyan-700 bg-cyan-50 text-gray-950'
        : 'border-transparent text-gray-700 hover:bg-gray-50'}`}
    >
      <span className="block truncate text-sm font-semibold">{thread.title}</span>
      <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
        <span>{planningThreadTypeLabel(thread.thread_type)}</span>
        <span>{stateLabel(thread.state)}</span>
      </span>
    </button>
  );
}

function ConversationMessage({ message }: { message: PlanningMessage }) {
  if (message.actor_type === 'system') {
    return (
      <article className="border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs leading-5 text-cyan-900">
        <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><p>{message.content}</p></div>
      </article>
    );
  }
  const assistant = message.actor_type === 'assistant';
  const citations = messageCitations(message);
  return (
    <article className={`flex gap-3 ${assistant ? '' : 'justify-end'}`}>
      {assistant && (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-cyan-200 bg-cyan-50 text-cyan-800">
          <Bot size={16} />
        </span>
      )}
      <div className={`min-w-0 max-w-3xl ${assistant ? 'flex-1' : 'max-w-[85%]'}`}>
        <div className={`px-4 py-3 text-sm leading-6 ${assistant
          ? 'border border-gray-200 bg-white text-gray-800'
          : 'bg-gray-900 text-white'}`}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <div className={`mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-400 ${assistant ? '' : 'justify-end'}`}>
          <span>{assistant ? 'Intel & Automation' : 'You'}</span>
          <span>{formatTime(message.created_at)}</span>
          {citations.length > 0 && <span>{citations.length} cited fact{citations.length === 1 ? '' : 's'}</span>}
        </div>
        {citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Cited facts">
            {citations.map((factId) => (
              <span key={factId} title={factId} className="max-w-full truncate border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[10px] text-gray-500">
                {factId}
              </span>
            ))}
          </div>
        )}
      </div>
      {!assistant && (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-gray-300 bg-white text-gray-600">
          <UserRound size={15} />
        </span>
      )}
    </article>
  );
}

export function ForesightPlannerWorkspace({ userTier }: { userTier: string }) {
  const [threads, setThreads] = useState<PlanningThread[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlanningThreadDetail | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [draftingPlan, setDraftingPlan] = useState(false);
  const [reviewingPlan, setReviewingPlan] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newType, setNewType] = useState<PlanningThreadType>('strategy');
  const [newTitle, setNewTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'warning' | 'success'; text: string } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const isAdmin = userTier === 'Admin' || userTier === 'SuperAdmin';

  const loadThreads = async (preferredId?: number | null) => {
    setLoadingThreads(true);
    try {
      const response = await fetch('/api/foresight/planning/threads', { cache: 'no-store' });
      const body = await plannerResponseJson(response);
      if (!response.ok) throw new Error(String(body.error || 'Unable to load planning threads.'));
      const nextThreads = Array.isArray(body.threads) ? body.threads as PlanningThread[] : [];
      setThreads(nextThreads);
      setSelectedId((current) => {
        const candidate = preferredId ?? current;
        return candidate != null && nextThreads.some((thread) => thread.id === candidate)
          ? candidate
          : nextThreads[0]?.id ?? null;
      });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load planning threads.' });
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadDetail = async (threadId: number) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/foresight/planning/threads/${threadId}`, { cache: 'no-store' });
      const body = await plannerResponseJson(response);
      if (!response.ok) throw new Error(String(body.error || 'Unable to load this planning thread.'));
      setDetail(body as unknown as PlanningThreadDetail);
    } catch (error) {
      setDetail(null);
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load this planning thread.' });
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    const requested = Number(dashboardHashParam(window.location.hash, 'thread'));
    void loadThreads(Number.isInteger(requested) && requested > 0 ? requested : undefined);
  }, []);
  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    setNotice(null);
    void loadDetail(selectedId);
  }, [selectedId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [detail?.messages.length, sending]);

  const createThread = async () => {
    if (!isAdmin || newTitle.trim().length < 3) return;
    setCreating(true);
    setNotice(null);
    try {
      const response = await fetch('/api/foresight/planning/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadType: newType, title: newTitle.trim() }),
      });
      const body = await plannerResponseJson(response);
      if (!response.ok) throw new Error(String(body.error || 'Unable to create planning thread.'));
      const thread = body.thread as unknown as PlanningThread;
      setShowCreate(false);
      setNewTitle('');
      await loadThreads(thread.id);
      setSelectedId(thread.id);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to create planning thread.' });
    } finally {
      setCreating(false);
    }
  };

  const sendTurn = async () => {
    if (!detail || !draft.trim() || sending) return;
    const content = draft.trim();
    setSending(true);
    setDraft('');
    setNotice(null);
    try {
      const response = await fetch(`/api/foresight/planning/threads/${detail.thread.id}/turn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: detail.thread.revision, content }),
      });
      const body = await plannerResponseJson(response);
      if (!response.ok) {
        if (response.status === 409) {
          setNotice({ kind: 'warning', text: 'This conversation changed in another tab. The latest version has been loaded.' });
          await Promise.all([loadThreads(detail.thread.id), loadDetail(detail.thread.id)]);
          return;
        }
        throw new Error(String(body.error || 'Intel & Automation could not complete this turn.'));
      }
      await Promise.all([loadThreads(detail.thread.id), loadDetail(detail.thread.id)]);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Intel & Automation could not complete this turn.' });
      await loadDetail(detail.thread.id);
    } finally {
      setSending(false);
    }
  };

  const draftPlan = async () => {
    if (!detail || draftingPlan) return;
    setDraftingPlan(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/foresight/planning/threads/${detail.thread.id}/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: detail.thread.revision }),
      });
      const body = await plannerResponseJson(response);
      if (!response.ok) {
        if (response.status === 409) {
          setNotice({ kind: 'warning', text: 'This planning thread changed in another tab. The latest version has been loaded.' });
          await Promise.all([loadThreads(detail.thread.id), loadDetail(detail.thread.id)]);
          return;
        }
        const validation = body.validation as { findings?: { blocking?: string[] } } | undefined;
        const blocking = validation?.findings?.blocking?.[0];
        throw new Error(blocking || String(body.error || 'Intel & Automation could not draft this plan.'));
      }
      setNotice({ kind: 'success', text: detail.latestPlan ? 'A new immutable plan version was drafted.' : 'The first structured plan version was drafted.' });
      await Promise.all([loadThreads(detail.thread.id), loadDetail(detail.thread.id)]);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Intel & Automation could not draft this plan.' });
    } finally {
      setDraftingPlan(false);
    }
  };

  const submitPlanForReview = async () => {
    if (!detail?.latestPlan || reviewingPlan) return;
    setReviewingPlan(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/foresight/planning/threads/${detail.thread.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: detail.thread.revision,
          planVersionId: detail.latestPlan.id,
          planHash: detail.latestPlan.plan_hash,
          action: 'submitted',
        }),
      });
      const body = await plannerResponseJson(response);
      if (!response.ok) {
        if (response.status === 409) {
          setNotice({ kind: 'warning', text: 'This planning thread changed. The latest version has been loaded.' });
          await Promise.all([loadThreads(detail.thread.id), loadDetail(detail.thread.id)]);
          return;
        }
        throw new Error(String(body.error || 'Unable to submit this plan for review.'));
      }
      setNotice({ kind: 'success', text: 'This exact plan version is locked and ready for a human decision in Recommendation Inbox.' });
      await Promise.all([loadThreads(detail.thread.id), loadDetail(detail.thread.id)]);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to submit this plan for review.' });
    } finally {
      setReviewingPlan(false);
    }
  };

  const latestAssistant = [...(detail?.messages ?? [])].reverse().find((message) => message.actor_type === 'assistant');
  const questions = messageQuestions(latestAssistant);
  const recommendationLink = detail?.links.find((link) => link.link_type === 'recommendation') ?? null;

  return (
    <section className="min-h-[680px] overflow-hidden rounded-t-2xl border border-gray-200 bg-white" aria-label="Intel & Automation planning workspace">
      <div className="grid min-h-[680px] grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_280px]">
        <aside className="border-b border-gray-200 bg-gray-50/70 lg:border-b-0 lg:border-r" aria-label="Planning threads">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-gray-950">Planning threads</h2>
              <p className="mt-0.5 text-[11px] text-gray-500">Durable working conversations</p>
            </div>
            {isAdmin && (
              <button type="button" onClick={() => setShowCreate(true)} title="New planning thread" className="flex h-8 w-8 items-center justify-center border border-gray-300 bg-white text-gray-600 hover:border-cyan-600 hover:text-cyan-700">
                <Plus size={16} />
              </button>
            )}
          </div>
          {showCreate && (
            <div className="border-b border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-gray-500">New thread</span>
                <button type="button" onClick={() => setShowCreate(false)} title="Close" className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-3 border border-gray-300" role="group" aria-label="Planning thread type">
                {THREAD_TYPES.map((type) => (
                  <button key={type.value} type="button" onClick={() => setNewType(type.value)} className={`px-2 py-2 text-[11px] font-semibold ${newType === type.value ? 'bg-cyan-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {type.label}
                  </button>
                ))}
              </div>
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={200} placeholder="Thread title" className="mt-3 h-10 w-full border border-gray-300 px-3 text-sm outline-none focus:border-cyan-600" />
              <button type="button" onClick={() => void createThread()} disabled={creating || newTitle.trim().length < 3} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 bg-gray-900 px-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create thread
              </button>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto lg:max-h-[610px]">
            {loadingThreads ? (
              <div className="flex h-28 items-center justify-center text-gray-400"><Loader2 size={18} className="animate-spin" /></div>
            ) : threads.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <MessageSquareText size={23} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-medium text-gray-600">No planning threads yet</p>
              </div>
            ) : threads.map((thread) => (
              <ThreadButton key={thread.id} thread={thread} selected={selectedId === thread.id} onSelect={() => setSelectedId(thread.id)} />
            ))}
          </div>
        </aside>

        <div className="flex min-h-[610px] min-w-0 flex-col">
          <header className="flex min-h-16 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-gray-950">{detail?.thread.title ?? 'Planning workspace'}</h2>
              {detail && <p className="mt-0.5 text-xs text-gray-500">{planningThreadTypeLabel(detail.thread.thread_type)} · {stateLabel(detail.thread.state)} · Revision {detail.thread.revision}</p>}
            </div>
            {detail && (
              <div className="flex shrink-0 items-center gap-2">
                {recommendationLink && (
                  <button type="button" onClick={() => { window.location.hash = buildDashboardHash('marketing-recommendations', { recommendation: recommendationLink.link_id }); }} className="inline-flex h-8 items-center gap-2 border border-gray-300 px-2.5 text-xs font-semibold text-gray-600 hover:border-cyan-600 hover:text-cyan-700">
                    Inbox <ExternalLink size={13} />
                  </button>
                )}
                <button type="button" onClick={() => void loadDetail(detail.thread.id)} title="Refresh conversation" disabled={loadingDetail || sending} className="flex h-8 w-8 items-center justify-center border border-gray-300 text-gray-500 hover:text-cyan-700 disabled:opacity-40">
                  <RefreshCw size={15} className={loadingDetail ? 'animate-spin' : ''} />
                </button>
              </div>
            )}
          </header>

          {notice && (
            <div className={`flex items-start gap-2 border-b px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : notice.kind === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {notice.kind === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
              <span className="flex-1">{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} title="Dismiss"><X size={15} /></button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/30 px-4 py-5 sm:px-6">
            {loadingDetail ? (
              <div className="flex h-full min-h-72 items-center justify-center text-gray-400"><Loader2 size={22} className="animate-spin" /></div>
            ) : !detail ? (
              <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
                <MessageSquareText size={30} className="text-gray-300" />
                <p className="mt-4 text-sm font-semibold text-gray-700">{threads.length === 0 ? 'Create a planning thread to begin.' : 'Select a planning thread.'}</p>
              </div>
            ) : detail.messages.length === 0 ? (
              <div className="mx-auto flex min-h-72 max-w-xl flex-col items-center justify-center text-center">
                <Bot size={31} className="text-cyan-700" />
                <h3 className="mt-4 text-lg font-bold text-gray-900">Start with the decision, not the data request</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">Describe the goal, concern, or opportunity. Intel &amp; Automation can inspect reviewed sales, contribution, stock, inbound supply, strategy, and recommendation facts as needed.</p>
              </div>
            ) : (
              <div className="mx-auto max-w-4xl space-y-6">
                {detail.messages.map((message) => <ConversationMessage key={message.id} message={message} />)}
                {sending && (
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="flex h-8 w-8 items-center justify-center border border-cyan-200 bg-cyan-50 text-cyan-800"><Loader2 size={16} className="animate-spin" /></span>
                    <span>Reviewing governed business facts…</span>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <footer className="border-t border-gray-200 bg-white p-3 sm:p-4">
            <div className="mx-auto flex max-w-4xl items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendTurn(); }
                }}
                disabled={!detail || sending}
                maxLength={8_000}
                rows={3}
                aria-label="Planning message"
                placeholder={detail ? 'Describe the goal, decision, constraint, or question…' : 'Select a planning thread'}
                className="min-h-[76px] min-w-0 flex-1 resize-none border border-gray-300 px-3 py-2 text-sm leading-5 text-gray-900 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600 disabled:bg-gray-50"
              />
              <button type="button" onClick={() => void sendTurn()} disabled={!detail || sending || !draft.trim()} title="Send planning message" className="flex h-10 w-10 shrink-0 items-center justify-center bg-cyan-700 text-white hover:bg-cyan-800 disabled:bg-gray-200 disabled:text-gray-400">
                {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
              </button>
            </div>
          </footer>
        </div>

        <aside className="border-t border-gray-200 bg-white lg:border-l lg:border-t-0" aria-label="Planning context">
          <div className="border-b border-gray-200 px-4 py-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-gray-950"><ShieldCheck size={16} className="text-cyan-700" /> Governed context</h2>
            <p className="mt-2 text-xs leading-5 text-gray-500">Read-only business facts. Conversation text cannot approve or execute actions.</p>
          </div>
          <div className="space-y-5 p-4">
            {recommendationLink && (
              <section>
                <h3 className="text-[11px] font-bold uppercase text-gray-500">Linked recommendation</h3>
                <div className="mt-2 text-sm font-semibold text-gray-800">Recommendation #{recommendationLink.link_id}</div>
                <button type="button" onClick={() => { window.location.hash = buildDashboardHash('marketing-recommendations', { recommendation: recommendationLink.link_id }); }} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-700 hover:text-cyan-900">
                  Review authorization state <ExternalLink size={12} />
                </button>
              </section>
            )}
            <section>
              <h3 className="text-[11px] font-bold uppercase text-gray-500">Open questions</h3>
              {questions.length === 0 ? (
                <p className="mt-2 text-sm leading-5 text-gray-500">No unresolved questions in the latest response.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {questions.map((question, index) => (
                    <li key={`${index}:${question}`} className="flex gap-2 text-sm leading-5 text-gray-700">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-cyan-200 bg-cyan-50 text-[10px] font-bold text-cyan-800">{index + 1}</span>
                      <span>{question}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="border-t border-gray-200 pt-4">
              <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase text-gray-500"><FileText size={14} /> Current plan</h3>
              {detail?.latestPlan ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-gray-800">Version {detail.latestPlan.version ?? '—'}</div>
                    {detail.latestValidation && (
                      <span className={`text-[10px] font-bold uppercase ${detail.latestValidation.state === 'passed' ? 'text-emerald-700' : detail.latestValidation.state === 'needs_human' ? 'text-amber-700' : 'text-red-700'}`}>
                        {stateLabel(detail.latestValidation.state)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{stateLabel(detail.latestPlan.state ?? 'drafting')}</div>
                  {detail.latestValidation?.findings_json.needsHuman?.map((finding) => (
                    <p key={finding} className="mt-2 text-xs leading-5 text-amber-800">{finding}</p>
                  ))}
                  {detail.latestValidation?.findings_json.warnings?.map((finding) => (
                    <p key={finding} className="mt-2 text-xs leading-5 text-gray-600">{finding}</p>
                  ))}
                  {detail.latestReview && (
                    <div className="mt-3 border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase text-gray-500">Review status</div>
                      <div className="mt-1 text-xs font-semibold text-gray-800">{stateLabel(detail.latestReview.action)}</div>
                      {detail.latestReview.note && <p className="mt-1 text-xs leading-5 text-gray-600">{detail.latestReview.note}</p>}
                    </div>
                  )}
                  {detail.latestPlan.markdown_text && (
                    <details className="mt-3 border-t border-gray-200 pt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-cyan-700">View plan document</summary>
                      <div className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-gray-700">{detail.latestPlan.markdown_text}</div>
                    </details>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm leading-5 text-gray-500">No structured plan version has been drafted yet.</p>
              )}
              {detail && isAdmin && (
                <div className="mt-3 space-y-2">
                  {detail.latestPlan && detail.latestValidation?.state === 'passed' && !detail.latestReview && (
                    <button type="button" onClick={() => void submitPlanForReview()} disabled={reviewingPlan || sending || loadingDetail} className="inline-flex h-9 w-full items-center justify-center gap-2 bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-gray-200 disabled:text-gray-400">
                      {reviewingPlan ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Submit for review
                    </button>
                  )}
                  {detail.latestReview?.action !== 'submitted' && detail.latestReview?.action !== 'accepted' && (
                    <button type="button" onClick={() => void draftPlan()} disabled={draftingPlan || sending || loadingDetail} className="inline-flex h-9 w-full items-center justify-center gap-2 bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800 disabled:bg-gray-200 disabled:text-gray-400">
                      {draftingPlan ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                      {detail.latestPlan ? 'Revise plan' : 'Draft plan'}
                    </button>
                  )}
                </div>
              )}
            </section>
            <section className="border-t border-gray-200 pt-4">
              <h3 className="text-[11px] font-bold uppercase text-gray-500">Available evidence</h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-gray-600">
                <li>Commerce and contribution</li>
                <li>Product sales and inventory</li>
                <li>Inbound purchase orders</li>
                <li>Strategy and recommendations</li>
                <li>Business and brand context</li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </section>
  );
}