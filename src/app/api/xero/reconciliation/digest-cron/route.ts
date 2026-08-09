import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getReconciliationDigestSchedule, type ReconciliationDigestFrequency } from '@/lib/xero/reconciliation/digestSchedule';
import { fingerprintReconciliationValue } from '@/lib/xero/reconciliation/domain';
import { renderReconciliationEmail, sendReconciliationEmail } from '@/lib/xero/reconciliation/email';
import {
  claimXeroReconciliationDelivery,
  completeXeroReconciliationDelivery,
  failXeroReconciliationDelivery,
  listOpenXeroReconciliationIssuesForDigest,
  markXeroReconciliationDigestCompleted,
  recordXeroReconciliationEmailEvents,
} from '@/lib/xero/reconciliation/repository';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 300;

type DigestScheduleRow = {
  business_id: string;
  business_name: string;
  recipients_json: string | string[] | null;
  digest_frequency: ReconciliationDigestFrequency;
  digest_timezone: string;
  digest_hour: number | string;
  digest_weekly_day: number | string;
  last_digest_completed_at: Date | string | null;
};

const TARGET_LABELS: Record<string, string> = {
  purchase_order: 'Purchase order', sales_order: 'Sales order',
  customer_credit_note: 'Customer credit note', supplier_credit_note: 'Supplier credit note',
};

function label(value: string): string {
  return TARGET_LABELS[value] ?? value.replace(/_/g, ' ').replace(/^./, character => character.toUpperCase());
}

function recipientsFromJson(value: string | string[] | null): string[] {
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const now = new Date();
  let schedules: DigestScheduleRow[];
  try {
    schedules = await query<DigestScheduleRow>(
      `SELECT s.business_id, COALESCE(b.name, 'Solvantis business') AS business_name,
              s.recipients_json, s.digest_frequency, s.digest_timezone, s.digest_hour,
              s.digest_weekly_day, s.last_digest_completed_at
         FROM xero_reconciliation_settings s
         JOIN businesses b ON BINARY b.business_id = BINARY s.business_id
        WHERE b.deleted_at IS NULL AND s.digest_frequency IN ('daily', 'weekly')
        ORDER BY COALESCE(s.last_digest_completed_at, '1970-01-01'), s.business_id`,
      [],
    );
  } catch (error) {
    await reportRuntimeIssue({
      source: 'xero_reconciliation', operation: 'digest_load_schedules', severity: 'critical',
      title: 'Xero reconciliation digest could not load schedules', error,
    });
    return NextResponse.json({ error: 'Unable to load reconciliation digest schedules.' }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const schedule of schedules) {
    const businessId = schedule.business_id;
    const due = getReconciliationDigestSchedule({
      now,
      lastCompletedAt: schedule.last_digest_completed_at ? new Date(schedule.last_digest_completed_at) : null,
      timeZone: schedule.digest_timezone,
      frequency: schedule.digest_frequency,
      localHour: Number(schedule.digest_hour),
      weeklyDay: Number(schedule.digest_weekly_day),
    });
    if (!due.due || !due.periodKey) {
      results.push({ businessId, outcome: 'not_due' });
      continue;
    }

    let deliveryClaimed = false;
    const deliveryKey = `digest-${due.periodKey}`;
    try {
      const recipients = recipientsFromJson(schedule.recipients_json);
      if (!recipients.length) throw new Error('No accounts recipients are configured for this digest.');
      const issues = await listOpenXeroReconciliationIssuesForDigest(businessId);
      if (!issues.length) {
        await markXeroReconciliationDigestCompleted(businessId);
        results.push({ businessId, outcome: 'no_open_issues' });
        continue;
      }
      const issueIds = issues.map(issue => issue.id);
      const payloadFingerprint = fingerprintReconciliationValue({
        recipients,
        issues: issues.map(issue => ({ id: issue.id, mismatchFingerprint: issue.mismatchFingerprint })),
      });
      const claim = await claimXeroReconciliationDelivery({
        businessId, deliveryKey, deliveryType: 'digest', payloadFingerprint,
        recipients, issueIds, actorName: 'Scheduled digest',
      });
      if (claim === 'in_progress') {
        results.push({ businessId, outcome: 'in_progress' });
        continue;
      }
      if (claim === 'already_sent') {
        await markXeroReconciliationDigestCompleted(businessId);
        results.push({ businessId, outcome: 'already_sent' });
        continue;
      }
      deliveryClaimed = true;
      const email = renderReconciliationEmail({
        businessName: schedule.business_name, actorName: 'Scheduled digest',
        appUrl: process.env.APP_URL ?? 'https://solvantis.com.au',
        issues: issues.map(issue => ({
          id: issue.id, severity: issue.severity,
          reference: `${label(issue.targetType)} #${issue.referenceId}`,
          documentType: label(issue.targetType), discrepancy: label(issue.ruleKey),
          summary: issue.summary, amount: issue.amount, recommendedNextStep: issue.recommendedNextStep,
        })),
      });
      const providerMessageId = await sendReconciliationEmail({
        recipients, subject: email.subject, html: email.html,
        idempotencyKey: `xero-reconciliation-${businessId}-${deliveryKey}`,
      });
      await completeXeroReconciliationDelivery({ businessId, deliveryKey, providerMessageId });
      deliveryClaimed = false;
      await markXeroReconciliationDigestCompleted(businessId);
      try {
        await recordXeroReconciliationEmailEvents({
          businessId, deliveryKey, issueIds, actorName: 'Scheduled digest', recipients,
        });
      } catch (eventError) {
        await reportRuntimeIssue({
          businessId, source: 'xero_reconciliation', operation: 'record_digest_events',
          title: 'Xero reconciliation digest audit events could not be recorded', error: eventError,
          context: { issueCount: issueIds.length },
          reference: { type: 'xero_reconciliation_delivery', id: deliveryKey },
        });
      }
      results.push({ businessId, outcome: 'sent', issueCount: issues.length, recipientCount: recipients.length });
    } catch (error) {
      if (deliveryClaimed) {
        await failXeroReconciliationDelivery({
          businessId, deliveryKey,
          error: error instanceof Error ? error.message : 'Digest delivery failed.',
        }).catch(() => {});
      }
      await reportRuntimeIssue({
        businessId, source: 'xero_reconciliation', operation: 'send_digest',
        title: 'Xero reconciliation digest could not be sent', error,
        reference: { type: 'xero_reconciliation_delivery', id: deliveryKey },
      });
      results.push({ businessId, outcome: 'error' });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}