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
    const rows = await query<CogsSettingsRow>(
      `SELECT enabled, frequency, timezone, reliable_from, next_period_start, next_run_at, updated_at
         FROM xero_cogs_settings WHERE business_id = ? LIMIT 1`,
      [databaseId],
    );
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
      } : {
        enabled: false,
        frequency: 'monthly',
        timeZone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney',
        reliableFrom: null,
        nextPeriodStart: null,
        nextRunAt: null,
        updatedAt: null,
      },
    });
  } catch (error: unknown) {
    console.error('[xero/cogs/settings GET]', errorMessage(error));
    return NextResponse.json({ error: 'Unable to load COGS settings. Run the Xero tables migration first.' }, { status: 500 });
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

    const existingRows = await query<CogsSettingsRow>(
      `SELECT enabled, frequency, timezone, reliable_from, next_period_start, next_run_at, updated_at
         FROM xero_cogs_settings WHERE business_id = ? LIMIT 1`,
      [databaseId],
    );
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
    await execute(
      `INSERT INTO xero_cogs_settings
         (business_id, enabled, frequency, timezone, reliable_from, next_period_start, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled), frequency = VALUES(frequency),
         timezone = VALUES(timezone), reliable_from = VALUES(reliable_from),
         next_period_start = VALUES(next_period_start),
         next_run_at = NULL`,
      [databaseId, enabled ? 1 : 0, frequency, timeZone, reliableFrom, nextPeriodStart],
    );
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[xero/cogs/settings PUT]', errorMessage(error));
    return NextResponse.json({ error: 'Unable to save COGS settings.' }, { status: 500 });
  }
}