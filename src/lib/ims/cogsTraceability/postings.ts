import 'server-only';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';
import { xeroApiFetch } from '@/services/XeroService';
import { calculateCogsForPeriod } from '@/lib/xero/cogsCalculator';
import { roundCurrency } from '@/lib/xero/cogsPeriods';
import type { CogsJournalBucket } from '@/lib/xero/cogsPeriods';
import { ReportValidationError, type ReportRequest } from './request';

export interface PostingRun {
  id: number; from: string; toExclusive: string; journalDate: string; frequency: string; kind: string;
  target: number; amount: number; status: string; xeroId: string | null; xeroStatus: string | null;
  recordedAt: string; updatedAt: string; missingCosts: number; zeroCosts: number;
  buckets: CogsJournalBucket[] | null;
  liveXeroStatus?: string | null; liveVerification?: 'verified' | 'unavailable' | 'not_applicable';
}

function postingBuckets(value: unknown): CogsJournalBucket[] | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return null;
    return parsed.map(bucket => ({ locationId: bucket.locationId == null ? null : Number(bucket.locationId),
      locationName: String(bucket.locationName || 'Location not recorded'), channel: String(bucket.channel || 'unclassified'),
      amount: roundCurrency(Number(bucket.amount)) })).filter(bucket => Number.isFinite(bucket.amount));
  } catch { return null; }
}

export function summarisePostingRuns(runs: PostingRun[]) {
  const posted = runs.filter(run => run.status === 'success' && run.xeroStatus === 'POSTED' && run.xeroId);
  const drafts = runs.filter(run => run.status === 'success' && run.xeroStatus === 'DRAFT' && run.xeroId);
  const uncertain = runs.filter(run => ['pending', 'unknown'].includes(run.status)
    || run.status === 'success' && (!run.xeroId || !['POSTED', 'DRAFT', 'VOIDED', 'DELETED'].includes(run.xeroStatus ?? '')));
  return {
    postedTotal: roundCurrency(posted.reduce((sum, run) => sum + run.amount, 0)),
    draftTotal: roundCurrency(drafts.reduce((sum, run) => sum + run.amount, 0)),
    postedCount: posted.length, draftCount: drafts.length, uncertainCount: uncertain.length,
    failedCount: runs.filter(run => run.status === 'failed').length,
    voidedCount: runs.filter(run => ['VOIDED', 'DELETED'].includes(run.xeroStatus ?? '')).length,
  };
}

export function journalHref(xeroId: string | null): string | null {
  return xeroId ? `https://go.xero.com/ManualJournals/View.aspx?manualJournalID=${encodeURIComponent(xeroId)}` : null;
}

export async function loadPostingReconciliations(businessId: string, request: ReportRequest, options: { verifyXero?: boolean } = {}) {
  let tableAvailable = true;
  const selectRuns = (breakdownExpression: string) => query<Record<string, unknown>>(`SELECT id,
      DATE_FORMAT(period_start, '%Y-%m-%d') AS \`from\`, DATE_FORMAT(period_end, '%Y-%m-%d') AS toExclusive,
      DATE_FORMAT(journal_date, '%Y-%m-%d') AS journalDate, frequency, run_kind AS kind,
      target_amount AS target, posted_delta AS amount, status, xero_id AS xeroId, xero_state AS xeroStatus,
      DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS recordedAt,
      DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
      missing_cost_movement_count AS missingCosts, zero_cost_movement_count AS zeroCosts, ${breakdownExpression} AS breakdownJson
    FROM xero_cogs_journal_runs
    WHERE business_id = ? AND period_start < ? AND period_end > ?
    ORDER BY period_start DESC, period_end DESC, created_at DESC, id DESC LIMIT 50001`,
  [businessId, request.toExclusive, request.from]);
  let raw: Record<string, unknown>[];
  try {
    raw = await selectRuns('breakdown_json');
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === 'ER_NO_SUCH_TABLE') { tableAvailable = false; raw = []; }
    else if (code === 'ER_BAD_FIELD_ERROR') raw = await selectRuns('NULL');
    else throw error;
  }
  if (raw.length > 50000) throw new ReportValidationError('More than 50,000 posting runs match. Narrow the date range; no runs have been truncated.');
  const runs = raw.map(row => ({ ...row, id: Number(row.id), target: Number(row.target), amount: Number(row.amount),
    missingCosts: Number(row.missingCosts), zeroCosts: Number(row.zeroCosts), buckets: postingBuckets(row.breakdownJson) } as PostingRun));
  const periods = new Map<string, PostingRun[]>();
  for (const run of runs) {
    const key = `${run.from}:${run.toExclusive}`;
    const bucket = periods.get(key) ?? [];
    bucket.push(run);
    periods.set(key, bucket);
  }
  const pageSize = Math.min(request.pageSize, 20);
  const selected = Array.from(periods.values()).slice((request.page - 1) * pageSize, request.page * pageSize);
  const rows = [];
  for (const members of selected) {
    const first = members[0];
    const calculation = await calculateCogsForPeriod({ businessId, startDate: first.from, endDateExclusive: first.toExclusive });
    const verifiedMembers = [];
    for (const run of members) {
      if (!options.verifyXero || !run.xeroId) {
        verifiedMembers.push({ ...run, liveXeroStatus: null, liveVerification: run.xeroId ? undefined : 'not_applicable' as const });
        continue;
      }
      try {
        const response = await xeroApiFetch(businessId, `/ManualJournals/${encodeURIComponent(run.xeroId)}`, { method: 'GET' });
        verifiedMembers.push({ ...run, liveXeroStatus: response.ManualJournals?.[0]?.Status ?? null, liveVerification: 'verified' as const });
      } catch {
        verifiedMembers.push({ ...run, liveXeroStatus: null, liveVerification: 'unavailable' as const });
      }
    }
    const totals = summarisePostingRuns(verifiedMembers);
    const verifiable = verifiedMembers.filter(run => run.xeroId && run.status === 'success');
    const liveVerificationComplete = options.verifyXero && verifiable.length > 0 && verifiable.every(run => run.liveVerification === 'verified');
    const livePostedTotal = liveVerificationComplete ? roundCurrency(verifiable.filter(run => run.liveXeroStatus === 'POSTED')
      .reduce((sum, run) => sum + run.amount, 0)) : null;
    const variance = roundCurrency(calculation.totalCOGS - totals.postedTotal);
    const liveVariance = livePostedTotal == null ? null : roundCurrency(calculation.totalCOGS - livePostedTotal);
    rows.push({ from: first.from, toExclusive: first.toExclusive, calculation, ...totals, variance, livePostedTotal, liveVariance,
      liveVerificationComplete, state: options.verifyXero && verifiable.some(run => run.liveVerification === 'unavailable') ? 'Live Xero verification unavailable'
        : totals.uncertainCount ? 'Status uncertain' : calculation.blocked ? 'Cost checks blocked'
          : liveVerificationComplete && verifiedMembers.some(run => run.liveXeroStatus === 'DRAFT') ? 'Draft journals awaiting posting'
            : (liveVariance ?? variance) !== 0 ? 'Difference to review' : liveVerificationComplete ? 'Matches Xero posted total' : 'Matches recorded posted total',
      runs: verifiedMembers.map(run => ({ ...run, href: journalHref(run.xeroId) })),
    });
  }
  const locationIds = [...new Set(rows.flatMap(row => row.calculation.breakdown.map(bucket => bucket.locationId)))].filter(id => id > 0);
  const locations = locationIds.length ? await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_locations WHERE id IN (${locationIds.map(() => '?').join(',')})`, locationIds,
  ) : [];
  const locationNames = new Map(locations.map(location => [Number(location.id), location.name]));
  const namedRows = rows.map(row => ({ ...row, calculation: { ...row.calculation,
    breakdown: row.calculation.breakdown.map(bucket => ({ ...bucket,
      locationName: locationNames.get(bucket.locationId) || (bucket.locationId > 0 ? `Location name unavailable (ID ${bucket.locationId})` : 'Location not recorded'),
    })),
  } }));
  return { success: true as const, tableAvailable, from: request.from, to: request.to, page: request.page, pageSize, total: periods.size, rows: namedRows,
    scope: 'Accounting periods overlapping the selected date range. Each reconciliation uses its complete stock-movement period, without sales filters.',
    statusEvidence: options.verifyXero
      ? 'Displayed journal statuses are checked directly with Xero when this tab loads. If that check is unavailable, the screen labels the fallback recorded status as unverified. Draft, voided, deleted and uncertain runs are not counted as verified posted.'
      : 'Last Xero status recorded by Solvantis; live verification was not requested. Draft, voided, deleted and uncertain runs are not counted as posted.',
  };
}