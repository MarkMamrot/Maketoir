import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import {
  calculateCogsForPeriod,
  validateCogsDateRange,
  type CogsBreakdown,
} from '@/lib/xero/cogsCalculator';
import {
  CogsFrequency,
  getLastCompletedCogsPeriod,
  roundCurrency,
} from '@/lib/xero/cogsPeriods';
import { execute, query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';

const FREQUENCIES = new Set<CogsFrequency>(['daily', 'weekly', 'monthly', 'quarterly']);
const CHANNELS = new Set(['pos', 'online', 'wholesale']);
const RECON_STATES = new Set(['current', 'adjustment_required', 'blocked']);

interface CogsSettingsRow {
  enabled: number;
  frequency: CogsFrequency;
  timezone: string;
  reliable_from: string | Date | null;
}

interface PostedTotalRow {
  posted_total: number | string | null;
}

interface LastRunRow {
  id: number;
  period_start: string | Date;
  period_end: string | Date;
  journal_date: string | Date;
  frequency: CogsFrequency;
  run_kind: 'original' | 'adjustment';
  target_amount: number | string;
  posted_delta: number | string;
  status: string;
  xero_id: string | null;
  xero_state: string | null;
  error_detail: string | null;
  override_reason: string | null;
  created_at: string | Date;
}

interface LocationRow {
  id: number;
  name: string;
}

function dateString(value: string | Date | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

function toIso(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function resolveReconState(input: { variance: number; blocked: boolean }): 'current' | 'adjustment_required' | 'blocked' {
  if (input.blocked) return 'blocked';
  if (input.variance === 0) return 'current';
  return 'adjustment_required';
}

async function ensureCogsTables(): Promise<void> {
  await execute(
    `CREATE TABLE IF NOT EXISTS xero_cogs_settings (
      business_id       VARCHAR(255) NOT NULL PRIMARY KEY,
      enabled           TINYINT(1)   NOT NULL DEFAULT 0,
      frequency         VARCHAR(20)  NOT NULL DEFAULT 'monthly',
      timezone          VARCHAR(100) NOT NULL DEFAULT 'Australia/Sydney',
      reliable_from     DATE         DEFAULT NULL,
      next_period_start DATE         DEFAULT NULL,
      next_run_at       DATETIME     DEFAULT NULL,
      created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cogs_due (enabled, next_run_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  await execute(
    `CREATE TABLE IF NOT EXISTS xero_cogs_journal_runs (
      id                            BIGINT AUTO_INCREMENT PRIMARY KEY,
      business_id                   VARCHAR(255) NOT NULL,
      period_start                  DATE         NOT NULL,
      period_end                    DATE         NOT NULL,
      journal_date                  DATE         NOT NULL,
      frequency                     VARCHAR(20)  NOT NULL,
      run_kind                      VARCHAR(20)  NOT NULL DEFAULT 'original',
      target_amount                 DECIMAL(14,2) NOT NULL,
      posted_delta                  DECIMAL(14,2) NOT NULL,
      included_movement_count       INT          NOT NULL DEFAULT 0,
      missing_cost_movement_count   INT          NOT NULL DEFAULT 0,
      zero_cost_movement_count      INT          NOT NULL DEFAULT 0,
      excluded_movement_count       INT          NOT NULL DEFAULT 0,
      orphaned_movement_count       INT          NOT NULL DEFAULT 0,
      status                        VARCHAR(20)  NOT NULL DEFAULT 'pending',
      xero_id                       VARCHAR(100) DEFAULT NULL,
      xero_state                    VARCHAR(20)  DEFAULT NULL,
      error_detail                  TEXT         DEFAULT NULL,
      override_reason               TEXT         DEFAULT NULL,
      created_at                    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cogs_target (business_id, period_start, period_end, target_amount),
      INDEX idx_cogs_period (business_id, period_start, period_end),
      INDEX idx_cogs_status (business_id, status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

function applyBreakdownFilters(
  rows: CogsBreakdown[],
  locationId: number | null,
  channel: string | null,
): CogsBreakdown[] {
  return rows.filter((row) => {
    if (locationId != null && row.locationId !== locationId) return false;
    if (channel && row.channel !== channel) return false;
    return true;
  });
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const url = new URL(req.url);
  const databaseId = String(url.searchParams.get('databaseId') ?? '');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  const frequencyInput = String(url.searchParams.get('frequency') ?? 'monthly') as CogsFrequency;
  const timeZone = String(url.searchParams.get('timeZone') ?? process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney');
  const startDate = String(url.searchParams.get('startDate') ?? '').trim();
  const endDateExclusive = String(url.searchParams.get('endDateExclusive') ?? '').trim();
  const channel = String(url.searchParams.get('channel') ?? '').trim();
  const locationIdRaw = String(url.searchParams.get('locationId') ?? '').trim();
  const reconciliationState = String(url.searchParams.get('reconciliationState') ?? '').trim();
  const limit = Math.max(10, Math.min(300, Number(url.searchParams.get('limit') ?? 50) || 50));

  if (!databaseId) return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });
  if (!FREQUENCIES.has(frequencyInput)) {
    return NextResponse.json({ error: 'Frequency must be daily, weekly, monthly, or quarterly.' }, { status: 400 });
  }
  if (!validTimeZone(timeZone)) {
    return NextResponse.json({ error: 'Invalid business timezone.' }, { status: 400 });
  }
  if (channel && !CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'Invalid channel filter.' }, { status: 400 });
  }
  if (reconciliationState && !RECON_STATES.has(reconciliationState)) {
    return NextResponse.json({ error: 'Invalid reconciliationState filter.' }, { status: 400 });
  }

  let locationId: number | null = null;
  if (locationIdRaw) {
    locationId = Number(locationIdRaw);
    if (!Number.isInteger(locationId) || locationId <= 0) {
      return NextResponse.json({ error: 'locationId must be a positive integer.' }, { status: 400 });
    }
  }

  try {
    await ensureCogsTables();

    const settingsRows = await query<CogsSettingsRow>(
      `SELECT enabled, frequency, timezone, reliable_from
         FROM xero_cogs_settings
        WHERE business_id = ?
        LIMIT 1`,
      [databaseId],
    );

    const saved = settingsRows[0];
    const frequency = frequencyInput || saved?.frequency || 'monthly';

    const period = (startDate && endDateExclusive)
      ? (() => {
          validateCogsDateRange(startDate, endDateExclusive);
          const journalDate = new Date(`${endDateExclusive}T00:00:00.000Z`);
          journalDate.setUTCDate(journalDate.getUTCDate() - 1);
          return {
            frequency,
            startDate,
            endDateExclusive,
            journalDate: journalDate.toISOString().slice(0, 10),
            key: `${frequency}:${startDate}:${endDateExclusive}`,
            label: `${startDate} to ${journalDate.toISOString().slice(0, 10)}`,
          };
        })()
      : getLastCompletedCogsPeriod(frequency, new Date(), timeZone);

    const calculation = await calculateCogsForPeriod({
      businessId: databaseId,
      startDate: period.startDate,
      endDateExclusive: period.endDateExclusive,
    });

    const postedRows = await query<PostedTotalRow>(
      `SELECT COALESCE(SUM(posted_delta), 0) AS posted_total
         FROM xero_cogs_journal_runs
        WHERE business_id = ?
          AND period_start = ?
          AND period_end = ?
          AND status = 'success'`,
      [databaseId, period.startDate, period.endDateExclusive],
    );

    const postedTotal = roundCurrency(Number(postedRows[0]?.posted_total ?? 0));
    const variance = roundCurrency(calculation.totalCOGS - postedTotal);
    const reconState = resolveReconState({ variance, blocked: calculation.blocked });

    const locationsById = new Map<number, string>();
    const locationIds = Array.from(new Set(calculation.breakdown.map((row) => row.locationId)));
    if (locationIds.length > 0) {
      const placeholders = locationIds.map(() => '?').join(',');
      const locationRows = await imsQuery<LocationRow>(
        `SELECT id, name FROM ims_locations WHERE id IN (${placeholders})`,
        locationIds,
      ).catch(() => [] as LocationRow[]);
      for (const row of locationRows) locationsById.set(row.id, row.name);
    }

    const filteredBreakdown = applyBreakdownFilters(calculation.breakdown, locationId, channel || null).map((row) => ({
      ...row,
      locationName: locationsById.get(row.locationId) ?? `Location ${row.locationId}`,
    }));

    const filteredTotal = roundCurrency(filteredBreakdown.reduce((sum, row) => sum + Number(row.totalCOGS || 0), 0));
    const filteredMovementCount = filteredBreakdown.reduce((sum, row) => sum + Number(row.movementCount || 0), 0);
    const filteredQuantity = filteredBreakdown.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    const recentRuns = await query<LastRunRow>(
      `SELECT id, period_start, period_end, journal_date, frequency, run_kind,
              target_amount, posted_delta, status, xero_id, xero_state,
              error_detail, override_reason, created_at
         FROM xero_cogs_journal_runs
        WHERE business_id = ?
          AND period_start = ?
          AND period_end = ?
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      [databaseId, period.startDate, period.endDateExclusive],
    );

    const lastPosted = recentRuns.find((run) => run.status === 'success') ?? null;

    const reliableFrom = dateString(saved?.reliable_from ?? null);
    const reliableCoverageWarning = Boolean(reliableFrom && period.startDate < reliableFrom);

    const stateFilterApplied = Boolean(reconciliationState);
    const stateMatchesFilter = !stateFilterApplied || reconciliationState === reconState;

    return NextResponse.json({
      success: true,
      settings: {
        enabled: Boolean(saved?.enabled ?? false),
        frequency: saved?.frequency ?? 'monthly',
        timeZone: saved?.timezone ?? (process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney'),
        reliableFrom,
      },
      period,
      reconciliation: {
        state: reconState,
        stateFilterApplied,
        stateMatchesFilter,
        calculatedTotal: calculation.totalCOGS,
        postedTotal,
        variance,
        adjustmentRequired: variance !== 0,
        blocked: calculation.blocked,
      },
      quality: {
        includedMovementCount: calculation.includedMovementCount,
        includedQuantity: calculation.includedQuantity,
        missingCostMovementCount: calculation.missingCostMovementCount,
        missingCostQuantity: calculation.missingCostQuantity,
        zeroCostMovementCount: calculation.zeroCostMovementCount,
        zeroCostQuantity: calculation.zeroCostQuantity,
        excludedHistoricalMovementCount: calculation.excludedHistoricalMovementCount,
        excludedHistoricalQuantity: calculation.excludedHistoricalQuantity,
        orphanedMovementCount: calculation.orphanedMovementCount,
        orphanedQuantity: calculation.orphanedQuantity,
      },
      coverage: {
        reliableFrom,
        warning: reliableCoverageWarning,
        warningText: reliableCoverageWarning
          ? `Selected period starts before reliable-from (${reliableFrom}).`
          : null,
      },
      filters: {
        locationId,
        channel: channel || null,
        reconciliationState: reconciliationState || null,
      },
      breakdown: stateMatchesFilter ? filteredBreakdown : [],
      filteredTotals: stateMatchesFilter
        ? {
            totalCOGS: filteredTotal,
            movementCount: filteredMovementCount,
            quantity: filteredQuantity,
          }
        : {
            totalCOGS: 0,
            movementCount: 0,
            quantity: 0,
          },
      locations: Array.from(locationsById.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      channels: ['pos', 'online', 'wholesale'],
      lastPost: lastPosted ? {
        id: lastPosted.id,
        runKind: lastPosted.run_kind,
        postedDelta: Number(lastPosted.posted_delta),
        targetAmount: Number(lastPosted.target_amount),
        status: lastPosted.status,
        xeroId: lastPosted.xero_id,
        xeroState: lastPosted.xero_state,
        syncedAt: toIso(lastPosted.created_at),
      } : null,
      runs: recentRuns.map((run) => ({
        id: run.id,
        startDate: dateString(run.period_start),
        endDateExclusive: dateString(run.period_end),
        journalDate: dateString(run.journal_date),
        frequency: run.frequency,
        runKind: run.run_kind,
        targetAmount: Number(run.target_amount),
        postedDelta: Number(run.posted_delta),
        status: run.status,
        xeroId: run.xero_id,
        xeroState: run.xero_state,
        errorDetail: run.error_detail,
        overrideReason: run.override_reason,
        createdAt: toIso(run.created_at),
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[xero/cogs/report]', message);
    return NextResponse.json({ error: message || 'Unable to load COGS report.' }, { status: 500 });
  }
}
