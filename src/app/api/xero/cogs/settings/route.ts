import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { CogsFrequency, getLastCompletedCogsPeriod } from '@/lib/xero/cogsPeriods';
import { execute, query } from '@/services/MySQLService';

const FREQUENCIES = new Set<CogsFrequency>(['daily', 'weekly', 'monthly', 'quarterly']);
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

interface CogsSettingsRow {
  enabled: number;
  frequency: CogsFrequency;
  timezone: string;
  reliable_from: string | Date | null;
  next_period_start: string | Date | null;
  next_run_at: string | Date | null;
  updated_at: string | Date;
}

type DbErrorLike = {
  code?: string;
  errno?: number;
  message?: string;
};

function isMissingTableError(error: unknown): boolean {
  const value = error as DbErrorLike;
  return value?.code === 'ER_NO_SUCH_TABLE' || value?.errno === 1146;
}

function defaultSettings() {
  return {
    enabled: false,
    frequency: 'monthly' as CogsFrequency,
    timeZone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney',
    reliableFrom: null,
    nextPeriodStart: null,
    nextRunAt: null,
    updatedAt: null,
  };
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

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function dateString(value: string | Date | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const databaseId = new URL(req.url).searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    let rows: CogsSettingsRow[] = [];
    try {
      rows = await query<CogsSettingsRow>(
        `SELECT enabled, frequency, timezone, reliable_from, next_period_start, next_run_at, updated_at
           FROM xero_cogs_settings WHERE business_id = ? LIMIT 1`,
        [databaseId],
      );
    } catch (error: unknown) {
      if (!isMissingTableError(error)) throw error;
      await ensureCogsTables();
      rows = await query<CogsSettingsRow>(
        `SELECT enabled, frequency, timezone, reliable_from, next_period_start, next_run_at, updated_at
           FROM xero_cogs_settings WHERE business_id = ? LIMIT 1`,
        [databaseId],
      );
    }

    const row = rows[0];
    return NextResponse.json({
      settings: row ? {
        enabled: Boolean(row.enabled),
        frequency: row.frequency,
        timeZone: row.timezone,
        reliableFrom: dateString(row.reliable_from),
        nextPeriodStart: dateString(row.next_period_start),
        nextRunAt: row.next_run_at,
        updatedAt: row.updated_at,
      } : defaultSettings(),
    });
  } catch (error: unknown) {
    console.error('[xero/cogs/settings GET]', errorMessage(error));
    return NextResponse.json({ settings: defaultSettings(), warning: 'COGS settings unavailable; using defaults.' });
  }
}

export async function PUT(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    const body = await req.json();
    const databaseId = String(body.databaseId ?? '');
    const frequency = String(body.frequency ?? '') as CogsFrequency;
    const timeZone = String(body.timeZone ?? '');
    const reliableFrom = body.reliableFrom == null || body.reliableFrom === '' ? null : String(body.reliableFrom);
    const enabled = body.enabled === true;

    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;
    if (!FREQUENCIES.has(frequency)) {
      return NextResponse.json({ error: 'Frequency must be daily, weekly, monthly, or quarterly.' }, { status: 400 });
    }
    if (!validTimeZone(timeZone)) {
      return NextResponse.json({ error: 'Invalid business timezone.' }, { status: 400 });
    }
    if (reliableFrom && !DATE_FORMAT.test(reliableFrom)) {
      return NextResponse.json({ error: 'Reliable-from date must use YYYY-MM-DD format.' }, { status: 400 });
    }
    if (enabled && !reliableFrom) {
      return NextResponse.json({ error: 'Set the first reliable COGS date before enabling automatic sync.' }, { status: 400 });
    }

    let existingRows: CogsSettingsRow[];
    try {
      existingRows = await query<CogsSettingsRow>(
        `SELECT enabled, frequency, timezone, reliable_from, next_period_start, next_run_at, updated_at
           FROM xero_cogs_settings WHERE business_id = ? LIMIT 1`,
        [databaseId],
      );
    } catch (error: unknown) {
      if (!isMissingTableError(error)) throw error;
      await ensureCogsTables();
      existingRows = await query<CogsSettingsRow>(
        `SELECT enabled, frequency, timezone, reliable_from, next_period_start, next_run_at, updated_at
           FROM xero_cogs_settings WHERE business_id = ? LIMIT 1`,
        [databaseId],
      );
    }
    const existing = existingRows[0];
    const scheduleChanged = !existing
      || (!existing.enabled && enabled)
      || existing.frequency !== frequency
      || existing.timezone !== timeZone
      || dateString(existing.reliable_from) !== reliableFrom;
    const nextPeriodStart = scheduleChanged
      ? getLastCompletedCogsPeriod(frequency, new Date(), timeZone).endDateExclusive
      : dateString(existing.next_period_start)
        ?? getLastCompletedCogsPeriod(frequency, new Date(), timeZone).endDateExclusive;
    const upsertSql = `INSERT INTO xero_cogs_settings
         (business_id, enabled, frequency, timezone, reliable_from, next_period_start, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled), frequency = VALUES(frequency),
         timezone = VALUES(timezone), reliable_from = VALUES(reliable_from),
         next_period_start = VALUES(next_period_start),
         next_run_at = NULL`;
    const upsertParams = [databaseId, enabled ? 1 : 0, frequency, timeZone, reliableFrom, nextPeriodStart];

    try {
      await execute(upsertSql, upsertParams);
    } catch (error: unknown) {
      if (!isMissingTableError(error)) throw error;
      await ensureCogsTables();
      await execute(upsertSql, upsertParams);
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[xero/cogs/settings PUT]', errorMessage(error));
    return NextResponse.json({ error: 'Unable to save COGS settings.' }, { status: 500 });
  }
}