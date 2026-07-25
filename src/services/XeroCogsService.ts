import { calculateCogsForPeriod, CogsCalculation } from '@/lib/xero/cogsCalculator';
import { CogsPeriod, roundCurrency } from '@/lib/xero/cogsPeriods';
import { execute, query } from '@/services/MySQLService';
import { syncCogsJournal } from '@/services/XeroSyncService';

interface PostedTotalRow {
  posted_total: number | string | null;
  successful_runs: number | string;
}

interface ExistingRunRow {
  id: number;
  status: string;
  xero_id: string | null;
  posted_delta: number | string;
}

export type CogsPostResult =
  | { outcome: 'posted'; runId: number; runKind: 'original' | 'adjustment'; postedDelta: number; xeroId: string; calculation: CogsCalculation }
  | { outcome: 'blocked'; reason: 'uncosted_movements'; calculation: CogsCalculation }
  | { outcome: 'current'; postedTotal: number; calculation: CogsCalculation }
  | { outcome: 'already_claimed'; runId: number; status: string; xeroId: string | null; postedDelta: number; calculation: CogsCalculation }
  | { outcome: 'failed' | 'unknown'; runId: number; error: string; calculation: CogsCalculation };

function errorDetails(error: unknown): { code?: string; errno?: number; name?: string; message: string } {
  if (error instanceof Error) {
    const extended = error as Error & { code?: string; errno?: number };
    return { code: extended.code, errno: extended.errno, name: error.name, message: error.message };
  }
  if (typeof error === 'object' && error !== null) {
    const value = error as { code?: string; errno?: number; name?: string; message?: string };
    return { ...value, message: value.message ?? String(error) };
  }
  return { message: String(error) };
}

function isDuplicateEntry(error: unknown): boolean {
  const details = errorDetails(error);
  return details.code === 'ER_DUP_ENTRY' || details.errno === 1062;
}

function isAmbiguousXeroError(error: unknown): boolean {
  const details = errorDetails(error);
  return ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT'].includes(details.code ?? '')
    || details.name === 'AbortError';
}

export async function postCogsPeriod(input: {
  businessId: string;
  period: CogsPeriod;
  overrideReason?: string;
}): Promise<CogsPostResult> {
  const calculation = await calculateCogsForPeriod({
    businessId: input.businessId,
    startDate: input.period.startDate,
    endDateExclusive: input.period.endDateExclusive,
  });

  const overrideReason = input.overrideReason?.trim();
  if (calculation.blocked && !overrideReason) {
    return { outcome: 'blocked', reason: 'uncosted_movements', calculation };
  }

  const totals = await query<PostedTotalRow>(
    `SELECT COALESCE(SUM(posted_delta), 0) AS posted_total,
            COUNT(*) AS successful_runs
       FROM xero_cogs_journal_runs
      WHERE business_id = ?
        AND period_start = ?
        AND period_end = ?
        AND status = 'success'`,
    [input.businessId, input.period.startDate, input.period.endDateExclusive],
  );
  const postedTotal = roundCurrency(Number(totals[0]?.posted_total ?? 0));
  const successfulRuns = Number(totals[0]?.successful_runs ?? 0);
  const postedDelta = roundCurrency(calculation.totalCOGS - postedTotal);

  if (postedDelta === 0) {
    return { outcome: 'current', postedTotal, calculation };
  }

  const runKind = successfulRuns > 0 ? 'adjustment' : 'original';
  let runId: number;
  try {
    const claim = await execute(
      `INSERT INTO xero_cogs_journal_runs
         (business_id, period_start, period_end, journal_date, frequency, run_kind,
          target_amount, posted_delta, included_movement_count,
          missing_cost_movement_count, zero_cost_movement_count,
          excluded_movement_count, orphaned_movement_count, status, override_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        input.businessId,
        input.period.startDate,
        input.period.endDateExclusive,
        input.period.journalDate,
        input.period.frequency,
        runKind,
        calculation.totalCOGS,
        postedDelta,
        calculation.includedMovementCount,
        calculation.missingCostMovementCount,
        calculation.zeroCostMovementCount,
        calculation.excludedHistoricalMovementCount,
        calculation.orphanedMovementCount,
        overrideReason ?? null,
      ],
    );
    runId = claim.insertId;
  } catch (error: unknown) {
    if (!isDuplicateEntry(error)) throw error;
    const existing = await query<ExistingRunRow>(
      `SELECT id, status, xero_id, posted_delta
         FROM xero_cogs_journal_runs
        WHERE business_id = ? AND period_start = ? AND period_end = ? AND target_amount = ?
        LIMIT 1`,
      [input.businessId, input.period.startDate, input.period.endDateExclusive, calculation.totalCOGS],
    );
    const run = existing[0];
    return {
      outcome: 'already_claimed',
      runId: run?.id ?? 0,
      status: run?.status ?? 'unknown',
      xeroId: run?.xero_id ?? null,
      postedDelta: Number(run?.posted_delta ?? postedDelta),
      calculation,
    };
  }

  try {
    const posted = await syncCogsJournal({
      businessId: input.businessId,
      label: input.period.label,
      journalDate: input.period.journalDate,
      amount: postedDelta,
      runKind,
    });
    await execute(
      `UPDATE xero_cogs_journal_runs
          SET status = 'success', xero_id = ?, xero_state = ?, error_detail = NULL
        WHERE id = ? AND business_id = ?`,
      [posted.journalId, posted.xeroState, runId, input.businessId],
    );
    return {
      outcome: 'posted',
      runId,
      runKind,
      postedDelta,
      xeroId: posted.journalId,
      calculation,
    };
  } catch (error: unknown) {
    const outcome = isAmbiguousXeroError(error) ? 'unknown' : 'failed';
    const message = errorDetails(error).message || 'Xero COGS journal failed';
    await execute(
      `UPDATE xero_cogs_journal_runs
          SET status = ?, error_detail = ?
        WHERE id = ? AND business_id = ?`,
      [outcome, message, runId, input.businessId],
    );
    return { outcome, runId, error: message, calculation };
  }
}