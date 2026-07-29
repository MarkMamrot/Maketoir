"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  History,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  RECOMMENDATION_REASON_OPTIONS,
  recommendationReasonLabel,
  type RecommendationTransitionAction,
} from '@/lib/foresight/recommendationReasons';
import { MarketingStrategyPanel } from './MarketingStrategyPanel';

type RecommendationState = 'shadow' | 'pending_approval' | 'approved';
type Recommendation = {
  id: number;
  state: RecommendationState;
  channel: string;
  rule_id: string;
  evidence_json: {
    metricKeys: string[];
    sourceIds: string[];
    windowStart: string;
    windowEnd: string;
    quality: { grade: string; issues: Array<{ code: string; severity: string; message: string }> };
    observedValues?: Record<string, number | null>;
  };
  proposed_action_json: Record<string, unknown> | null;
  proposal_hash: string | null;
  confidence: number | string | null;
  expected_impact_low: number | string | null;
  expected_impact_high: number | string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};
type RecommendationEvent = {
  id: number;
  recommendation_id: number;
  from_state: string;
  to_state: string;
  actor_id: number;
  reason_code: string | null;
  note: string | null;
  created_at: string;
};
type InboxResponse = { success?: boolean; recommendations?: Recommendation[]; events?: RecommendationEvent[]; error?: string };
type Filter = 'all' | RecommendationState;

const RULE_LABELS: Record<string, string> = {
  spend_without_online_revenue: 'Spend without online revenue',
  contribution_poas_below_one: 'Contribution POAS below configured floor',
  mer_deterioration: 'MER deterioration',
};
const ACTION_LABELS: Record<string, string> = {
  investigate_measurement_and_spend: 'Investigate measurement and spend',
  review_budget_reduction: 'Review a capped budget reduction',
  review_channel_and_campaign_mix: 'Review channel and campaign mix',
};
const METRIC_LABELS: Record<string, string> = {
  spend: 'Paid-media spend',
  onlineRevenueExTax: 'Online revenue ex GST',
  contributionPoas: 'Contribution POAS',
  contributionBeforeAds: 'Contribution before ads',
  currentMer: 'Current MER',
  previousMer: 'Previous MER',
  deteriorationPercent: 'Deterioration',
};

function money(value: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
}

function metricValue(key: string, value: number | null): string {
  if (value == null) return 'Unavailable';
  if (key === 'spend' || key === 'onlineRevenueExTax' || key === 'contributionBeforeAds') return money(value);
  if (key === 'deteriorationPercent') return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function dateTime(value: string | null): string {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function stateLabel(state: RecommendationState): string {
  if (state === 'pending_approval') return 'Pending approval';
  if (state === 'approved') return 'Approved';
  return 'Shadow';
}

function stateIcon(state: RecommendationState) {
  if (state === 'approved') return <CheckCircle2 size={15} />;
  if (state === 'pending_approval') return <Clock3 size={15} />;
  return <ShieldCheck size={15} />;
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 500) }; }
}

export function MarketingRecommendationsView({ userTier }: { userTier: string }) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [events, setEvents] = useState<RecommendationEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<RecommendationTransitionAction>('approve');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const isAdmin = userTier === 'Admin' || userTier === 'SuperAdmin';

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/foresight/marketing/recommendations', { cache: 'no-store' });
      const body = await responseJson(response) as InboxResponse;
      if (!response.ok) throw new Error(body.error || 'Unable to load recommendations.');
      const next = body.recommendations ?? [];
      setRecommendations(next);
      setEvents(body.events ?? []);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load recommendations.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(
    () => recommendations.filter((item) => filter === 'all' || item.state === filter),
    [filter, recommendations],
  );
  const selected = recommendations.find((item) => item.id === selectedId) ?? null;
  const selectedEvents = events.filter((event) => event.recommendation_id === selectedId);

  const evaluate = async () => {
    setWorking('evaluate');
    setMessage(null);
    try {
      const response = await fetch('/api/foresight/marketing/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || 'Evaluation failed.');
      setMessage({ kind: 'success', text: `${body.recommendationCount ?? 0} current findings recorded.` });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Evaluation failed.' });
    } finally {
      setWorking(null);
    }
  };

  const transition = async (action: RecommendationTransitionAction) => {
    if (!selected || !reasonCode) return;
    setWorking(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, proposalHash: selected.proposal_hash, reasonCode, note }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || 'State change failed.');
      setNote('');
      setReasonCode('');
      setMessage({ kind: 'success', text: action === 'request_approval' ? 'Sent for approval.' : action === 'approve' ? 'Recommendation approved.' : 'Recommendation rejected.' });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'State change failed.' });
    } finally {
      setWorking(null);
    }
  };

  const counts = {
    all: recommendations.length,
    shadow: recommendations.filter((item) => item.state === 'shadow').length,
    pending_approval: recommendations.filter((item) => item.state === 'pending_approval').length,
    approved: recommendations.filter((item) => item.state === 'approved').length,
  };

  return (
    <div className="space-y-4">
      <MarketingStrategyPanel userTier={userTier} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-1" role="tablist" aria-label="Recommendation states">
          {(['all', 'shadow', 'pending_approval', 'approved'] as Filter[]).map((state) => (
            <button
              key={state}
              onClick={() => setFilter(state)}
              className={`px-3 py-2 text-sm border-b-2 transition-colors ${filter === state ? 'border-cyan-600 text-cyan-800 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {state === 'all' ? 'All' : stateLabel(state)} <span className="ml-1 tabular-nums text-xs text-gray-400">{counts[state]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} disabled={loading} title="Refresh recommendations" className="inline-flex h-9 w-9 items-center justify-center border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {isAdmin && (
            <button onClick={() => void evaluate()} disabled={working != null} className="inline-flex h-9 items-center gap-2 bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50">
              {working === 'evaluate' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Evaluate now
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 border px-3 py-2 text-sm ${message.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {message.kind === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          {message.text}
        </div>
      )}

      <div className="grid min-h-[560px] grid-cols-1 border border-gray-200 bg-white lg:grid-cols-[minmax(300px,0.85fr)_minmax(440px,1.5fr)]">
        <section className="border-b border-gray-200 lg:border-b-0 lg:border-r" aria-label="Recommendation queue">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-gray-400"><Loader2 size={22} className="animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-gray-500">No recommendations in this state.</div>
          ) : filtered.map((item) => {
            const isSelected = item.id === selectedId;
            const observed = item.evidence_json.observedValues ?? {};
            const leadMetric = Object.entries(observed)[0];
            return (
              <button
                key={item.id}
                onClick={() => { setSelectedId(item.id); setReviewAction('approve'); setReasonCode(''); setNote(''); setMessage(null); }}
                className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-4 text-left transition-colors ${isSelected ? 'bg-cyan-50/70' : 'hover:bg-gray-50'}`}
              >
                <span className={`mt-0.5 ${item.state === 'approved' ? 'text-emerald-600' : item.state === 'pending_approval' ? 'text-amber-600' : 'text-gray-400'}`}>{stateIcon(item.state)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{RULE_LABELS[item.rule_id] ?? item.rule_id}</span>
                  <span className="mt-1 block text-xs text-gray-500">{item.evidence_json.windowStart} to {item.evidence_json.windowEnd}</span>
                  <span className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-gray-500">{stateLabel(item.state)}</span>
                    {leadMetric && <span className="tabular-nums text-gray-700">{METRIC_LABELS[leadMetric[0]] ?? leadMetric[0]} {metricValue(leadMetric[0], leadMetric[1])}</span>}
                  </span>
                </span>
                <ChevronRight size={16} className="mt-1 shrink-0 text-gray-300" />
              </button>
            );
          })}
        </section>

        <section className="min-w-0 p-5 sm:p-6" aria-label="Recommendation details">
          {!selected ? (
            <div className="flex h-full min-h-64 items-center justify-center text-sm text-gray-500">Select a recommendation to review.</div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-500">
                    <span className={selected.state === 'approved' ? 'text-emerald-600' : selected.state === 'pending_approval' ? 'text-amber-600' : 'text-gray-500'}>{stateIcon(selected.state)}</span>
                    {stateLabel(selected.state)}
                  </div>
                  <h2 className="text-lg font-bold text-gray-950">{RULE_LABELS[selected.rule_id] ?? selected.rule_id}</h2>
                  <p className="mt-1 text-sm text-gray-500">Evidence window {selected.evidence_json.windowStart} to {selected.evidence_json.windowEnd}</p>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>Confidence {Math.round(Number(selected.confidence ?? 0) * 100)}%</div>
                  <div className="mt-1">Expires {dateTime(selected.expires_at)}</div>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Observed evidence</h3>
                <div className="grid grid-cols-2 gap-px bg-gray-200 border border-gray-200 sm:grid-cols-3">
                  {Object.entries(selected.evidence_json.observedValues ?? {}).map(([key, value]) => (
                    <div key={key} className="bg-white px-3 py-3">
                      <div className="text-xs text-gray-500">{METRIC_LABELS[key] ?? key}</div>
                      <div className="mt-1 text-base font-semibold tabular-nums text-gray-900">{metricValue(key, value)}</div>
                    </div>
                  ))}
                </div>
                {selected.evidence_json.quality.issues.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {selected.evidence_json.quality.issues.map((issue) => (
                      <div key={`${issue.code}:${issue.severity}`} className="flex items-start gap-2 text-sm text-amber-800">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />{issue.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-y border-gray-200 py-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Proposed response</h3>
                <p className="text-sm font-semibold text-gray-900">{ACTION_LABELS[String(selected.proposed_action_json?.type ?? '')] ?? String(selected.proposed_action_json?.type ?? 'Review required')}</p>
                {selected.proposed_action_json?.reason && <p className="mt-1 text-sm leading-6 text-gray-600">{String(selected.proposed_action_json.reason)}</p>}
                {selected.proposed_action_json?.maximumReductionPercent != null && <p className="mt-2 text-sm text-gray-700">Maximum reduction for review: <strong>{String(selected.proposed_action_json.maximumReductionPercent)}%</strong></p>}
                <div className="mt-3 break-all font-mono text-[11px] text-gray-400">Proposal {selected.proposal_hash ?? 'No action payload'}</div>
              </div>

              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500"><History size={14} /> Review history</h3>
                {selectedEvents.length === 0 ? (
                  <p className="text-sm text-gray-500">No review transitions recorded.</p>
                ) : (
                  <div className="space-y-3 border-l border-gray-200 pl-4">
                    {selectedEvents.map((event) => (
                      <div key={event.id} className="text-sm">
                        <div className="font-medium text-gray-800">{stateLabel(event.from_state as RecommendationState)} to {event.to_state === 'rejected' ? 'Rejected' : stateLabel(event.to_state as RecommendationState)}</div>
                        <div className="text-xs text-gray-500">{dateTime(event.created_at)} · User {event.actor_id}</div>
                        {event.reason_code && <div className="mt-1 text-xs font-semibold text-gray-700">{recommendationReasonLabel(event.reason_code)}</div>}
                        {event.note && <p className="mt-1 text-gray-600">{event.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isAdmin && selected.state !== 'approved' && (
                <div className="border-t border-gray-200 pt-5">
                  {selected.state === 'pending_approval' && (
                    <div className="mb-4">
                      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Decision</div>
                      <div className="inline-flex border border-gray-300" role="group" aria-label="Review decision">
                        <button
                          type="button"
                          onClick={() => { setReviewAction('approve'); setReasonCode(''); }}
                          className={`inline-flex h-9 items-center gap-2 px-3 text-sm font-semibold ${reviewAction === 'approve' ? 'bg-emerald-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          <Check size={16} /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => { setReviewAction('reject'); setReasonCode(''); }}
                          className={`inline-flex h-9 items-center gap-2 border-l border-gray-300 px-3 text-sm font-semibold ${reviewAction === 'reject' ? 'bg-red-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          <X size={16} /> Reject
                        </button>
                      </div>
                    </div>
                  )}
                  <label className="mb-4 block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Reason</span>
                    <select
                      value={reasonCode}
                      onChange={(event) => setReasonCode(event.target.value)}
                      className="h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                    >
                      <option value="">Select a reason</option>
                      {RECOMMENDATION_REASON_OPTIONS[selected.state === 'shadow' ? 'request_approval' : reviewAction].map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500" htmlFor="recommendation-note">Review note</label>
                  <textarea
                    id="recommendation-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value.slice(0, 1000))}
                    rows={3}
                    className="w-full resize-y border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                    placeholder="Optional decision context"
                  />
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {selected.state === 'shadow' ? (
                      <button onClick={() => void transition('request_approval')} disabled={working != null || !reasonCode} className="inline-flex h-9 items-center gap-2 bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50">
                        {working === 'request_approval' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send for approval
                      </button>
                    ) : (
                      <button
                        onClick={() => void transition(reviewAction)}
                        disabled={working != null || !reasonCode}
                        className={`inline-flex h-9 items-center gap-2 px-3 text-sm font-semibold text-white disabled:opacity-50 ${reviewAction === 'approve' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-red-700 hover:bg-red-800'}`}
                      >
                        {working === reviewAction ? <Loader2 size={16} className="animate-spin" /> : reviewAction === 'approve' ? <Check size={16} /> : <X size={16} />}
                        {reviewAction === 'approve' ? 'Record approval' : 'Record rejection'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {selected.state === 'approved' && (
                <div className="flex items-start gap-3 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <ShieldCheck size={18} className="mt-0.5 shrink-0" />
                  <div><strong>Approved for planning.</strong><br />No Google or Meta account change has been executed.</div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}