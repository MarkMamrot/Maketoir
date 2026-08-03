import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { CogsFrequency, getCogsPeriodStartingAt, getLastCompletedCogsPeriod } from '@/lib/xero/cogsPeriods';
import { execute, query } from '@/services/MySQLService';
import { postCogsPeriod, type CogsPostResult } from '@/services/XeroCogsService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const runtime = 'nodejs';

interface EnabledSetting {
  business_id: string;
  frequency: CogsFrequency;
  reliable_from: string | Date;
  next_period_start: string | Date | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function heldReason(result: CogsPostResult): string | null {
  if (result.outcome === 'blocked' || result.outcome === 'failed' || result.outcome === 'unknown') {
    return result.outcome;
  }
  if (result.outcome === 'already_claimed' && result.status !== 'success') {
    return `claimed_${result.status}`.slice(0, 32);
  }
  return null;
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let settings: EnabledSetting[];
  try {
    settings = await query<EnabledSetting>(
      `SELECT s.business_id, s.frequency, s.reliable_from, s.next_period_start
         FROM xero_cogs_settings s
         JOIN businesses b ON b.business_id = s.business_id
        WHERE s.enabled = 1
          AND s.reliable_from IS NOT NULL
          AND s.held_reason IS NULL
          AND b.deleted_at IS NULL`,
      [],
    );
  } catch (error: unknown) {
    console.error('[xero/cogs/cron] unable to load settings:', errorMessage(error));
    await reportRuntimeIssue({
      source: 'xero',
      operation: 'cogs_cron_load_settings',
      severity: 'critical',
      title: 'Xero COGS cron could not load schedules',
      error,
    });
    return NextResponse.json({ error: 'Unable to load COGS schedules.' }, { status: 500 });
  }

  const results: Array<{ businessId: string; period?: string; outcome: string }> = [];
  for (const setting of settings) {
    try {
      await runImsForBusiness(setting.business_id, async () => {
        const timeZone = await getBusinessTimeZone(setting.business_id);
        const lastCompleted = getLastCompletedCogsPeriod(setting.frequency, new Date(), timeZone);
        const reliableFrom = (setting.reliable_from instanceof Date
          ? setting.reliable_from.toISOString()
          : String(setting.reliable_from)).slice(0, 10);
        let cursor = setting.next_period_start
          ? (setting.next_period_start instanceof Date ? setting.next_period_start.toISOString() : String(setting.next_period_start)).slice(0, 10)
          : lastCompleted.startDate;

        for (let attempt = 0; attempt < 8; attempt += 1) {
          const period = getCogsPeriodStartingAt(setting.frequency, cursor);
          if (period.endDateExclusive > lastCompleted.endDateExclusive) break;

          if (period.startDate < reliableFrom) {
            results.push({ businessId: setting.business_id, period: period.key, outcome: 'before_reliable_date' });
            cursor = period.endDateExclusive;
            await execute(
              'UPDATE xero_cogs_settings SET next_period_start = ? WHERE business_id = ?',
              [cursor, setting.business_id],
            );
            continue;
          }

          const result = await postCogsPeriod({ businessId: setting.business_id, period });
          results.push({ businessId: setting.business_id, period: period.key, outcome: result.outcome });

          const canAdvance = result.outcome === 'posted'
            || result.outcome === 'current'
            || (result.outcome === 'already_claimed' && result.status === 'success');
          if (!canAdvance) {
            const reason = heldReason(result) ?? 'unexpected_outcome';
            const runId = 'runId' in result ? result.runId : null;
            await execute(
              `UPDATE xero_cogs_settings
                  SET held_reason = ?, held_period_start = ?, held_run_id = ?, held_at = NOW()
                WHERE business_id = ?`,
              [reason, period.startDate, runId, setting.business_id],
            );
            await reportRuntimeIssue({
              businessId: setting.business_id,
              source: 'xero',
              operation: 'cogs_cron_period_held',
              severity: reason === 'blocked' ? 'warning' : 'error',
              title: 'Xero COGS schedule requires attention',
              error: new Error(`COGS period held: ${reason}`),
              context: {
                frequency: setting.frequency,
                periodStart: period.startDate,
                periodEndExclusive: period.endDateExclusive,
                runId,
                includedMovementCount: result.calculation.includedMovementCount,
                missingCostMovementCount: result.calculation.missingCostMovementCount,
                zeroCostMovementCount: result.calculation.zeroCostMovementCount,
                orphanedMovementCount: result.calculation.orphanedMovementCount,
              },
              reference: { type: 'cogs_period', id: period.key },
            });
            break;
          }

          cursor = period.endDateExclusive;
          await execute(
            'UPDATE xero_cogs_settings SET next_period_start = ? WHERE business_id = ?',
            [cursor, setting.business_id],
          );
        }
      });
    } catch (error: unknown) {
      console.error(`[xero/cogs/cron] ${setting.business_id}:`, errorMessage(error));
      await reportRuntimeIssue({
        businessId: setting.business_id,
        source: 'xero',
        operation: 'cogs_cron_business',
        title: 'Xero COGS cron failed for organisation',
        error,
        context: { frequency: setting.frequency },
      });
      results.push({ businessId: setting.business_id, outcome: 'error' });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}