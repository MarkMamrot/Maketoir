import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import { fingerprintReconciliationValue } from '@/lib/xero/reconciliation/domain';
import { renderReconciliationEmail, sendReconciliationEmail } from '@/lib/xero/reconciliation/email';
import {
  claimXeroReconciliationDelivery,
  completeXeroReconciliationDelivery,
  failXeroReconciliationDelivery,
  getXeroReconciliationIssuesForEmail,
  getXeroReconciliationRecipients,
  recordXeroReconciliationEmailEvents,
} from '@/lib/xero/reconciliation/repository';

const ALLOWED_TIERS = new Set(['Admin', 'SuperAdmin', 'Advisor']);
const DELIVERY_KEY_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;
const TARGET_LABELS: Record<string, string> = {
  purchase_order: 'Purchase order', sales_order: 'Sales order',
  customer_credit_note: 'Customer credit note', supplier_credit_note: 'Supplier credit note',
};

function label(value: string): string {
  return TARGET_LABELS[value] ?? value.replace(/_/g, ' ').replace(/^./, character => character.toUpperCase());
}

export async function POST(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!ALLOWED_TIERS.has(user.tier)) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  const issueIds = Array.from(new Set(Array.isArray(body.issueIds) ? body.issueIds.map(Number) : []))
    .filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 50);
  const deliveryKey = typeof body.deliveryKey === 'string' ? body.deliveryKey.trim() : '';
  if (!issueIds.length) return NextResponse.json({ error: 'Select at least one reconciliation issue.' }, { status: 400 });
  if (!DELIVERY_KEY_PATTERN.test(deliveryKey)) return NextResponse.json({ error: 'A valid delivery key is required.' }, { status: 400 });

  let claimed = false;
  try {
    const recipients = await getXeroReconciliationRecipients(databaseId!);
    if (!recipients.length) return NextResponse.json({ error: 'Configure at least one accounts recipient before sending.' }, { status: 409 });
    const issues = await getXeroReconciliationIssuesForEmail({ businessId: databaseId!, issueIds });
    if (issues.length !== issueIds.length) {
      return NextResponse.json({ error: 'One or more selected issues are missing or no longer open.' }, { status: 409 });
    }
    const payloadFingerprint = fingerprintReconciliationValue({ issueIds: [...issueIds].sort((a, b) => a - b), recipients });
    const claim = await claimXeroReconciliationDelivery({
      businessId: databaseId!, deliveryKey, payloadFingerprint, recipients, issueIds,
      actorId: user.userId, actorName: user.name,
    });
    if (claim === 'already_sent') return NextResponse.json({ success: true, alreadySent: true });
    if (claim === 'in_progress') return NextResponse.json({ error: 'This accounts email is already being sent.' }, { status: 409 });
    claimed = true;
    const email = renderReconciliationEmail({
      businessName: user.company || 'Solvantis business', actorName: user.name,
      appUrl: process.env.APP_URL ?? 'https://solvantis.com.au',
      issues: issues.map(issue => ({
        id: issue.id, severity: issue.severity, reference: `${label(issue.targetType)} #${issue.referenceId}`,
        documentType: label(issue.targetType), discrepancy: label(issue.ruleKey), summary: issue.summary,
        amount: issue.amount, recommendedNextStep: issue.recommendedNextStep,
      })),
    });
    const providerMessageId = await sendReconciliationEmail({
      recipients, subject: email.subject, html: email.html,
      idempotencyKey: `xero-reconciliation-${databaseId}-${deliveryKey}`,
    });
    await completeXeroReconciliationDelivery({
      businessId: databaseId!, deliveryKey, providerMessageId,
    });
    claimed = false;
    try {
      await recordXeroReconciliationEmailEvents({
        businessId: databaseId!, deliveryKey, issueIds,
        actorId: user.userId, actorName: user.name, recipients,
      });
    } catch (eventError) {
      await reportRuntimeIssue({
        businessId: databaseId, source: 'xero_reconciliation', operation: 'record_email_events',
        title: 'Xero reconciliation email audit events could not be recorded', error: eventError,
        context: { issueCount: issueIds.length },
        reference: { type: 'xero_reconciliation_delivery', id: deliveryKey },
      });
    }
    return NextResponse.json({ success: true, recipientCount: recipients.length, issueCount: issues.length });
  } catch (error) {
    if (claimed) {
      await failXeroReconciliationDelivery({
        businessId: databaseId!, deliveryKey,
        error: error instanceof Error ? error.message : 'Email delivery failed.',
      }).catch(() => {});
    }
    await reportRuntimeIssue({
      businessId: databaseId, source: 'xero_reconciliation', operation: 'send_to_accounts',
      title: 'Xero reconciliation issues could not be sent to accounts', error,
      context: { issueCount: issueIds.length },
      reference: { type: 'xero_reconciliation_delivery', id: deliveryKey },
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The accounts email could not be sent.' }, { status: 500 });
  }
}