import { NextResponse } from 'next/server';

import { triggerCNXeroSync, triggerPOXeroSync, triggerSOXeroSync, triggerSupplierCNXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import {
  getXeroReconciliationIssueActionContext,
  recordXeroReconciliationActionEvent,
} from '@/lib/xero/reconciliation/repository';
import { imsQuery } from '@/services/IMSMySQLService';
import { approveBill, approveCreditNote, approveInvoice } from '@/services/XeroSyncService';

const SUPPORTED_TARGETS = new Set(['purchase_order', 'sales_order', 'customer_credit_note', 'supplier_credit_note']);

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!['Admin', 'SuperAdmin'].includes(user.tier)) {
    return NextResponse.json({ error: 'Only an Admin can run Xero accounting actions.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  const issueId = Number(params.id);
  if (!Number.isSafeInteger(issueId) || issueId <= 0) {
    return NextResponse.json({ error: 'A valid issue ID is required.' }, { status: 400 });
  }
  const action = body.action === 'authorise' ? 'authorise' : body.action === 'retry' ? 'retry' : null;
  if (!action) return NextResponse.json({ error: 'Action must be retry or authorise.' }, { status: 400 });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (action === 'authorise' && !reason) {
    return NextResponse.json({ error: 'A reason is required to authorise a Xero document.' }, { status: 400 });
  }

  let context: Awaited<ReturnType<typeof getXeroReconciliationIssueActionContext>> = null;
  try {
    context = await getXeroReconciliationIssueActionContext({ businessId: databaseId!, issueId });
    if (!context || context.status !== 'open') {
      return NextResponse.json({ error: 'The open reconciliation issue was not found.' }, { status: 404 });
    }
    if (!SUPPORTED_TARGETS.has(context.targetType)) {
      return NextResponse.json({ error: 'This reconciliation target does not support accounting actions.' }, { status: 409 });
    }
    const referenceId = Number(context.referenceId);
    if (!Number.isSafeInteger(referenceId) || referenceId <= 0) {
      return NextResponse.json({ error: 'The reconciliation target has an invalid local reference.' }, { status: 409 });
    }

    if (action === 'authorise') {
      if (context.ruleKey !== 'lifecycle_state' || !context.xeroId) {
        return NextResponse.json({ error: 'Authorise is only available for a linked lifecycle-state issue.' }, { status: 409 });
      }
      const approved = context.targetType === 'purchase_order'
        ? await approveBill(databaseId!, context.xeroId, referenceId)
        : context.targetType === 'sales_order'
          ? await approveInvoice(databaseId!, context.xeroId, referenceId)
          : await approveCreditNote(
            databaseId!, context.xeroId, referenceId,
            context.targetType === 'customer_credit_note' ? 'cn_credit_note' : 'scn_credit_note',
          );
      if (!approved) throw new Error('Xero did not authorise the linked document.');
    } else if (context.targetType === 'purchase_order') {
      const rows = await imsQuery<{ status: string }>('SELECT status FROM ims_purchase_orders WHERE business_id = ? AND id = ? LIMIT 1', [databaseId, referenceId]);
      if (!rows[0]) return NextResponse.json({ error: 'Purchase order not found.' }, { status: 404 });
      await triggerPOXeroSync(databaseId!, referenceId, rows[0].status);
    } else if (context.targetType === 'sales_order') {
      const rows = await imsQuery<{ status: string }>('SELECT status FROM ims_sales_orders WHERE business_id = ? AND id = ? LIMIT 1', [databaseId, referenceId]);
      if (!rows[0]) return NextResponse.json({ error: 'Sales order not found.' }, { status: 404 });
      await triggerSOXeroSync(databaseId!, referenceId, rows[0].status);
    } else if (context.targetType === 'customer_credit_note') {
      await triggerCNXeroSync(databaseId!, referenceId);
    } else {
      await triggerSupplierCNXeroSync(databaseId!, referenceId);
    }

    await recordXeroReconciliationActionEvent({
      businessId: databaseId!, issueId, actorId: user.userId, actorName: user.name,
      action, reason, targetType: context.targetType, referenceId, xeroId: context.xeroId,
    });
    return NextResponse.json({ success: true, action });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId, source: 'xero_reconciliation', operation: `${action}_issue`,
      title: action === 'authorise' ? 'Xero document could not be authorised' : 'Xero reconciliation action could not be retried',
      error, context: context ? { targetType: context.targetType, referenceId: context.referenceId } : undefined,
      reference: { type: 'xero_reconciliation_issue', id: String(issueId) },
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The Xero accounting action failed.' }, { status: 500 });
  }
}