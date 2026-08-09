import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { scanXeroReconciliationTargets } from '@/lib/xero/reconciliation/scanner';
import { execute, query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ReconciliationSchedule {
  business_id: string;
  next_target_id: number | string | null;
  scan_limit: number | string | null;
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let schedules: ReconciliationSchedule[];
  try {
    schedules = await query<ReconciliationSchedule>(
      `SELECT b.business_id,
              COALESCE(s.next_target_id, 0) AS next_target_id,
              COALESCE(s.scan_limit, 100) AS scan_limit
         FROM businesses b
         JOIN connections c ON BINARY c.business_id = BINARY b.business_id
         LEFT JOIN xero_reconciliation_settings s ON BINARY s.business_id = BINARY b.business_id
        WHERE b.deleted_at IS NULL
          AND c.xero_tenant_id IS NOT NULL AND c.xero_tenant_id != ''
          AND c.xero_refresh_token IS NOT NULL AND c.xero_refresh_token != ''
          AND COALESCE(s.enabled, 1) = 1
        ORDER BY COALESCE(s.last_completed_at, '1970-01-01'), b.business_id`,
      [],
    );
  } catch (error) {
    await reportRuntimeIssue({
      source: 'xero_reconciliation', operation: 'cron_load_schedules', severity: 'critical',
      title: 'Xero reconciliation cron could not load schedules', error,
    });
    return NextResponse.json({ error: 'Unable to load reconciliation schedules.' }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const schedule of schedules) {
    const businessId = schedule.business_id;
    const afterId = Math.max(0, Math.floor(Number(schedule.next_target_id) || 0));
    const limit = Math.max(1, Math.min(500, Math.floor(Number(schedule.scan_limit) || 100)));
    try {
      await execute(
        `INSERT INTO xero_reconciliation_settings (business_id, next_target_id, scan_limit, last_started_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE last_started_at = NOW()`,
        [businessId, afterId, limit],
      );
      const scan = await scanXeroReconciliationTargets({ businessId, afterId, limit });
      const nextTargetId = scan.hasMore ? (scan.nextCursor ?? afterId) : 0;
      await execute(
        `UPDATE xero_reconciliation_settings
            SET next_target_id = ?, last_completed_at = NOW(), last_error_at = NULL, last_error = NULL
          WHERE business_id = ?`,
        [nextTargetId, businessId],
      );
      results.push({ businessId, outcome: 'completed', nextTargetId, ...scan });
    } catch (error) {
      const message = safeMessage(error);
      await execute(
        `INSERT INTO xero_reconciliation_settings (business_id, next_target_id, scan_limit, last_error_at, last_error)
         VALUES (?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE last_error_at = NOW(), last_error = VALUES(last_error)`,
        [businessId, afterId, limit, message],
      ).catch(() => {});
      await reportRuntimeIssue({
        businessId, source: 'xero_reconciliation', operation: 'cron_business_scan',
        title: 'Xero reconciliation cron failed for organisation', error,
        context: { afterId, limit },
      });
      results.push({ businessId, outcome: 'error' });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}