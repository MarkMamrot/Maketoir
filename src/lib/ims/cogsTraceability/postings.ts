import 'server-only';
import { query } from '@/services/MySQLService';
import { calculateCogsForPeriod } from '@/lib/xero/cogsCalculator';
import { roundCurrency } from '@/lib/xero/cogsPeriods';
import { ReportValidationError, type ReportRequest } from './request';

export interface PostingRun {
  id: number; from: string; toExclusive: string; journalDate: string; frequency: string; kind: string;
  target: number; amount: number; status: string; xeroId: string | null; xeroStatus: string | null;
  recordedAt: string; updatedAt: string; missingCosts: number; zeroCosts: number;
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

export async function loadPostingReconciliations(businessId: string, request: ReportRequest) {
  let tableAvailable = true;
  const raw = await query<Record<string, unknown>>(`SELECT id,
      DATE_FORMAT(period_start, '%Y-%m-%d') AS \`from\`, DATE_FORMAT(period_end, '%Y-%m-%d') AS toExclusive,
      DATE_FORMAT(journal_date, '%Y-%m-%d') AS journalDate, frequency, run_kind AS kind,
      target_amount AS target, posted_delta AS amount, status, xero_id AS xeroId, xero_state AS xeroStatus,
      DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS recordedAt,
      DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
      missing_cost_movement_count AS missingCosts, zero_cost_movement_count AS zeroCosts
    FROM xero_cogs_journal_runs
    WHERE business_id = ? AND period_start < ? AND period_end > ?
    ORDER BY period_start DESC, period_end DESC, created_at DESC, id DESC LIMIT 50001`,
  [businessId, request.toExclusive, request.from]).catch((error: unknown) => {
    if ((error as { code?: string })?.code !== 'ER_NO_SUCH_TABLE') throw error;
    tableAvailable = false;
    return [];
  });
  if (raw.length > 50000) throw new ReportValidationError('More than 50,000 posting runs match. Narrow the date range; no runs have been truncated.');
  const runs = raw.map(row => ({ ...row, id: Number(row.id), target: Number(row.target), amount: Number(row.amount),
    missingCosts: Number(row.missingCosts), zeroCosts: Number(row.zeroCosts) } as PostingRun));
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
    const totals = summarisePostingRuns(members);
    const variance = roundCurrency(calculation.totalCOGS - totals.postedTotal);
    rows.push({ from: first.from, toExclusive: first.toExclusive, calculation, ...totals, variance,
      state: totals.uncertainCount ? 'Status uncertain' : calculation.blocked ? 'Cost checks blocked'
        : totals.draftCount ? 'Draft journals awaiting posting'
          : variance !== 0 ? 'Difference to review' : 'Matches recorded posted total',
      runs: members.map(run => ({ ...run, href: journalHref(run.xeroId) })),
    });
  }
  return { success: true as const, tableAvailable, from: request.from, to: request.to, page: request.page, pageSize, total: periods.size, rows,
    scope: 'Accounting periods overlapping the selected date range. Each reconciliation uses its complete stock-movement period, without sales filters.',
    statusEvidence: 'Last Xero status recorded by Solvantis, not a live verification. Open the journal in Xero to confirm its current state. Draft, voided, deleted and uncertain runs are not counted as posted.',
  };
}