import { calculateCogsForPeriod, CogsCalculation } from '@/lib/xero/cogsCalculator';
import { CogsJournalBucket, CogsPeriod, roundCurrency } from '@/lib/xero/cogsPeriods';
import { imsQuery } from '@/services/IMSMySQLService';
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
  xero_state: string | null;
}

interface RetryRunRow {
  id: number;
  period_start: string | Date;
  period_end: string | Date;
  journal_date: string | Date;
  frequency: CogsPeriod['frequency'];
  run_kind: 'original' | 'adjustment';
  target_amount: number | string;
  posted_delta: number | string;
  status: string;
  xero_id: string | null;
  xero_state: string | null;
  breakdown_json: string | CogsJournalBucket[] | null;
}

interface PostedBucketRow { posted_delta: number | string; breakdown_json: string | CogsJournalBucket[] | null }

function parseBuckets(value: PostedBucketRow['breakdown_json']): CogsJournalBucket[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(bucket => bucket && Number.isFinite(Number(bucket.amount))).map(bucket => ({
      locationId: bucket.locationId == null ? null : Number(bucket.locationId), locationName: String(bucket.locationName || 'Location not recorded'),
      channel: String(bucket.channel || 'unclassified'), amount: roundCurrency(Number(bucket.amount)),
    })) : [];
  } catch { return []; }
}

function currentBuckets(calculation: CogsCalculation, locationNames: Map<number, string>): CogsJournalBucket[] {
  const buckets = calculation.breakdown.map(bucket => ({ locationId: bucket.locationId || null,
    locationName: locationNames.get(bucket.locationId) || (bucket.locationId ? `Location ID ${bucket.locationId}` : 'Location not recorded'),
    channel: bucket.channel, amount: roundCurrency(bucket.totalCOGS) }));
  const difference = roundCurrency(calculation.totalCOGS - buckets.reduce((sum, bucket) => sum + bucket.amount, 0));
  if (difference && buckets.length) buckets[buckets.length - 1].amount = roundCurrency(buckets[buckets.length - 1].amount + difference);
  return buckets;
}

export function calculateCogsBucketDeltas(current: CogsJournalBucket[], postedRows: PostedBucketRow[]): CogsJournalBucket[] {
  const previous = new Map<string, CogsJournalBucket>();
  let snapshottedTotal = 0;
  let postedTotal = 0;
  for (const row of postedRows) {
    postedTotal = roundCurrency(postedTotal + Number(row.posted_delta));
    for (const bucket of parseBuckets(row.breakdown_json)) {
      const key = `${bucket.locationId ?? ''}:${bucket.channel}`;
      const existing = previous.get(key);
      previous.set(key, { ...bucket, amount: roundCurrency((existing?.amount ?? 0) + bucket.amount) });
      snapshottedTotal = roundCurrency(snapshottedTotal + bucket.amount);
    }
  }
  const deltas = current.map(bucket => {
    const key = `${bucket.locationId ?? ''}:${bucket.channel}`;
    const amount = roundCurrency(bucket.amount - (previous.get(key)?.amount ?? 0));
    previous.delete(key);
    return { ...bucket, amount };
  });
  for (const bucket of previous.values()) deltas.push({ ...bucket, amount: roundCurrency(-bucket.amount) });
  const legacyTotal = roundCurrency(postedTotal - snapshottedTotal);
  if (legacyTotal) deltas.push({ locationId: null, locationName: 'Prior unsplit journals', channel: 'legacy', amount: -legacyTotal });
  return deltas.filter(bucket => bucket.amount !== 0);
}

export type CogsPostResult =
  | { outcome: 'posted'; runId: number; runKind: 'original' | 'adjustment'; postedDelta: number; xeroId: string; calculation: CogsCalculation }
  | { outcome: 'blocked'; reason: 'uncosted_movements'; calculation: CogsCalculation }
  | { outcome: 'current'; postedTotal: number; calculation: CogsCalculation }
  | { outcome: 'already_claimed'; runId: number; status: string; xeroId: string | null; postedDelta: number; calculation: CogsCalculation }
  | { outcome: 'failed' | 'unknown'; runId: number; error: string; calculation: CogsCalculation };

export type CogsRetryResult =
  | { outcome: 'posted'; runId: number; xeroId: string; xeroState: string }
  | { outcome: 'changed'; runId: number; previousTarget: number; currentTarget: number; period: CogsPeriod }
  | { outcome: 'ineligible'; runId: number; reason: string }
  | { outcome: 'failed' | 'unknown'; runId: number; error: string };

export type CogsRepostResult =
  | { outcome: 'posted'; runId: number; xeroId: string; xeroState: string; postedDelta: number; calculation: CogsCalculation }
  | { outcome: 'ineligible'; runId: number; reason: string }
  | { outcome: 'failed' | 'unknown'; runId: number; error: string };

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
  return error instanceof TypeError
    || ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(details.code ?? '')
    || details.name === 'AbortError'
    || /failed \(5\d\d\)|fetch failed|network|socket/i.test(details.message);
}

function isConfirmedMissingXeroJournal(error: unknown): boolean {
  return /failed \(404\)|linked Xero COGS journal was not found/i.test(errorDetails(error).message);
}

function dateString(value: string | Date): string {
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

export async function retryCogsRun(input: { businessId: string; runId: number }): Promise<CogsRetryResult> {
  const rows = await query<RetryRunRow>(
    `SELECT id, period_start, period_end, journal_date, frequency, run_kind,
            target_amount, posted_delta, status, xero_id, xero_state, breakdown_json
       FROM xero_cogs_journal_runs
      WHERE id = ? AND business_id = ?
      LIMIT 1`,
    [input.runId, input.businessId],
  );
  const run = rows[0];
  if (!run) return { outcome: 'ineligible', runId: input.runId, reason: 'COGS run was not found.' };
  if (run.status !== 'failed' || run.xero_id || run.xero_state) {
    return { outcome: 'ineligible', runId: run.id, reason: 'Only a confirmed failed run without a Xero journal can be retried.' };
  }
  const buckets = parseBuckets(run.breakdown_json);
  if (!buckets.length) {
    return { outcome: 'ineligible', runId: run.id, reason: 'This run has no saved journal line snapshot and cannot be retried safely.' };
  }

  const periodStart = dateString(run.period_start);
  const periodEnd = dateString(run.period_end);
  const journalDate = dateString(run.journal_date);
  const period: CogsPeriod = {
    frequency: run.frequency,
    startDate: periodStart,
    endDateExclusive: periodEnd,
    journalDate,
    key: `${run.frequency}:${periodStart}:${periodEnd}`,
    label: `${periodStart} to ${journalDate}`,
  };
  const calculation = await calculateCogsForPeriod({
    businessId: input.businessId,
    startDate: period.startDate,
    endDateExclusive: period.endDateExclusive,
  });
  const previousTarget = roundCurrency(Number(run.target_amount));
  if (calculation.totalCOGS !== previousTarget) {
    return { outcome: 'changed', runId: run.id, previousTarget, currentTarget: calculation.totalCOGS, period };
  }

  try {
    const posted = await syncCogsJournal({
      businessId: input.businessId,
      runId: run.id,
      label: period.label,
      journalDate: period.journalDate,
      amount: roundCurrency(Number(run.posted_delta)),
      buckets,
      runKind: run.run_kind,
    });
    await execute(
      `UPDATE xero_cogs_journal_runs
          SET status = 'success', xero_id = ?, xero_state = ?, error_detail = NULL
        WHERE id = ? AND business_id = ? AND status = 'failed'`,
      [posted.journalId, posted.xeroState, run.id, input.businessId],
    );
    return { outcome: 'posted', runId: run.id, xeroId: posted.journalId, xeroState: posted.xeroState };
  } catch (error: unknown) {
    const outcome = isAmbiguousXeroError(error) ? 'unknown' : 'failed';
    const message = errorDetails(error).message || 'Xero COGS journal retry failed';
    await execute(
      `UPDATE xero_cogs_journal_runs SET status = ?, error_detail = ? WHERE id = ? AND business_id = ?`,
      [outcome, message, run.id, input.businessId],
    );
    return { outcome, runId: run.id, error: message };
  }
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
        AND status = 'success' AND xero_state = 'POSTED' AND xero_id IS NOT NULL`,
    [input.businessId, input.period.startDate, input.period.endDateExclusive],
  );
  const postedTotal = roundCurrency(Number(totals[0]?.posted_total ?? 0));
  const successfulRuns = Number(totals[0]?.successful_runs ?? 0);
  const postedDelta = roundCurrency(calculation.totalCOGS - postedTotal);

  if (postedDelta === 0) {
    return { outcome: 'current', postedTotal, calculation };
  }

  const runKind = successfulRuns > 0 ? 'adjustment' : 'original';
  const locationIds = [...new Set(calculation.breakdown.map(bucket => bucket.locationId).filter(id => id > 0))];
  const locations = locationIds.length ? await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_locations WHERE id IN (${locationIds.map(() => '?').join(',')})`, locationIds,
  ) : [];
  const locationNames = new Map(locations.map(location => [Number(location.id), location.name]));
  const postedRows = await query<PostedBucketRow>(
    `SELECT posted_delta, breakdown_json FROM xero_cogs_journal_runs
      WHERE business_id = ? AND period_start = ? AND period_end = ?
        AND status = 'success' AND xero_state = 'POSTED' AND xero_id IS NOT NULL
      ORDER BY id`, [input.businessId, input.period.startDate, input.period.endDateExclusive]);
  const buckets = calculateCogsBucketDeltas(currentBuckets(calculation, locationNames), postedRows);
  let runId: number;
  try {
    const claim = await execute(
      `INSERT INTO xero_cogs_journal_runs
         (business_id, period_start, period_end, journal_date, frequency, run_kind,
          target_amount, posted_delta, included_movement_count,
          missing_cost_movement_count, zero_cost_movement_count,
           excluded_movement_count, orphaned_movement_count, status, override_reason, breakdown_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
        JSON.stringify(buckets),
      ],
    );
    runId = claim.insertId;
  } catch (error: unknown) {
    if (!isDuplicateEntry(error)) throw error;
    const existing = await query<ExistingRunRow>(
      `SELECT id, status, xero_id, xero_state, posted_delta
         FROM xero_cogs_journal_runs
        WHERE business_id = ? AND period_start = ? AND period_end = ? AND target_amount = ?
        LIMIT 1`,
      [input.businessId, input.period.startDate, input.period.endDateExclusive, calculation.totalCOGS],
    );
    const run = existing[0];
    return {
      outcome: 'already_claimed',
      runId: run?.id ?? 0,
      status: run?.status === 'success' && run?.xero_state === 'POSTED' ? 'success' : run?.xero_state ? `xero_${run.xero_state.toLowerCase()}` : run?.status ?? 'unknown',
      xeroId: run?.xero_id ?? null,
      postedDelta: Number(run?.posted_delta ?? postedDelta),
      calculation,
    };
  }

  try {
    const posted = await syncCogsJournal({
      businessId: input.businessId,
      runId,
      label: input.period.label,
      journalDate: input.period.journalDate,
      amount: postedDelta,
      buckets,
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

export async function repostCogsRun(input: { businessId: string; runId: number }): Promise<CogsRepostResult> {
  const rows = await query<RetryRunRow>(
    `SELECT id, period_start, period_end, journal_date, frequency, run_kind,
            target_amount, posted_delta, status, xero_id, xero_state, breakdown_json
       FROM xero_cogs_journal_runs
      WHERE id = ? AND business_id = ?
      LIMIT 1`,
    [input.runId, input.businessId],
  );
  const run = rows[0];
  if (!run?.xero_id) return { outcome: 'ineligible', runId: input.runId, reason: 'This run has no linked Xero journal to update.' };

  const periodStart = dateString(run.period_start);
  const periodEnd = dateString(run.period_end);
  const journalDate = dateString(run.journal_date);
  const calculation = await calculateCogsForPeriod({ businessId: input.businessId, startDate: periodStart, endDateExclusive: periodEnd });
  if (calculation.blocked) {
    return { outcome: 'ineligible', runId: run.id, reason: 'Resolve missing or unexplained zero costs before updating this journal.' };
  }

  const postedTotals = await query<PostedTotalRow>(
    `SELECT COALESCE(SUM(posted_delta), 0) AS posted_total, COUNT(*) AS successful_runs
       FROM xero_cogs_journal_runs
      WHERE business_id = ? AND period_start = ? AND period_end = ? AND id <> ?
        AND status = 'success' AND xero_state = 'POSTED' AND xero_id IS NOT NULL`,
    [input.businessId, periodStart, periodEnd, run.id],
  );
  const postedDelta = roundCurrency(calculation.totalCOGS - Number(postedTotals[0]?.posted_total ?? 0));
  if (postedDelta === 0) return { outcome: 'ineligible', runId: run.id, reason: 'No COGS amount remains for this journal.' };

  const locationIds = [...new Set(calculation.breakdown.map(bucket => bucket.locationId).filter(id => id > 0))];
  const locations = locationIds.length ? await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_locations WHERE id IN (${locationIds.map(() => '?').join(',')})`, locationIds,
  ) : [];
  const locationNames = new Map(locations.map(location => [Number(location.id), location.name]));
  const postedRows = await query<PostedBucketRow>(
    `SELECT posted_delta, breakdown_json FROM xero_cogs_journal_runs
      WHERE business_id = ? AND period_start = ? AND period_end = ? AND id <> ?
        AND status = 'success' AND xero_state = 'POSTED' AND xero_id IS NOT NULL
      ORDER BY id`,
    [input.businessId, periodStart, periodEnd, run.id],
  );
  const buckets = calculateCogsBucketDeltas(currentBuckets(calculation, locationNames), postedRows);
  try {
    const journalInput = { businessId: input.businessId, runId: run.id, label: `${periodStart} to ${journalDate}`,
      journalDate, amount: postedDelta, buckets, runKind: run.run_kind };
    let replacedMissingId: string | null = null;
    let posted;
    try {
      posted = await syncCogsJournal({ ...journalInput, existingJournalId: run.xero_id });
    } catch (error: unknown) {
      if (!isConfirmedMissingXeroJournal(error)) throw error;
      replacedMissingId = run.xero_id;
      posted = await syncCogsJournal({ ...journalInput, replacementForJournalId: run.xero_id });
    }
    await execute(
      `UPDATE xero_cogs_journal_runs
          SET target_amount = ?, posted_delta = ?, included_movement_count = ?,
              missing_cost_movement_count = ?, zero_cost_movement_count = ?,
              excluded_movement_count = ?, orphaned_movement_count = ?,
              breakdown_json = ?, status = 'success', xero_id = ?, xero_state = ?, error_detail = ?
        WHERE id = ? AND business_id = ?`,
      [calculation.totalCOGS, postedDelta, calculation.includedMovementCount,
        calculation.missingCostMovementCount, calculation.zeroCostMovementCount,
        calculation.excludedHistoricalMovementCount, calculation.orphanedMovementCount,
        JSON.stringify(buckets), posted.journalId, posted.xeroState,
        replacedMissingId ? `Replacement for Xero journal ${replacedMissingId}, which Xero confirmed was missing.` : null,
        run.id, input.businessId],
    );
    if (posted.xeroState !== 'POSTED') {
      return { outcome: 'failed', runId: run.id, error: `Xero kept the journal in ${posted.xeroState || 'an unknown state'} instead of posting it.` };
    }
    await execute(
      `UPDATE xero_cogs_settings
          SET held_reason = NULL, held_period_start = NULL, held_run_id = NULL, held_at = NULL
        WHERE business_id = ? AND held_period_start = ?`,
      [input.businessId, periodStart],
    );
    return { outcome: 'posted', runId: run.id, xeroId: posted.journalId, xeroState: posted.xeroState, postedDelta, calculation };
  } catch (error: unknown) {
    const outcome = isAmbiguousXeroError(error) ? 'unknown' : 'failed';
    const message = errorDetails(error).message || 'Xero COGS journal update failed';
    await execute(
      `UPDATE xero_cogs_journal_runs SET status = ?, error_detail = ? WHERE id = ? AND business_id = ?`,
      [outcome, message, run.id, input.businessId],
    );
    return { outcome, runId: run.id, error: message };
  }
}