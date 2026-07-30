"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  History,
  ListChecks,
  Loader2,
  Minus,
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
import {
  buildRecommendationImplementationPreview,
  type RecommendationImplementationPreview,
} from '@/lib/foresight/implementationPreview';
import type { DailyDigestSnapshot } from '@/lib/foresight/dailyDigest';
import type { ExecutionPreflightResult } from '@/lib/foresight/executionPreflight';
import type { MetaExecutionPreflightResult } from '@/lib/foresight/metaExecutionPreflight';
import type { MetaRollbackPreflightResult } from '@/lib/foresight/metaRollbackPreflight';
import type { RollbackPreflightResult } from '@/lib/foresight/rollbackPreflight';
import type { KlaviyoFlowCoverageEvidence, PaidMediaContributorEvidence } from '@/lib/foresight/types';
import type { WeeklyDigestSnapshot } from '@/lib/foresight/weeklyDigest';
import { buildRecommendationEvaluationSummary } from '@/lib/foresight/recommendationEvaluationSummary';
import { googleAdsCampaignUrl } from '@/lib/foresight/googleAdsLinks';
import type { ForesightMarketingStrategy } from '@/lib/foresight/marketingStrategy';
import { MarketingStrategyPanel } from './MarketingStrategyPanel';
import { WeeklyMarketingDigest } from './WeeklyMarketingDigest';

type RecommendationState = 'shadow' | 'pending_approval' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'compensated' | 'rejected';
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
    contributors?: PaidMediaContributorEvidence[];
    lifecycleFlowCoverage?: KlaviyoFlowCoverageEvidence[];
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
type RecommendationOutcome = {
  id: number;
  recommendation_id: number;
  decision: 'approved' | 'rejected';
  horizon_days: number;
  followup_start: string;
  followup_end: string;
  direction: 'improved' | 'unchanged' | 'worsened';
  condition_state: 'resolved' | 'persisted';
  primary_metric: string | null;
  baseline_value: number | string | null;
  followup_value: number | string | null;
  assessment_json: { explanation: string };
};
type RecommendationImplementation = {
  id: number;
  recommendation_id: number;
  proposal_hash: string;
  method: 'manual_external';
  implemented_on: string;
  implemented_by: number;
  note: string;
  preview_json: RecommendationImplementationPreview;
  created_at: string;
};
type GoogleExecutionChange = {
  campaignId: string;
  campaignName: string;
  budgetId: string;
  currencyCode: string;
  currentAmountMicros: number;
  proposedAmountMicros: number;
  direction?: 'increase' | 'reduction';
  changePercent?: number;
  reductionPercent: number;
};
type MetaExecutionChange = {
  entityType: 'campaign' | 'adset';
  entityId: string;
  entityName: string;
  campaignId: string;
  currencyCode: string;
  currentDailyBudgetMinor: number;
  proposedDailyBudgetMinor: number;
  reductionPercent: number;
};
type RecommendationExecution = {
  id: number;
  recommendation_id: number;
  state: 'in_progress' | 'succeeded' | 'failed';
  before_json: Record<string, unknown>;
  request_json: { platform?: 'google_ads' | 'meta_ads'; changes?: Array<GoogleExecutionChange | MetaExecutionChange> };
  response_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  error_text: string | null;
  compensates_execution_id: number | null;
  created_at: string;
  completed_at: string | null;
  completion_date?: string | null;
};
type DigestRow = {
  id: number;
  digest_date: string;
  snapshot_json: DailyDigestSnapshot;
  generated_at: string;
};
type WeeklyDigestRow = Omit<DigestRow, 'snapshot_json'> & { snapshot_json: WeeklyDigestSnapshot };
type InboxResponse = {
  success?: boolean;
  recommendations?: Recommendation[];
  events?: RecommendationEvent[];
  outcomes?: RecommendationOutcome[];
  implementations?: RecommendationImplementation[];
  executions?: RecommendationExecution[];
  businessToday?: string;
  paidMediaPolicy?: ForesightMarketingStrategy['paidMedia'];
  error?: string;
};
type Filter = 'all' | RecommendationState;

function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function executionCustomerId(execution: RecommendationExecution | null): string | null {
  const account = execution?.before_json?.account;
  if (!account || typeof account !== 'object' || !('customerId' in account)) return null;
  return typeof account.customerId === 'string' ? account.customerId : null;
}

function isMetaExecution(execution: RecommendationExecution | null): boolean {
  return execution?.request_json.platform === 'meta_ads';
}

function CampaignLink({ customerId, campaignId, children }: {
  customerId: string | null | undefined;
  campaignId: string;
  children: React.ReactNode;
}) {
  const href = googleAdsCampaignUrl(customerId, campaignId);
  if (!href) return <span className="font-semibold text-gray-900">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open campaign in Google Ads"
      className="inline-flex items-center gap-1 font-semibold text-blue-800 underline decoration-blue-300 underline-offset-2 hover:text-blue-950"
    >
      {children}<ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

const RULE_LABELS: Record<string, string> = {
  spend_without_online_revenue: 'Spend without online revenue',
  contribution_poas_below_one: 'Contribution POAS below configured floor',
  mer_deterioration: 'MER deterioration',
  profitable_growth_opportunity: 'Profitable growth opportunity',
  ga4_channel_conversion_rate_decline: 'GA4 channel conversion-rate decline',
  klaviyo_lifecycle_coverage_gap: 'Klaviyo lifecycle coverage gap',
};
const ACTION_LABELS: Record<string, string> = {
  investigate_measurement_and_spend: 'Investigate measurement and spend',
  review_budget_reduction: 'Review a capped budget reduction',
  review_channel_and_campaign_mix: 'Review channel and campaign mix',
  review_capped_budget_increase: 'Review a capped budget increase',
  investigate_ga4_channel_funnel: 'Investigate a GA4 channel funnel',
  review_klaviyo_lifecycle_flows: 'Review lifecycle flow coverage',
};
const METRIC_LABELS: Record<string, string> = {
  spend: 'Paid-media spend',
  onlineRevenueExTax: 'Online revenue ex GST',
  contributionPoas: 'Contribution POAS',
  minimumContributionPoas: 'Configured POAS floor',
  contributionBeforeAds: 'Contribution before ads',
  currentMer: 'Current MER',
  previousMer: 'Previous MER',
  deteriorationPercent: 'Deterioration',
  merDeteriorationPercent: 'Configured deterioration boundary',
  currentContributionPoas: 'Current contribution POAS',
  previousContributionPoas: 'Previous contribution POAS',
  growthMinimumContributionPoas: 'Growth POAS floor',
  targetMer: 'Target MER',
  currentSessions: 'Current sessions',
  previousSessions: 'Previous sessions',
  currentConversions: 'Current conversions',
  previousConversions: 'Previous conversions',
  currentConversionRate: 'Current conversion rate',
  previousConversionRate: 'Previous conversion rate',
  conversionRateDeclinePercent: 'Conversion-rate decline',
  declineThresholdPercent: 'Configured decline boundary',
  flowCount: 'Klaviyo flows',
  activeFlowCount: 'Active flows',
  activeCriticalFlowCount: 'Critical flows active',
  missingCriticalFlowCount: 'Critical flows missing',
  inactiveCriticalFlowCount: 'Critical flows inactive',
};
const SIGNAL_LABELS: Record<PaidMediaContributorEvidence['signals'][number], string> = {
  new_spend: 'New spend',
  spend_increase: 'Spend increased',
  platform_roas_decline: 'Platform ROAS declined',
  spend_without_platform_revenue: 'No platform-attributed revenue',
};

function money(value: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
}

function budgetMoney(amountMicros: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currencyCode || 'AUD' }).format(amountMicros / 1_000_000);
}

function minorUnitMoney(amountMinor: number, currencyCode: string): string {
  const formatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: currencyCode || 'AUD' });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(amountMinor / (10 ** fractionDigits));
}

function metricValue(key: string, value: number | null): string {
  if (value == null) return 'Unavailable';
  if (key === 'spend' || key === 'onlineRevenueExTax' || key === 'contributionBeforeAds' || key === 'net_online_revenue_ex_tax') return money(value);
  if (key === 'deteriorationPercent' || key === 'merDeteriorationPercent') return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function dateTime(value: string | null): string {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function dateOnly(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function stateLabel(state: RecommendationState): string {
  if (state === 'pending_approval') return 'Pending approval';
  if (state === 'approved') return 'Approved';
  if (state === 'executing') return 'Executing';
  if (state === 'succeeded') return 'Executed';
  if (state === 'failed') return 'Execution failed';
  if (state === 'compensated') return 'Reversed';
  if (state === 'rejected') return 'Rejected';
  return 'Shadow';
}

function stateIcon(state: RecommendationState) {
  if (state === 'approved' || state === 'succeeded' || state === 'compensated') return <CheckCircle2 size={15} />;
  if (state === 'pending_approval' || state === 'executing') return <Clock3 size={15} />;
  if (state === 'failed') return <AlertTriangle size={15} />;
  if (state === 'rejected') return <X size={15} />;
  return <ShieldCheck size={15} />;
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 500) }; }
}

export function MarketingRecommendationsView({ userTier }: { userTier: string }) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [paidMediaPolicy, setPaidMediaPolicy] = useState<ForesightMarketingStrategy['paidMedia'] | null>(null);
  const [events, setEvents] = useState<RecommendationEvent[]>([]);
  const [outcomes, setOutcomes] = useState<RecommendationOutcome[]>([]);
  const [implementations, setImplementations] = useState<RecommendationImplementation[]>([]);
  const [executions, setExecutions] = useState<RecommendationExecution[]>([]);
  const [digests, setDigests] = useState<DigestRow[]>([]);
  const [weeklyDigests, setWeeklyDigests] = useState<WeeklyDigestRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<RecommendationTransitionAction>('approve');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [businessToday, setBusinessToday] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [implementationDate, setImplementationDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [implementationNote, setImplementationNote] = useState('');
  const [preflight, setPreflight] = useState<ExecutionPreflightResult | null>(null);
  const [metaPreflight, setMetaPreflight] = useState<MetaExecutionPreflightResult | null>(null);
  const [executionConfirmed, setExecutionConfirmed] = useState(false);
  const [metaExecutionConfirmed, setMetaExecutionConfirmed] = useState(false);
  const [rollbackPreflight, setRollbackPreflight] = useState<RollbackPreflightResult | null>(null);
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false);
  const [metaRollbackPreflight, setMetaRollbackPreflight] = useState<MetaRollbackPreflightResult | null>(null);
  const [metaRollbackConfirmed, setMetaRollbackConfirmed] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const isAdmin = userTier === 'Admin' || userTier === 'SuperAdmin';

  const load = async () => {
    setLoading(true);
    try {
      const [response, digestResponse] = await Promise.all([
        fetch('/api/foresight/marketing/recommendations', { cache: 'no-store' }),
        fetch('/api/foresight/digests', { cache: 'no-store' }),
      ]);
      const [body, digestBody] = await Promise.all([
        responseJson(response) as Promise<InboxResponse>,
        responseJson(digestResponse) as Promise<{ digests?: DigestRow[]; weeklyDigests?: WeeklyDigestRow[]; error?: string }>,
      ]);
      if (!response.ok) throw new Error(body.error || 'Unable to load recommendations.');
      if (!digestResponse.ok) throw new Error(digestBody.error || 'Unable to load the operations digest.');
      const next = body.recommendations ?? [];
      setRecommendations(next);
      setEvents(body.events ?? []);
      setOutcomes(body.outcomes ?? []);
      setImplementations(body.implementations ?? []);
      setExecutions(body.executions ?? []);
      setPaidMediaPolicy(body.paidMediaPolicy ?? null);
      setDigests(digestBody.digests ?? []);
      setWeeklyDigests(digestBody.weeklyDigests ?? []);
      if (body.businessToday) {
        setBusinessToday(body.businessToday);
        setImplementationDate(body.businessToday);
      }
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
  const selectedOutcome = outcomes.find((outcome) => outcome.recommendation_id === selectedId) ?? null;
  const selectedImplementation = implementations.find((item) => item.recommendation_id === selectedId) ?? null;
  const selectedExecutions = executions.filter((item) => item.recommendation_id === selectedId);
  const selectedExecution = selectedExecutions.find((item) => item.compensates_execution_id == null) ?? null;
  const selectedCompensation = selectedExecutions.find((item) => item.compensates_execution_id != null) ?? null;
  const latestDigest = digests[0] ?? null;
  const latestWeeklyDigest = weeklyDigests[0] ?? null;
  const evaluationSummary = buildRecommendationEvaluationSummary(
    latestWeeklyDigest?.snapshot_json ?? null,
    paidMediaPolicy?.minimumContributionPoas,
    paidMediaPolicy?.merDeteriorationPercent,
    paidMediaPolicy?.targetMer,
    paidMediaPolicy?.growthMinimumContributionPoas,
    paidMediaPolicy?.maximumBudgetIncreasePercent,
  );
  const selectedPreview = selected
    ? buildRecommendationImplementationPreview(selected.channel as Parameters<typeof buildRecommendationImplementationPreview>[0], selected.proposed_action_json)
    : null;

  useEffect(() => {
    setPreflight(null);
    setMetaPreflight(null);
    setExecutionConfirmed(false);
    setMetaExecutionConfirmed(false);
    setRollbackPreflight(null);
    setRollbackConfirmed(false);
    setMetaRollbackPreflight(null);
    setMetaRollbackConfirmed(false);
  }, [selectedId]);

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

  const refreshDigest = async () => {
    setWorking('digest');
    setMessage(null);
    try {
      const response = await fetch('/api/foresight/digests', { method: 'POST' });
      const body = await responseJson(response) as { digest?: DailyDigestSnapshot; error?: string };
      if (!response.ok || !body.digest) throw new Error(body.error || 'Unable to refresh the operations digest.');
      setMessage({ kind: 'success', text: `Daily operations digest refreshed with ${body.digest.counts.total} item${body.digest.counts.total === 1 ? '' : 's'}.` });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to refresh the operations digest.' });
    } finally {
      setWorking(null);
    }
  };

  const refreshWeeklyDigest = async () => {
    setWorking('weekly_digest');
    setMessage(null);
    try {
      const response = await fetch('/api/foresight/digests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestType: 'weekly_summary' }),
      });
      const body = await responseJson(response) as { digest?: WeeklyDigestSnapshot; error?: string };
      if (!response.ok || !body.digest) throw new Error(body.error || 'Unable to refresh the weekly performance digest.');
      setMessage({ kind: 'success', text: `Weekly performance refreshed through ${body.digest.digestDate}.` });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to refresh the weekly performance digest.' });
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

  const attestImplementation = async () => {
    if (!selected || !implementationNote.trim()) return;
    setWorking('attest_implemented');
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'attest_implemented',
          proposalHash: selected.proposal_hash,
          implementedOn: implementationDate,
          note: implementationNote,
        }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || 'Unable to record implementation.');
      setImplementationNote('');
      setMessage({ kind: 'success', text: 'External implementation recorded. Follow-up timing now starts from the implementation date.' });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to record implementation.' });
    } finally {
      setWorking(null);
    }
  };

  const runPreflight = async () => {
    if (!selected?.proposal_hash) return;
    setWorking('preflight');
    setExecutionConfirmed(false);
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalHash: selected.proposal_hash }),
      });
      const body = await responseJson(response) as { preflight?: ExecutionPreflightResult; error?: string };
      if (!response.ok || !body.preflight) throw new Error(body.error || 'Unable to run live preflight.');
      setPreflight(body.preflight);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to run live preflight.' });
    } finally {
      setWorking(null);
    }
  };

  const runMetaPreflight = async () => {
    if (!selected?.proposal_hash) return;
    setWorking('meta_preflight');
    setMetaExecutionConfirmed(false);
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/meta/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalHash: selected.proposal_hash }),
      });
      const body = await responseJson(response) as { preflight?: MetaExecutionPreflightResult; error?: string };
      if (!response.ok || !body.preflight) throw new Error(body.error || 'Unable to run Meta readiness check.');
      setMetaPreflight(body.preflight);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to run Meta readiness check.' });
    } finally {
      setWorking(null);
    }
  };

  const executeApprovedMetaChange = async () => {
    if (!selected?.proposal_hash || !metaPreflight?.confirmationFingerprint || !metaExecutionConfirmed) return;
    setWorking('meta_execute');
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/meta/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalHash: selected.proposal_hash,
          confirmationFingerprint: metaPreflight.confirmationFingerprint,
          confirmationPhrase: 'APPLY META BUDGET CHANGES',
        }),
      });
      const body = await responseJson(response) as {
        execution?: RecommendationExecution;
        idempotentReplay?: boolean;
        notification?: 'sent' | 'failed' | 'not_sent';
        notificationError?: string;
        error?: string;
      };
      if (!response.ok || !body.execution) throw new Error(body.error || 'Unable to execute Meta Ads changes.');
      setMessage({
        kind: body.execution.state === 'succeeded' ? 'success' : 'error',
        text: body.execution.state === 'succeeded'
          ? body.idempotentReplay
            ? 'Existing verified Meta execution receipt loaded.'
            : body.notification === 'sent'
              ? 'Meta Ads budgets updated, verified by live read-back, and the warning email was sent.'
              : body.notification === 'failed'
                ? `Meta Ads budgets were updated and verified, but the warning email failed: ${body.notificationError ?? 'unknown email error'}`
                : 'Meta Ads budgets updated and verified by live read-back.'
          : body.execution.error_text || 'Meta execution did not verify successfully. Review the audit receipt.',
      });
      setMetaExecutionConfirmed(false);
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to execute Meta Ads changes.' });
      setMetaExecutionConfirmed(false);
    } finally {
      setWorking(null);
    }
  };

  const executeApprovedChange = async () => {
    if (!selected?.proposal_hash || !preflight?.confirmationFingerprint || !executionConfirmed) return;
    setWorking('execute');
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalHash: selected.proposal_hash,
          confirmationFingerprint: preflight.confirmationFingerprint,
          confirmationPhrase: 'APPLY GOOGLE BUDGET CHANGES',
        }),
      });
      const body = await responseJson(response) as {
        execution?: RecommendationExecution;
        idempotentReplay?: boolean;
        notification?: 'sent' | 'failed' | 'not_sent';
        notificationError?: string;
        error?: string;
      };
      if (!response.ok || !body.execution) throw new Error(body.error || 'Unable to execute Google Ads changes.');
      setMessage({
        kind: body.execution.state === 'succeeded' ? 'success' : 'error',
        text: body.execution.state === 'succeeded'
          ? body.idempotentReplay
            ? 'Existing verified execution receipt loaded.'
            : body.notification === 'sent'
              ? 'Google Ads budgets updated, verified by live read-back, and the warning email was sent.'
              : body.notification === 'failed'
                ? `Google Ads budgets were updated and verified, but the warning email failed: ${body.notificationError ?? 'unknown email error'}`
                : 'Google Ads budgets updated and verified by live read-back.'
          : body.execution.error_text || 'Execution did not verify successfully. Review the audit receipt.',
      });
      setExecutionConfirmed(false);
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to execute Google Ads changes.' });
      setExecutionConfirmed(false);
    } finally {
      setWorking(null);
    }
  };

  const runRollbackPreflight = async () => {
    if (!selected?.proposal_hash || !selectedExecution) return;
    setWorking('rollback_preflight');
    setRollbackConfirmed(false);
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/rollback/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId: selectedExecution.id, proposalHash: selected.proposal_hash }),
      });
      const body = await responseJson(response) as { preflight?: RollbackPreflightResult; error?: string };
      if (!response.ok || !body.preflight) throw new Error(body.error || 'Unable to check rollback readiness.');
      setRollbackPreflight(body.preflight);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to check rollback readiness.' });
    } finally {
      setWorking(null);
    }
  };

  const executeRollback = async () => {
    if (
      !selected?.proposal_hash
      || !selectedExecution
      || !rollbackPreflight?.confirmationFingerprint
      || !rollbackConfirmed
    ) return;
    setWorking('rollback');
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionId: selectedExecution.id,
          proposalHash: selected.proposal_hash,
          confirmationFingerprint: rollbackPreflight.confirmationFingerprint,
          confirmationPhrase: 'REVERSE GOOGLE BUDGET CHANGES',
        }),
      });
      const body = await responseJson(response) as {
        execution?: RecommendationExecution;
        idempotentReplay?: boolean;
        error?: string;
      };
      if (!response.ok || !body.execution) throw new Error(body.error || 'Unable to reverse Google Ads changes.');
      setMessage({
        kind: body.execution.state === 'succeeded' ? 'success' : 'error',
        text: body.execution.state === 'succeeded'
          ? body.idempotentReplay ? 'Existing verified rollback receipt loaded.' : 'Original Google Ads budgets restored and verified by live read-back.'
          : body.execution.error_text || 'Rollback did not verify successfully. Review the compensation receipt.',
      });
      setRollbackConfirmed(false);
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to reverse Google Ads changes.' });
      setRollbackConfirmed(false);
    } finally {
      setWorking(null);
    }
  };

  const runMetaRollbackPreflight = async () => {
    if (!selected?.proposal_hash || !selectedExecution) return;
    setWorking('meta_rollback_preflight');
    setMetaRollbackConfirmed(false);
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/meta/rollback/preflight`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId: selectedExecution.id, proposalHash: selected.proposal_hash }),
      });
      const body = await responseJson(response) as { preflight?: MetaRollbackPreflightResult; error?: string };
      if (!response.ok || !body.preflight) throw new Error(body.error || 'Unable to check Meta rollback readiness.');
      setMetaRollbackPreflight(body.preflight);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to check Meta rollback readiness.' });
    } finally {
      setWorking(null);
    }
  };

  const executeMetaRollback = async () => {
    if (!selected?.proposal_hash || !selectedExecution || !metaRollbackPreflight?.confirmationFingerprint || !metaRollbackConfirmed) return;
    setWorking('meta_rollback');
    setMessage(null);
    try {
      const response = await fetch(`/api/foresight/marketing/recommendations/${selected.id}/meta/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionId: selectedExecution.id, proposalHash: selected.proposal_hash,
          confirmationFingerprint: metaRollbackPreflight.confirmationFingerprint,
          confirmationPhrase: 'REVERSE META BUDGET CHANGES',
        }),
      });
      const body = await responseJson(response) as { execution?: RecommendationExecution; idempotentReplay?: boolean; error?: string };
      if (!response.ok || !body.execution) throw new Error(body.error || 'Unable to reverse Meta Ads changes.');
      setMessage({
        kind: body.execution.state === 'succeeded' ? 'success' : 'error',
        text: body.execution.state === 'succeeded'
          ? body.idempotentReplay ? 'Existing verified Meta rollback receipt loaded.' : 'Original Meta Ads budgets restored and verified by live read-back.'
          : body.execution.error_text || 'Meta rollback did not verify successfully. Review the compensation receipt.',
      });
      setMetaRollbackConfirmed(false);
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to reverse Meta Ads changes.' });
      setMetaRollbackConfirmed(false);
    } finally {
      setWorking(null);
    }
  };

  const counts = {
    all: recommendations.length,
    shadow: recommendations.filter((item) => item.state === 'shadow').length,
    pending_approval: recommendations.filter((item) => item.state === 'pending_approval').length,
    approved: recommendations.filter((item) => item.state === 'approved').length,
    executing: recommendations.filter((item) => item.state === 'executing').length,
    succeeded: recommendations.filter((item) => item.state === 'succeeded').length,
    failed: recommendations.filter((item) => item.state === 'failed').length,
    compensated: recommendations.filter((item) => item.state === 'compensated').length,
    rejected: recommendations.filter((item) => item.state === 'rejected').length,
  };

  return (
    <div className="space-y-4">
      <MarketingStrategyPanel userTier={userTier} />
      <section className="border-y border-gray-200 bg-gray-50/70 px-4 py-4" aria-label="Daily operations digest">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700"><ListChecks size={16} /> Daily operations</h2>
              {latestDigest && (
                <span className={`text-xs font-semibold ${latestDigest.snapshot_json.counts.high > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {latestDigest.snapshot_json.counts.high} high priority
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {latestDigest ? `${latestDigest.digest_date} · ${latestDigest.snapshot_json.counts.total} open signal${latestDigest.snapshot_json.counts.total === 1 ? '' : 's'}` : 'No digest has been generated yet.'}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => void refreshDigest()}
              disabled={working != null}
              className="inline-flex h-9 items-center gap-2 border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {working === 'digest' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Refresh digest
            </button>
          )}
        </div>
        {latestDigest && latestDigest.snapshot_json.items.length > 0 ? (
          <div className="mt-3 grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-2 xl:grid-cols-3">
            {latestDigest.snapshot_json.items.slice(0, 6).map((item) => (
              <button
                key={`${item.kind}:${item.recommendationId}`}
                onClick={() => { setFilter('all'); setSelectedId(item.recommendationId); }}
                className="flex min-w-0 items-start gap-3 bg-white px-3 py-3 text-left hover:bg-cyan-50"
              >
                <span className={`mt-0.5 shrink-0 ${item.priority === 'high' ? 'text-red-600' : item.priority === 'medium' ? 'text-amber-600' : 'text-cyan-700'}`}>
                  {item.priority === 'high' ? <AlertTriangle size={16} /> : item.priority === 'medium' ? <Clock3 size={16} /> : <CheckCircle2 size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{item.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-600">{item.detail}</span>
                </span>
                <ChevronRight size={15} className="mt-0.5 shrink-0 text-gray-300" />
              </button>
            ))}
          </div>
        ) : latestDigest ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} /> No operational follow-ups are due today.</div>
        ) : null}
      </section>
      <WeeklyMarketingDigest
        digest={latestWeeklyDigest?.snapshot_json ?? null}
        isAdmin={isAdmin}
        working={working === 'weekly_digest'}
        onRefresh={() => void refreshWeeklyDigest()}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Recommendation states">
          {(['all', 'shadow', 'pending_approval', 'approved', 'succeeded', 'failed', 'compensated', 'rejected'] as Filter[]).map((state) => (
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
            filter === 'all' ? (
              <div className="space-y-4 px-4 py-5">
                <div className={`border px-4 py-4 ${evaluationSummary.status === 'healthy' ? 'border-emerald-200 bg-emerald-50' : evaluationSummary.status === 'opportunity' ? 'border-cyan-200 bg-cyan-50' : evaluationSummary.status === 'attention' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-start gap-3">
                    {evaluationSummary.status === 'healthy'
                      ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" />
                      : evaluationSummary.status === 'opportunity'
                        ? <ArrowUpRight size={18} className="mt-0.5 shrink-0 text-cyan-700" />
                      : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />}
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{evaluationSummary.title}</div>
                      <p className="mt-1 text-xs leading-5 text-gray-600">{evaluationSummary.detail}</p>
                    </div>
                  </div>
                </div>
                {evaluationSummary.checks.length > 0 && (
                  <div className="divide-y divide-gray-100 border border-gray-200">
                    {evaluationSummary.checks.map((check) => (
                      <div key={check.key} className="flex items-start gap-3 px-3 py-3">
                        {check.passed ? <Check size={15} className="mt-0.5 shrink-0 text-emerald-700" /> : <X size={15} className="mt-0.5 shrink-0 text-red-600" />}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-800">{check.label}</div>
                          <div className="mt-0.5 text-xs leading-5 text-gray-500">{check.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {evaluationSummary.contributors.length > 0 && (
                  <div>
                    <div className="text-xs font-bold uppercase text-gray-500">Campaign watch</div>
                    <div className="mt-2 space-y-2">
                      {evaluationSummary.contributors.slice(0, 3).map((contributor) => (
                        <div key={`${contributor.source}:${contributor.entityType}:${contributor.entityId}`} className="border border-gray-200 px-3 py-3 text-xs">
                          <div className="font-semibold text-gray-800">{contributor.entityName}</div>
                          <div className="mt-1 text-gray-500">{money(contributor.currentSpend)} spend · platform ROAS {contributor.currentPlatformRoas?.toFixed(2) ?? 'N/A'}</div>
                          <div className="mt-1 text-gray-500">{contributor.signals.length > 0 ? contributor.signals.map((signal) => SIGNAL_LABELS[signal]).join(' · ') : 'No deterioration signal detected'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-sm text-gray-500">No recommendations in this state.</div>
            )
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
                <span className={`mt-0.5 ${item.state === 'approved' || item.state === 'succeeded' || item.state === 'compensated' ? 'text-emerald-600' : item.state === 'pending_approval' || item.state === 'executing' ? 'text-amber-600' : item.state === 'failed' || item.state === 'rejected' ? 'text-red-500' : 'text-gray-400'}`}>{stateIcon(item.state)}</span>
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
            <div className="flex h-full min-h-64 items-center justify-center px-6 text-center text-sm text-gray-500">
              {recommendations.length === 0
                ? 'No intervention requires approval. The evaluation evidence and campaign watch list are shown alongside.'
                : 'Select a recommendation to review.'}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-500">
                    <span className={selected.state === 'approved' || selected.state === 'succeeded' || selected.state === 'compensated' ? 'text-emerald-600' : selected.state === 'pending_approval' || selected.state === 'executing' ? 'text-amber-600' : selected.state === 'failed' ? 'text-red-600' : 'text-gray-500'}>{stateIcon(selected.state)}</span>
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

              {(selected.evidence_json.contributors?.length ?? 0) > 0 && (
                <div>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Likely contributors</h3>
                    <span className="text-[11px] text-gray-400">Platform attribution is diagnostic only</span>
                  </div>
                  <div className="divide-y divide-gray-200 border-y border-gray-200">
                    {selected.evidence_json.contributors?.map((contributor) => (
                      <div key={`${contributor.source}:${contributor.entityType}:${contributor.entityId}`} className="py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">{contributor.entityName}</span>
                              <span className="border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500">
                                {contributor.source === 'google_ads' ? 'Google' : 'Meta'} {contributor.entityType === 'adset' ? 'Ad set' : 'Campaign'}
                              </span>
                            </div>
                            {contributor.parentEntityName && <div className="mt-1 text-xs text-gray-500">Campaign: {contributor.parentEntityName}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular-nums text-gray-900">{money(contributor.currentSpend)}</div>
                            <div className={`text-xs tabular-nums ${contributor.spendChange > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                              {contributor.spendChange >= 0 ? '+' : ''}{money(contributor.spendChange)} vs prior
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
                          <span>Platform ROAS <strong className="tabular-nums text-gray-800">{contributor.currentPlatformRoas?.toFixed(2) ?? 'N/A'}</strong></span>
                          <span>Prior <strong className="tabular-nums text-gray-800">{contributor.previousPlatformRoas?.toFixed(2) ?? 'N/A'}</strong></span>
                          {contributor.signals.map((signal) => (
                            <span key={signal} className="bg-amber-50 px-1.5 py-1 font-medium text-amber-800">{SIGNAL_LABELS[signal]}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(selected.evidence_json.lifecycleFlowCoverage?.length ?? 0) > 0 && (
                <div>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Lifecycle flow coverage</h3>
                  <div className="divide-y divide-gray-200 border-y border-gray-200">
                    {selected.evidence_json.lifecycleFlowCoverage?.map((coverage) => (
                      <div key={coverage.category} className="flex items-start gap-3 py-3">
                        <span className={`mt-0.5 shrink-0 ${coverage.state === 'active' ? 'text-emerald-600' : coverage.state === 'inactive' ? 'text-amber-600' : 'text-red-600'}`}>
                          {coverage.state === 'active' ? <CheckCircle2 size={16} /> : coverage.state === 'inactive' ? <Clock3 size={16} /> : <AlertTriangle size={16} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-gray-900">{coverage.label}</span>
                            <span className={`text-xs font-semibold uppercase ${coverage.state === 'active' ? 'text-emerald-700' : coverage.state === 'inactive' ? 'text-amber-700' : 'text-red-700'}`}>
                              {coverage.state}
                            </span>
                          </div>
                          {coverage.matchedFlows.length > 0 && (
                            <div className="mt-1 text-xs text-gray-500">
                              {coverage.matchedFlows.map((flow) => `${flow.name} (${flow.archived ? 'archived' : flow.status || 'unknown'})`).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-y border-gray-200 py-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Proposed response</h3>
                <p className="text-sm font-semibold text-gray-900">{ACTION_LABELS[String(selected.proposed_action_json?.type ?? '')] ?? String(selected.proposed_action_json?.type ?? 'Review required')}</p>
                {typeof selected.proposed_action_json?.reason === 'string' && selected.proposed_action_json.reason.length > 0 && (
                  <p className="mt-1 text-sm leading-6 text-gray-600">{selected.proposed_action_json.reason}</p>
                )}
                {selected.proposed_action_json?.maximumReductionPercent != null && <p className="mt-2 text-sm text-gray-700">Maximum reduction for review: <strong>{String(selected.proposed_action_json.maximumReductionPercent)}%</strong></p>}
                {Array.isArray(selected.proposed_action_json?.missingCategories) && selected.proposed_action_json.missingCategories.length > 0 && (
                  <p className="mt-2 text-sm text-gray-700">Missing: <strong>{selected.proposed_action_json.missingCategories.map(String).join(', ')}</strong></p>
                )}
                {Array.isArray(selected.proposed_action_json?.inactiveCategories) && selected.proposed_action_json.inactiveCategories.length > 0 && (
                  <p className="mt-2 text-sm text-gray-700">Inactive: <strong>{selected.proposed_action_json.inactiveCategories.map(String).join(', ')}</strong></p>
                )}
                <div className="mt-3 break-all font-mono text-[11px] text-gray-400">Proposal {selected.proposal_hash ?? 'No action payload'}</div>
              </div>

              {selectedPreview && (
                <div className="border border-cyan-200 bg-cyan-50/40 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-900"><ListChecks size={15} /> Manual dry run</h3>
                      <p className="mt-2 text-sm font-semibold text-gray-900">{selectedPreview.title}</p>
                    </div>
                    <span className="border border-cyan-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase text-cyan-800">No platform writes</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-700">{selectedPreview.summary}</p>
                  <ol className="mt-3 list-none space-y-2 p-0">
                    {selectedPreview.steps.map((step, index) => (
                      <li key={step} className="flex gap-3 text-sm text-gray-700">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-cyan-300 bg-white text-[11px] font-bold text-cyan-800">{index + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 border-t border-cyan-200 pt-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-cyan-900">Guardrails</div>
                    <ul className="mt-2 list-none space-y-1 p-0 text-xs leading-5 text-gray-600">
                      {selectedPreview.guardrails.map((guardrail) => <li key={guardrail}>• {guardrail}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {isAdmin && selected.state === 'approved'
                && (selected.proposed_action_json?.type === 'review_budget_reduction'
                  || selected.proposed_action_json?.type === 'review_capped_budget_increase') && (
                <div className="border border-blue-200 bg-blue-50/40 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-900"><ShieldCheck size={15} /> Live execution preflight</h3>
                      <p className="mt-2 text-sm leading-6 text-gray-700">Reads current Google campaign status and budget, then prepares an exact guarded change. It cannot submit platform changes.</p>
                    </div>
                    <button
                      onClick={() => void runPreflight()}
                      disabled={working != null || !selected.proposal_hash}
                      className="inline-flex h-9 items-center gap-2 border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                    >
                      {working === 'preflight' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Check live readiness
                    </button>
                  </div>
                  {preflight && (
                    <div className="mt-4 border-t border-blue-200 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${preflight.ready ? 'text-emerald-700' : 'text-amber-800'}`}>
                          {preflight.ready ? 'Ready for operator review' : 'Blocked from execution'}
                        </span>
                        <span className="text-xs text-gray-500">Checked {dateTime(preflight.checkedAt)} · Preview only</span>
                      </div>
                      {preflight.changes.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {preflight.changes.map((change) => (
                            <div key={`${change.campaignId}:${change.budgetId}`} className="border border-blue-200 bg-white px-3 py-3">
                              <div className="text-sm"><CampaignLink customerId={preflight.account?.customerId} campaignId={change.campaignId}>{change.campaignName}</CampaignLink></div>
                              <div className="mt-1 text-sm text-gray-700">
                                {budgetMoney(change.currentAmountMicros, change.currencyCode)} → <strong>{budgetMoney(change.proposedAmountMicros, change.currencyCode)}</strong>
                                <span className="ml-2 text-xs text-gray-500">
                                  {change.direction === 'increase' ? '+' : '-'}{change.changePercent ?? change.reductionPercent}% · budget {change.budgetId}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {preflight.blockers.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {preflight.blockers.map((blocker, index) => (
                            <li key={`${blocker.code}:${blocker.entityId ?? index}`} className="flex gap-2 text-sm leading-5 text-amber-900">
                              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                              <span>{blocker.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {preflight.ready && preflight.confirmationFingerprint && (
                        <div className="mt-4 border-t border-blue-200 pt-4">
                          <label className="flex items-start gap-3 text-sm leading-5 text-gray-700">
                            <input
                              type="checkbox"
                              checked={executionConfirmed}
                              onChange={(event) => setExecutionConfirmed(event.target.checked)}
                              className="mt-0.5 h-4 w-4 border-gray-300 text-blue-700 focus:ring-blue-600"
                            />
                            <span>I confirm these exact live before/after budgets. Execution will recheck them and stop if anything changed.</span>
                          </label>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-gray-500">Atomic Google Ads update · verified by read-back · email alert · rollback values retained</span>
                            <button
                              onClick={() => void executeApprovedChange()}
                              disabled={working != null || !executionConfirmed}
                              className="inline-flex h-9 items-center gap-2 bg-blue-700 px-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                            >
                              {working === 'execute' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                              Apply exact Google budgets
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isAdmin && selected.state === 'approved' && selected.proposed_action_json?.type === 'review_budget_reduction'
                && selected.evidence_json.contributors?.some((item) => item.source === 'meta_ads') && (
                <div className="border border-sky-200 bg-sky-50/40 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-900"><ShieldCheck size={15} /> Meta live execution preflight</h3>
                      <p className="mt-2 text-sm leading-6 text-gray-700">Reads the live Meta account, campaign, and ad-set settings, identifies the budget owner, and prepares an exact guarded reduction for approval.</p>
                    </div>
                    <button
                      onClick={() => void runMetaPreflight()}
                      disabled={working != null || !selected.proposal_hash}
                      className="inline-flex h-9 items-center gap-2 border border-sky-300 bg-white px-3 text-sm font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-50"
                    >
                      {working === 'meta_preflight' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Check Meta readiness
                    </button>
                  </div>
                  {metaPreflight && (
                    <div className="mt-4 border-t border-sky-200 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${metaPreflight.ready ? 'text-emerald-700' : 'text-amber-800'}`}>
                          {metaPreflight.ready ? 'Ready for operator review' : 'Blocked from execution'}
                        </span>
                        <span className="text-xs text-gray-500">Checked {dateTime(metaPreflight.checkedAt)} · Preview only</span>
                      </div>
                      {metaPreflight.changes.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {metaPreflight.changes.map((change) => (
                            <div key={`${change.entityType}:${change.entityId}`} className="border border-sky-200 bg-white px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-gray-900">{change.entityName}</span>
                                <span className="text-xs font-semibold uppercase text-sky-800">{change.entityType}</span>
                              </div>
                              <div className="mt-1 text-sm text-gray-700">
                                {minorUnitMoney(change.currentDailyBudgetMinor, change.currencyCode)} → <strong>{minorUnitMoney(change.proposedDailyBudgetMinor, change.currencyCode)}</strong>
                                <span className="ml-2 text-xs text-gray-500">-{change.reductionPercent}% daily budget</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {metaPreflight.blockers.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {metaPreflight.blockers.map((blocker, index) => (
                            <li key={`${blocker.code}:${blocker.entityId ?? index}`} className="flex gap-2 text-sm leading-5 text-amber-900">
                              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                              <span>{blocker.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {metaPreflight.ready && metaPreflight.confirmationFingerprint && (
                        <div className="mt-4 border-t border-sky-200 pt-4">
                          <label className="flex items-start gap-3 text-sm leading-5 text-gray-700">
                            <input
                              type="checkbox"
                              checked={metaExecutionConfirmed}
                              onChange={(event) => setMetaExecutionConfirmed(event.target.checked)}
                              className="mt-0.5 h-4 w-4 border-gray-300 text-sky-700 focus:ring-sky-600"
                            />
                            <span>I confirm these exact live Meta before/after budgets. Execution will recheck them and stop if anything changed.</span>
                          </label>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-gray-500">Meta daily-budget update · verified by read-back · email alert · audit receipt retained</span>
                            <button
                              onClick={() => void executeApprovedMetaChange()}
                              disabled={working != null || !metaExecutionConfirmed}
                              className="inline-flex h-9 items-center gap-2 bg-sky-700 px-3 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
                            >
                              {working === 'meta_execute' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                              Apply exact Meta budgets
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedExecution && (
                <div className={`border px-4 py-4 ${selectedExecution.state === 'succeeded' ? 'border-emerald-200 bg-emerald-50' : selectedExecution.state === 'failed' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {selectedExecution.state === 'succeeded'
                        ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" />
                        : selectedExecution.state === 'failed'
                          ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" />
                          : <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-amber-700" />}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                          {isMetaExecution(selectedExecution) ? 'Meta Ads' : 'Google Ads'} execution {selectedExecution.state === 'succeeded' ? 'verified' : selectedExecution.state === 'failed' ? 'requires review' : 'in progress'}
                        </h3>
                        <p className="mt-1 text-xs text-gray-600">Execution {selectedExecution.id} · {dateTime(selectedExecution.completed_at ?? selectedExecution.created_at)}</p>
                      </div>
                    </div>
                    <span className="border border-current px-2 py-1 text-[11px] font-semibold uppercase text-gray-600">Immutable receipt</span>
                  </div>
                  {Array.isArray(selectedExecution.request_json.changes) && selectedExecution.request_json.changes.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {selectedExecution.request_json.changes.map((change) => (
                        <div key={'entityId' in change ? `${change.entityType}:${change.entityId}` : `${change.campaignId}:${change.budgetId}`} className="border border-black/10 bg-white/70 px-3 py-2 text-sm text-gray-700">
                          {'entityId' in change ? (
                            <>
                              <strong>{change.entityName}</strong>
                              <span className="ml-2">{minorUnitMoney(change.currentDailyBudgetMinor, change.currencyCode)} → {minorUnitMoney(change.proposedDailyBudgetMinor, change.currencyCode)}</span>
                              <span className="ml-2 text-xs uppercase text-gray-500">{change.entityType}</span>
                            </>
                          ) : (
                            <>
                              <CampaignLink customerId={executionCustomerId(selectedExecution)} campaignId={change.campaignId}>{change.campaignName}</CampaignLink>
                              <span className="ml-2">{budgetMoney(change.currentAmountMicros, change.currencyCode)} → {budgetMoney(change.proposedAmountMicros, change.currencyCode)}</span>
                              <span className="ml-2 text-xs text-gray-500">budget {change.budgetId}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedExecution.error_text && <p className="mt-3 text-sm leading-6 text-red-800">{selectedExecution.error_text}</p>}
                  <p className="mt-3 text-xs text-gray-600">The original live values are retained in the audit ledger. Any rollback requires a fresh live-state check and separate confirmation.</p>
                  {selectedExecution.state === 'succeeded' && selectedExecution.completion_date && !selectedOutcome && (
                    <div className="mt-3 border border-emerald-200 bg-white/70 px-3 py-3 text-sm text-emerald-950">
                      <div className="font-semibold">Seven-day monitoring active</div>
                      <div className="mt-1 text-xs leading-5 text-emerald-900">
                        Observe {dateOnly(addCalendarDays(selectedExecution.completion_date, 1))}–{dateOnly(addCalendarDays(selectedExecution.completion_date, 7))}. First outcome assessment is due {dateOnly(addCalendarDays(selectedExecution.completion_date, 8))} after complete commerce and advertising data is available.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isAdmin && selected.state === 'succeeded' && selectedExecution?.state === 'succeeded' && !isMetaExecution(selectedExecution) && !selectedCompensation && (
                <div className="border border-amber-200 bg-amber-50/50 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-900"><History size={15} /> Audited rollback</h3>
                      <p className="mt-2 text-sm leading-6 text-gray-700">Checks that live budgets still match the verified execution receipt, then prepares an exact restoration to the stored original values.</p>
                    </div>
                    <button
                      onClick={() => void runRollbackPreflight()}
                      disabled={working != null}
                      className="inline-flex h-9 items-center gap-2 border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                    >
                      {working === 'rollback_preflight' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Check rollback readiness
                    </button>
                  </div>
                  {rollbackPreflight && (
                    <div className="mt-4 border-t border-amber-200 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${rollbackPreflight.ready ? 'text-emerald-700' : 'text-amber-900'}`}>
                          {rollbackPreflight.ready ? 'Ready for restoration review' : 'Rollback blocked'}
                        </span>
                        <span className="text-xs text-gray-500">Checked {dateTime(rollbackPreflight.checkedAt)} · No write yet</span>
                      </div>
                      {rollbackPreflight.changes.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {rollbackPreflight.changes.map((change) => (
                            <div key={`${change.campaignId}:${change.budgetId}`} className="border border-amber-200 bg-white px-3 py-3">
                              <div className="text-sm"><CampaignLink customerId={rollbackPreflight.account?.customerId} campaignId={change.campaignId}>{change.campaignName}</CampaignLink></div>
                              <div className="mt-1 text-sm text-gray-700">
                                {budgetMoney(change.currentAmountMicros, change.currencyCode)} → <strong>{budgetMoney(change.proposedAmountMicros, change.currencyCode)}</strong>
                                <span className="ml-2 text-xs text-gray-500">restore budget {change.budgetId}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {rollbackPreflight.blockers.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {rollbackPreflight.blockers.map((blocker, index) => (
                            <li key={`${blocker.code}:${blocker.entityId ?? index}`} className="flex gap-2 text-sm leading-5 text-amber-900">
                              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                              <span>{blocker.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {rollbackPreflight.ready && rollbackPreflight.confirmationFingerprint && (
                        <div className="mt-4 border-t border-amber-200 pt-4">
                          <label className="flex items-start gap-3 text-sm leading-5 text-gray-700">
                            <input
                              type="checkbox"
                              checked={rollbackConfirmed}
                              onChange={(event) => setRollbackConfirmed(event.target.checked)}
                              className="mt-0.5 h-4 w-4 border-gray-300 text-amber-700 focus:ring-amber-600"
                            />
                            <span>I confirm these exact live and original budgets. Rollback will recheck them, restore once, and verify by live read-back.</span>
                          </label>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-gray-500">One audited compensation attempt · no blind retry · original receipt retained</span>
                            <button
                              onClick={() => void executeRollback()}
                              disabled={working != null || !rollbackConfirmed}
                              className="inline-flex h-9 items-center gap-2 bg-amber-700 px-3 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                            >
                              {working === 'rollback' ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
                              Restore original Google budgets
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isAdmin && selected.state === 'succeeded' && selectedExecution?.state === 'succeeded' && isMetaExecution(selectedExecution) && !selectedCompensation && (
                <div className="border border-amber-200 bg-amber-50/50 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-900"><History size={15} /> Audited Meta rollback</h3>
                      <p className="mt-2 text-sm leading-6 text-gray-700">Checks that each live Meta budget still matches the verified execution receipt, then prepares an exact restoration to its stored original value.</p>
                    </div>
                    <button onClick={() => void runMetaRollbackPreflight()} disabled={working != null} className="inline-flex h-9 items-center gap-2 border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50">
                      {working === 'meta_rollback_preflight' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Check rollback readiness
                    </button>
                  </div>
                  {metaRollbackPreflight && (
                    <div className="mt-4 border-t border-amber-200 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${metaRollbackPreflight.ready ? 'text-emerald-700' : 'text-amber-900'}`}>{metaRollbackPreflight.ready ? 'Ready for restoration review' : 'Rollback blocked'}</span>
                        <span className="text-xs text-gray-500">Checked {dateTime(metaRollbackPreflight.checkedAt)} · No write yet</span>
                      </div>
                      {metaRollbackPreflight.changes.map(change => (
                        <div key={`${change.entityType}:${change.entityId}`} className="mt-3 border border-amber-200 bg-white px-3 py-3 text-sm text-gray-700">
                          <strong>{change.entityName}</strong>
                          <span className="ml-2">{minorUnitMoney(change.currentDailyBudgetMinor, change.currencyCode)} → <strong>{minorUnitMoney(change.proposedDailyBudgetMinor, change.currencyCode)}</strong></span>
                          <span className="ml-2 text-xs uppercase text-gray-500">{change.entityType}</span>
                        </div>
                      ))}
                      {metaRollbackPreflight.blockers.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {metaRollbackPreflight.blockers.map((blocker, index) => (
                            <li key={`${blocker.code}:${blocker.entityId ?? index}`} className="flex gap-2 text-sm leading-5 text-amber-900"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{blocker.message}</span></li>
                          ))}
                        </ul>
                      )}
                      {metaRollbackPreflight.ready && metaRollbackPreflight.confirmationFingerprint && (
                        <div className="mt-4 border-t border-amber-200 pt-4">
                          <label className="flex items-start gap-3 text-sm leading-5 text-gray-700">
                            <input type="checkbox" checked={metaRollbackConfirmed} onChange={event => setMetaRollbackConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 border-gray-300 text-amber-700 focus:ring-amber-600" />
                            <span>I confirm these exact live and original Meta budgets. Rollback will recheck, restore once, and verify by live read-back.</span>
                          </label>
                          <div className="mt-3 flex justify-end">
                            <button onClick={() => void executeMetaRollback()} disabled={working != null || !metaRollbackConfirmed} className="inline-flex h-9 items-center gap-2 bg-amber-700 px-3 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50">
                              {working === 'meta_rollback' ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
                              Restore original Meta budgets
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedCompensation && (
                <div className={`border px-4 py-4 ${selectedCompensation.state === 'succeeded' ? 'border-emerald-200 bg-emerald-50' : selectedCompensation.state === 'failed' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {selectedCompensation.state === 'succeeded'
                        ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" />
                        : selectedCompensation.state === 'failed'
                          ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" />
                          : <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-amber-700" />}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                          {isMetaExecution(selectedCompensation) ? 'Meta Ads' : 'Google Ads'} rollback {selectedCompensation.state === 'succeeded' ? 'verified' : selectedCompensation.state === 'failed' ? 'requires review' : 'awaiting reconciliation'}
                        </h3>
                        <p className="mt-1 text-xs text-gray-600">Compensation {selectedCompensation.id} for execution {selectedCompensation.compensates_execution_id} · {dateTime(selectedCompensation.completed_at ?? selectedCompensation.created_at)}</p>
                      </div>
                    </div>
                    <span className="border border-current px-2 py-1 text-[11px] font-semibold uppercase text-gray-600">Immutable receipt</span>
                  </div>
                  {Array.isArray(selectedCompensation.request_json.changes) && selectedCompensation.request_json.changes.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {selectedCompensation.request_json.changes.map((change) => (
                        <div key={'entityId' in change ? `${change.entityType}:${change.entityId}` : `${change.campaignId}:${change.budgetId}`} className="border border-black/10 bg-white/70 px-3 py-2 text-sm text-gray-700">
                          {'entityId' in change ? (
                            <>
                              <strong>{change.entityName}</strong>
                              <span className="ml-2">{minorUnitMoney(change.currentDailyBudgetMinor, change.currencyCode)} → {minorUnitMoney(change.proposedDailyBudgetMinor, change.currencyCode)}</span>
                              <span className="ml-2 text-xs uppercase text-gray-500">restored {change.entityType}</span>
                            </>
                          ) : (
                            <>
                              <CampaignLink customerId={executionCustomerId(selectedCompensation) ?? executionCustomerId(selectedExecution)} campaignId={change.campaignId}>{change.campaignName}</CampaignLink>
                              <span className="ml-2">{budgetMoney(change.currentAmountMicros, change.currencyCode)} → {budgetMoney(change.proposedAmountMicros, change.currencyCode)}</span>
                              <span className="ml-2 text-xs text-gray-500">restored budget {change.budgetId}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedCompensation.error_text && <p className="mt-3 text-sm leading-6 text-red-800">{selectedCompensation.error_text}</p>}
                  <p className="mt-3 text-xs text-gray-600">This receipt is permanently linked to the original execution. Failed or uncertain rollback attempts are never replayed automatically.</p>
                </div>
              )}

              {selected.state === 'approved' && selectedImplementation && (
                <div className="border border-emerald-200 bg-emerald-50 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-emerald-900">Implemented externally on {selectedImplementation.implemented_on}</h3>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">{selectedImplementation.note}</p>
                      <p className="mt-2 text-xs text-emerald-800">Recorded by user {selectedImplementation.implemented_by}. Seven-day follow-up begins after this date.</p>
                    </div>
                  </div>
                </div>
              )}

              {isAdmin && selected.state === 'approved' && !selectedImplementation && (
                <div className="border border-gray-200 px-4 py-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Record external implementation</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">Use this only after the approved work was actually completed in Google Ads, Meta, GA4, Klaviyo, or the website. This starts the follow-up window.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
                    <label>
                      <span className="mb-2 block text-xs font-semibold text-gray-600">Implementation date</span>
                      <input
                        type="date"
                        value={implementationDate}
                        max={businessToday}
                        onChange={(event) => setImplementationDate(event.target.value)}
                        className="h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                      />
                    </label>
                    <label>
                      <span className="mb-2 block text-xs font-semibold text-gray-600">What changed</span>
                      <textarea
                        value={implementationNote}
                        onChange={(event) => setImplementationNote(event.target.value.slice(0, 1000))}
                        rows={3}
                        placeholder="Platforms, campaign/flow names, and before/after settings"
                        className="w-full resize-y border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => void attestImplementation()}
                      disabled={working != null || !implementationDate || implementationNote.trim().length < 3}
                      className="inline-flex h-9 items-center gap-2 bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {working === 'attest_implemented' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      Record implementation
                    </button>
                  </div>
                </div>
              )}

              {selectedOutcome && (
                <div className="border border-gray-200 bg-gray-50 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{selectedOutcome.horizon_days}-day follow-up</h3>
                      <p className="mt-1 text-xs text-gray-500">{selectedOutcome.followup_start} to {selectedOutcome.followup_end}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${selectedOutcome.direction === 'improved' ? 'text-emerald-700' : selectedOutcome.direction === 'worsened' ? 'text-red-700' : 'text-gray-700'}`}>
                      {selectedOutcome.direction === 'improved' ? <ArrowUpRight size={16} /> : selectedOutcome.direction === 'worsened' ? <ArrowDownRight size={16} /> : <Minus size={16} />}
                      {selectedOutcome.direction.charAt(0).toUpperCase() + selectedOutcome.direction.slice(1)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-px bg-gray-200 border border-gray-200">
                    <div className="bg-white px-3 py-3">
                      <div className="text-xs text-gray-500">Baseline</div>
                      <div className="mt-1 font-semibold tabular-nums text-gray-900">{metricValue(selectedOutcome.primary_metric ?? '', selectedOutcome.baseline_value == null ? null : Number(selectedOutcome.baseline_value))}</div>
                    </div>
                    <div className="bg-white px-3 py-3">
                      <div className="text-xs text-gray-500">Follow-up</div>
                      <div className="mt-1 font-semibold tabular-nums text-gray-900">{metricValue(selectedOutcome.primary_metric ?? '', selectedOutcome.followup_value == null ? null : Number(selectedOutcome.followup_value))}</div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-gray-700">{selectedOutcome.assessment_json.explanation}</p>
                  <p className="mt-2 text-xs text-gray-500">Observed after the {selectedOutcome.decision} decision. This does not prove the proposed action caused the result.</p>
                </div>
              )}

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

              {isAdmin && (selected.state === 'shadow' || selected.state === 'pending_approval') && (
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
                  <div>
                    <strong>Approved for planning.</strong><br />
                    {selectedImplementation
                      ? 'Implementation was recorded as completed externally; Solvantis did not execute the platform change.'
                      : selected.proposed_action_json?.type === 'review_budget_reduction'
                        || selected.proposed_action_json?.type === 'review_capped_budget_increase'
                        ? 'No implementation has been recorded. Eligible Google budget changes require a fresh live preflight and explicit confirmation above.'
                        : 'No implementation has been recorded. Complete the approved work manually in the external platform, then use Record implementation above to start the seven-day follow-up.'}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}