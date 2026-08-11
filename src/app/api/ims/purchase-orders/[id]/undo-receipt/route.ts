import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { OrderAmendmentConflict } from '@/lib/ims/orderAmendmentPlan';
import { assessPurchaseOrderUndo, OrderCorrectionConflict } from '@/lib/ims/orderCorrectionPolicy';
import { triggerPOXeroVoid } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { recordXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';
import { getXeroInvoiceEditState } from '@/services/XeroSyncService';

function normalizedRevision(value: unknown): string | null {
  const time = new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const poId = Number(params.id);

  try {
    const body = await req.json();
    const operationKey = typeof body?.operationKey === 'string' ? body.operationKey.trim() : '';
    const expectedUpdatedAt = typeof body?.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt.trim() : '';
    if (!operationKey || !expectedUpdatedAt) {
      return NextResponse.json({
        success: false,
        error: 'operationKey and expectedUpdatedAt are required.',
      }, { status: 400 });
    }

    const po = await ImsPORepo.get(poId, businessId);
    if (!po) return NextResponse.json({ success: false, error: 'Purchase order not found' }, { status: 404 });

    let xeroState = null;
    if (po.xero_bill_id) {
      try {
        xeroState = await getXeroInvoiceEditState(businessId, po.xero_bill_id);
      } catch (error) {
        await reportRuntimeIssue({
          businessId,
          source: 'ims_purchase_orders',
          operation: 'undo_receipt_xero_preflight',
          title: 'Purchase order receipt undo Xero preflight failed',
          error,
          reference: { type: 'purchase_order', id: poId },
        }).catch(() => {});
      }
    }
    const assessment = assessPurchaseOrderUndo({
      status: po.status,
      isHistorical: !!po.is_historical,
      expectedUpdatedAt: normalizedRevision(expectedUpdatedAt),
      currentUpdatedAt: normalizedRevision(po.updated_at),
      paymentCount: 0,
      completedSupplierCreditCount: 0,
      settledShortfallCount: 0,
      conflictingChildCount: 0,
      hasSufficientStock: true,
      hasCompleteValuationHistory: true,
      hasLinkedXeroBill: !!po.xero_bill_id,
      xeroBillState: xeroState,
    });
    if (!assessment.allowed) throw new OrderCorrectionConflict(assessment.blockers);

    const requestHash = createHash('sha256').update(JSON.stringify({
      action: 'undo_mistaken_receipt',
      poId,
      expectedUpdatedAt: normalizedRevision(expectedUpdatedAt),
    })).digest('hex');
    const result = await ImsPORepo.undoCompletedReceipt(poId, businessId, expectedUpdatedAt, {
      operationKey,
      requestHash,
      expectedUpdatedAt,
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });

    const updated = await ImsPORepo.get(poId, businessId);
    const variantIds = (updated?.items ?? []).map(item => item.variant_id).filter(Boolean) as string[];
    if (variantIds.length) refreshVariantCache(variantIds).catch(() => {});

    let xeroWarning: string | null = null;
    if (po.xero_bill_id) {
      try {
        xeroWarning = await triggerPOXeroVoid(businessId, poId);
      } catch (error) {
        xeroWarning = `The receipt was undone, but the linked Xero bill could not be voided automatically.`;
        await reportRuntimeIssue({
          businessId,
          source: 'ims_purchase_orders',
          operation: 'undo_receipt_xero_void',
          title: 'Purchase order receipt was undone but Xero void failed',
          error,
          reference: { type: 'purchase_order', id: poId },
        }).catch(() => {});
      }
      if (xeroWarning) {
        await reportRuntimeIssue({
          businessId,
          source: 'ims_purchase_orders',
          operation: 'undo_receipt_xero_void',
          title: 'Purchase order receipt was undone but Xero needs attention',
          error: new Error(xeroWarning),
          reference: { type: 'purchase_order', id: poId },
        }).catch(() => {});
        await recordXeroReconciliationIssue({
          businessId,
          targetType: 'purchase_order',
          referenceId: poId,
          xeroId: po.xero_bill_id,
          ruleKey: 'receipt_undo_void_failed',
          severity: 'error',
          summary: xeroWarning,
          expected: { localStatus: 'cancelled', xeroStatus: 'VOIDED_OR_DELETED' },
          actual: { localStatus: 'cancelled', xeroStatus: 'requires_attention' },
        }).catch(async error => {
          await reportRuntimeIssue({
            businessId,
            source: 'ims_purchase_orders',
            operation: 'record_undo_receipt_reconciliation',
            title: 'Purchase order undo reconciliation issue could not be recorded',
            error,
            reference: { type: 'purchase_order', id: poId },
          }).catch(() => {});
        });
      }
    }

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      ...(xeroWarning ? { xeroWarning } : {}),
    });
  } catch (error: any) {
    if (error instanceof OrderCorrectionConflict || error instanceof OrderAmendmentConflict) {
      return NextResponse.json({
        success: false,
        error: error.message,
        code: error.code,
        ...('blockers' in error ? { blockers: error.blockers } : {}),
      }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_purchase_orders',
      operation: 'undo_receipt',
      title: 'Purchase order receipt undo failed',
      error,
      reference: { type: 'purchase_order', id: poId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error?.message ?? 'Receipt undo failed' }, { status: 500 });
  }
}