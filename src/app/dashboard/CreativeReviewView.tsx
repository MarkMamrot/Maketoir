"use client";

import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, FileText, ImageOff, Loader2, RefreshCw, Save, Sparkles } from 'lucide-react';

type Creative = {
  id: number; source: 'google_ads' | 'meta_ads'; creative_kind: string; name: string; format: string | null;
  status: string | null; copy_json: Record<string, unknown> | null; first_seen_on: string; last_seen_on: string;
};
type HumanContext = { intendedAudience: string; intendedMessage: string; offer: string; offlineContext: string };
type ReviewContext = {
  creative: Creative;
  assessment: { id: number; evidence_mode: string; assessment_json: {
    factualDescription: string; structuredTags: string[]; brandFitObservations: string[]; accessibilityIssues: string[]; uncertainties: string[];
  } } | null;
  thread: { id: number; revision: number } | null;
  messages: Array<{ id: number; actor_type: string; content: string; created_at: string }>;
  humanContext: HumanContext | null;
  diagnostics: {
    authority: string; rankingAllowed: boolean; eligibleCreativeCount: number; qualityIssues: string[];
    creatives: Array<{ creativeId: number; signals: string[]; ctrChangePercent: number | null; explanation: string[] }>;
    patterns: Array<{ tag: string; direction: string; creativeCount: number; disclaimer: string }>;
  };
  latestBrief: { version: number; document_hash: string; markdown_text: string; document_json: {
    title: string; hypothesis: string; audience: string; singleMindedProposition: string; proofPoints: string[];
    formats: Array<{ format: string; placement: string; adaptationNotes: string }>;
    variants: Array<{ id: string; change: string; rationale: string }>;
    successMetric: string; stockOfferConstraints: string[]; uncertainties: string[];
  } } | null;
  mediaUrl: string;
};

function responseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function yesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toLocaleDateString('sv-SE');
}

function copyText(value: Record<string, unknown> | null): string {
  if (!value) return 'No copy metadata is available.';
  return Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item])
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).join(' · ') || 'No copy metadata is available.';
}

export function CreativeReviewView({ userTier }: { userTier: string }) {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewContext | null>(null);
  const [throughDate, setThroughDate] = useState(yesterday);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [human, setHuman] = useState<HumanContext>({ intendedAudience: '', intendedMessage: '', offer: '', offlineContext: '' });
  const [changeReason, setChangeReason] = useState('');
  const isAdmin = userTier === 'Admin' || userTier === 'SuperAdmin';

  const loadCreatives = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/foresight/creatives?limit=100', { cache: 'no-store' });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(String(body.error || 'Unable to load creatives.'));
      const rows = Array.isArray(body.creatives) ? body.creatives as Creative[] : [];
      setCreatives(rows);
      setSelectedId((current) => current != null && rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load creatives.' });
    } finally { setLoading(false); }
  };

  const loadReview = async (creativeId: number) => {
    setWorking('load'); setMediaFailed(false);
    try {
      const response = await fetch(`/api/foresight/creatives/${creativeId}/review?through=${throughDate}`, { cache: 'no-store' });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(String(body.error || 'Unable to load Creative Review.'));
      const context = body as unknown as ReviewContext;
      setReview(context);
      setHuman(context.humanContext ?? { intendedAudience: '', intendedMessage: '', offer: '', offlineContext: '' });
    } catch (error) {
      setReview(null);
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load Creative Review.' });
    } finally { setWorking(null); }
  };

  useEffect(() => { void loadCreatives(); }, []);
  useEffect(() => { if (selectedId != null) void loadReview(selectedId); }, [selectedId, throughDate]);

  const post = async (payload: Record<string, unknown>, success: string) => {
    if (selectedId == null) return;
    setWorking(String(payload.operation)); setNotice(null);
    try {
      const response = await fetch(`/api/foresight/creatives/${selectedId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(String(body.error || 'Creative Review action failed.'));
      await loadReview(selectedId);
      setNotice({ kind: 'success', text: success });
      setChangeReason('');
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Creative Review action failed.' });
      if (review?.thread) await loadReview(selectedId);
    } finally { setWorking(null); }
  };

  const diagnostic = review?.diagnostics.creatives.find((item) => item.creativeId === selectedId) ?? null;
  const contextComplete = Object.values(human).every((value) => value.trim().length > 0);

  return (
    <section className="min-h-[720px] overflow-hidden border border-gray-200 bg-white" aria-label="Creative Review workspace">
      {notice && <div className={`border-b px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{notice.text}</div>}
      <div className="grid min-h-[720px] grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_340px]">
        <aside className="border-b border-gray-200 bg-gray-50 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div><h2 className="text-sm font-bold text-gray-950">Creatives</h2><p className="text-[11px] text-gray-500">Most recently observed</p></div>
            <button type="button" onClick={() => void loadCreatives()} title="Refresh creatives" className="flex h-8 w-8 items-center justify-center border border-gray-300 bg-white text-gray-600"><RefreshCw size={15} /></button>
          </div>
          <div className="max-h-64 overflow-y-auto lg:max-h-[660px]">
            {loading ? <div className="flex h-28 items-center justify-center"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
              : creatives.length === 0 ? <p className="px-5 py-10 text-center text-sm text-gray-500">No creative history has been ingested.</p>
                : creatives.map((creative) => <button key={creative.id} type="button" onClick={() => setSelectedId(creative.id)} className={`w-full border-l-2 px-4 py-3 text-left ${selectedId === creative.id ? 'border-cyan-700 bg-cyan-50' : 'border-transparent hover:bg-white'}`}>
                  <span className="block truncate text-sm font-semibold text-gray-900">{creative.name}</span>
                  <span className="mt-1 block text-[11px] text-gray-500">{creative.source === 'meta_ads' ? 'Meta' : 'Google Ads'} · {creative.format || creative.creative_kind}</span>
                </button>)}
          </div>
        </aside>

        <div className="min-w-0">
          {!review ? <div className="flex min-h-[600px] items-center justify-center text-sm text-gray-500">{working === 'load' ? <Loader2 size={22} className="animate-spin" /> : 'Select a creative.'}</div> : <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
              <div><h2 className="text-lg font-bold text-gray-950">{review.creative.name}</h2><p className="mt-1 text-xs text-gray-500">{review.creative.source === 'meta_ads' ? 'Meta' : 'Google Ads'} · Last seen {String(review.creative.last_seen_on).slice(0, 10)}</p></div>
              <label className="text-xs font-semibold text-gray-600">Evidence through <input type="date" value={throughDate} onChange={(event) => setThroughDate(event.target.value)} className="ml-2 h-9 border border-gray-300 px-2" /></label>
            </header>
            <div className="space-y-6 p-5">
              <div className="grid gap-5 md:grid-cols-[minmax(240px,360px)_1fr]">
                <div className="flex aspect-square items-center justify-center overflow-hidden border border-gray-200 bg-gray-50">
                  {!mediaFailed ? <img src={review.mediaUrl} alt={review.creative.name} onError={() => setMediaFailed(true)} className="h-full w-full object-contain" />
                    : <div className="px-6 text-center text-gray-400"><ImageOff size={28} className="mx-auto" /><p className="mt-3 text-xs">No reviewable image is available. Text evidence remains visible.</p></div>}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase text-gray-500">Creative copy</div>
                  <p className="mt-2 break-words text-sm leading-6 text-gray-800">{copyText(review.creative.copy_json)}</p>
                  <div className="mt-5 text-[11px] font-bold uppercase text-gray-500">Governed assessment</div>
                  <p className="mt-2 text-sm leading-6 text-gray-700">{review.assessment?.assessment_json.factualDescription || 'No assessment has been recorded.'}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">{(review.assessment?.assessment_json.structuredTags ?? []).map((tag) => <span key={tag} className="border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">{tag}</span>)}</div>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-5">
                <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-gray-950">Performance diagnostics</h3><span className="text-[11px] font-semibold uppercase text-amber-700">Platform diagnostic · non-causal</span></div>
                {diagnostic ? <div className="mt-3"><div className="flex flex-wrap gap-2">{diagnostic.signals.map((signal) => <span key={signal} className="border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{signal.replaceAll('_', ' ')}</span>)}</div>{diagnostic.explanation.map((item) => <p key={item} className="mt-2 text-sm text-gray-700">{item}</p>)}</div>
                  : <p className="mt-2 text-sm text-gray-500">No adequately exposed trend is available for this creative.</p>}
                {review.diagnostics.qualityIssues.map((issue) => <p key={issue} className="mt-2 flex gap-2 text-xs leading-5 text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{issue}</p>)}
              </div>

              {review.latestBrief && <div className="border-t border-gray-200 pt-5">
                <div className="flex items-center gap-2"><FileText size={16} className="text-cyan-700" /><h3 className="text-base font-bold text-gray-950">{review.latestBrief.document_json.title}</h3><span className="text-xs text-gray-500">v{review.latestBrief.version}</span></div>
                <p className="mt-3 text-sm leading-6 text-gray-700"><strong>Hypothesis:</strong> {review.latestBrief.document_json.hypothesis}</p>
                <p className="mt-2 text-sm leading-6 text-gray-700"><strong>Proposition:</strong> {review.latestBrief.document_json.singleMindedProposition}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">{review.latestBrief.document_json.variants.map((variant) => <div key={variant.id} className="border-l-2 border-cyan-600 pl-3"><div className="text-xs font-bold text-gray-900">{variant.id}</div><p className="mt-1 text-xs leading-5 text-gray-600">{variant.change}</p></div>)}</div>
                <p className="mt-4 text-xs text-gray-500">Draft only · Not publishable from Foresight · Hash {review.latestBrief.document_hash.slice(0, 12)}</p>
              </div>}
            </div>
          </>}
        </div>

        <aside className="border-t border-gray-200 bg-gray-50/60 lg:border-l lg:border-t-0">
          <div className="border-b border-gray-200 px-4 py-4"><h2 className="flex items-center gap-2 text-sm font-bold text-gray-950"><Bot size={16} className="text-cyan-700" /> Human context</h2><p className="mt-1 text-xs leading-5 text-gray-500">Required before a brief can be drafted.</p></div>
          {!review ? null : !review.thread ? <div className="p-4"><button type="button" disabled={!isAdmin || working != null} onClick={() => void post({ operation: 'start' }, 'Creative Review started.')} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-cyan-700 px-3 text-sm font-semibold text-white disabled:opacity-40"><Sparkles size={16} /> Start Creative Review</button></div>
            : <div className="space-y-4 p-4">
              {review.messages.slice(-3).map((message) => <div key={message.id} className={`border-l-2 pl-3 text-xs leading-5 ${message.actor_type === 'human' ? 'border-gray-800 text-gray-700' : 'border-cyan-600 text-gray-600'}`}>{message.content}</div>)}
              {(['intendedAudience', 'intendedMessage', 'offer', 'offlineContext'] as const).map((field) => <label key={field} className="block text-xs font-semibold text-gray-700">{{ intendedAudience: 'Intended audience', intendedMessage: 'Intended message', offer: 'Offer or no-offer decision', offlineContext: 'Offline / external context' }[field]}<textarea value={human[field]} onChange={(event) => setHuman((current) => ({ ...current, [field]: event.target.value }))} rows={field === 'offlineContext' ? 3 : 2} maxLength={field === 'offlineContext' ? 2000 : 1000} className="mt-1 w-full resize-none border border-gray-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cyan-600" /></label>)}
              <button type="button" disabled={!isAdmin || !contextComplete || working != null} onClick={() => void post({ operation: 'context', threadId: review.thread!.id, expectedRevision: review.thread!.revision, context: human }, 'Human creative context recorded.')} className="inline-flex h-9 w-full items-center justify-center gap-2 border border-gray-800 bg-white text-sm font-semibold text-gray-800 disabled:opacity-40"><Save size={15} /> Save context</button>
              <label className="block text-xs font-semibold text-gray-700">Revision reason<input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={500} placeholder={review.latestBrief ? 'What should this revision improve?' : 'Initial brief'} className="mt-1 h-9 w-full border border-gray-300 bg-white px-3 text-sm font-normal outline-none focus:border-cyan-600" /></label>
              <button type="button" disabled={!isAdmin || !review.humanContext || !review.assessment || working != null} onClick={() => void post({ operation: 'generate', threadId: review.thread!.id, expectedRevision: review.thread!.revision, diagnosticsThrough: throughDate, changeReason }, review.latestBrief ? 'A new immutable creative brief version was drafted.' : 'The first immutable creative brief was drafted.')} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-40">{working === 'generate' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {review.latestBrief ? 'Draft revision' : 'Draft brief'}</button>
            </div>}
        </aside>
      </div>
    </section>
  );
}
