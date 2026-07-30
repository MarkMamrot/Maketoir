"use client";

import { AlertTriangle, History, Loader2, RefreshCw } from 'lucide-react';
import type { WeeklyDigestSnapshot } from '@/lib/foresight/weeklyDigest';

function money(value: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
}

function percentDelta(value: number | null): string {
  if (value == null) return 'Not comparable';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function WeeklyMarketingDigest({
  digest,
  isAdmin,
  working,
  onRefresh,
}: {
  digest: WeeklyDigestSnapshot | null;
  isAdmin: boolean;
  working: boolean;
  onRefresh: () => void;
}) {
  const missingCurrentDays = digest
    ? Math.max(0, digest.current.expectedDays - digest.current.observedDays)
    : 0;
  const blockingCurrentIssues = digest?.current.qualityIssues.filter((issue) => issue.severity === 'blocking') ?? [];
  const metrics = digest ? [
    { label: 'Paid-media spend', current: money(digest.current.paidMediaSpend), previous: money(digest.previous.paidMediaSpend), change: digest.changes.spendPercent },
    { label: 'Online revenue ex GST', current: money(digest.current.onlineRevenueExTax), previous: money(digest.previous.onlineRevenueExTax), change: digest.changes.onlineRevenuePercent },
    { label: 'MER', current: digest.current.mer?.toFixed(2) ?? 'Unavailable', previous: digest.previous.mer?.toFixed(2) ?? 'Unavailable', change: digest.changes.merPercent },
    { label: 'Contribution POAS', current: digest.current.contributionPoas?.toFixed(2) ?? 'Unavailable', previous: digest.previous.contributionPoas?.toFixed(2) ?? 'Unavailable', change: digest.changes.contributionPoasPercent },
  ] : [];

  return (
    <section className="border-b border-gray-200 bg-white px-4 py-4" aria-label="Weekly marketing performance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700"><History size={16} /> Weekly performance</h2>
            {digest && (
              <span className={`text-xs font-semibold ${digest.current.complete ? 'text-emerald-700' : 'text-amber-700'}`}>
                {digest.current.complete ? 'Complete window' : missingCurrentDays > 0 ? 'Missing observations' : 'Financial data incomplete'}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {digest
              ? `${digest.current.windowStart} to ${digest.current.windowEnd} · compared with prior seven days`
              : 'No weekly performance summary has been generated yet.'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={onRefresh}
            disabled={working}
            className="inline-flex h-9 items-center gap-2 border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {working ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh weekly
          </button>
        )}
      </div>

      {digest && (
        <div className="mt-4 space-y-4">
          {!digest.current.complete && (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <span>
                {missingCurrentDays > 0
                  ? `${missingCurrentDays} reporting day${missingCurrentDays === 1 ? '' : 's'} have no source observations. Sync marketing data, then refresh this summary.`
                  : blockingCurrentIssues.map((issue) => issue.message).join(' ')}
              </span>
              {missingCurrentDays > 0 && (
                <a href="#sync-ads" className="shrink-0 border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                  Sync marketing data
                </a>
              )}
            </div>
          )}
          <div className="grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 bg-white px-3 py-3">
                <div className="text-xs font-medium text-gray-500">{metric.label}</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-base font-semibold tabular-nums text-gray-950">{metric.current}</span>
                  <span className={`text-xs font-semibold tabular-nums ${metric.change != null && metric.change < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{percentDelta(metric.change)}</span>
                </div>
                <div className="mt-1 text-xs tabular-nums text-gray-400">Prior {metric.previous}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 text-xs leading-5 text-gray-600 lg:grid-cols-3">
            <div>
              <div className="font-bold uppercase text-gray-500">Channel context</div>
              <div className="mt-1">Google spend {money(digest.current.googleAdsSpend)} · Meta spend {money(digest.current.metaAdsSpend)}</div>
              <div>POS revenue ex GST {money(digest.current.posRevenueExTax)} · excluded from MER</div>
              <div>Platform-attributed revenue: Google {money(digest.current.platformAttributedRevenue.googleAds)} · Meta {money(digest.current.platformAttributedRevenue.metaAds)} · diagnostic only</div>
            </div>
            <div>
              <div className="font-bold uppercase text-gray-500">Operating activity</div>
              <div className="mt-1">{digest.operations.recommendationsCreated} recommendations · {digest.operations.approvals} approved · {digest.operations.rejections} rejected</div>
              <div>{digest.operations.implementations} implementations · {digest.operations.outcomes.total} measured outcomes</div>
              <div>{digest.operations.outcomes.improved} improved · {digest.operations.outcomes.worsened} worsened · {digest.operations.outcomes.unavailable} unavailable</div>
            </div>
            <div>
              <div className="font-bold uppercase text-gray-500">Klaviyo lifecycle</div>
              <div className="mt-1">{digest.klaviyo.current.activeCriticalFlows ?? 'Unavailable'} critical categories active</div>
              <div>{digest.klaviyo.current.missingCriticalFlows ?? 'Unavailable'} missing · {digest.klaviyo.current.inactiveCriticalFlows ?? 'Unavailable'} inactive</div>
              <div>Observed {digest.klaviyo.current.observedAt ?? 'no successful lifecycle evidence'}</div>
            </div>
          </div>

          {digest.notices.length > 0 && (
            <div className="space-y-2 border-t border-gray-200 pt-3">
              {digest.notices.map((notice) => (
                <div key={notice.code} className={`flex items-start gap-2 text-sm ${notice.priority === 'high' ? 'text-red-700' : notice.priority === 'medium' ? 'text-amber-800' : 'text-gray-600'}`}>
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{notice.message}</span>
                </div>
              ))}
            </div>
          )}

          {digest.contributors.length > 0 && (
            <div className="border-t border-gray-200 pt-3">
              <div className="text-xs font-bold uppercase text-gray-500">Diagnostic contributors</div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600">
                {digest.contributors.slice(0, 4).map((contributor) => (
                  <span key={`${contributor.source}:${contributor.entityType}:${contributor.entityId}`}>
                    <strong className="text-gray-800">{contributor.entityName}</strong> · {money(contributor.currentSpend)} spend · platform ROAS {contributor.currentPlatformRoas?.toFixed(2) ?? 'N/A'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}