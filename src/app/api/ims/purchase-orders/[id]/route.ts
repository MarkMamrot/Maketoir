import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { triggerPOXeroSync, triggerPOXeroVoid, triggerPOXeroUpdate } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getXeroInvoiceEditState } from '@/services/XeroSyncService';
import { getOrderResolutionFinancialSummaries } from '@/lib/ims/orderResolution/financialSummary';
import { assessXeroDocumentEdit, hasXeroVisibleOrderChanges, type XeroDocumentEditState } from '@/lib/xero/documentEditPolicy';
import { recordXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';
import { OrderLifecycleConflict } from '@/lib/ims/orderLifecyclePolicy';
import { OrderAmendmentConflict } from '@/lib/ims/orderAmendmentPlan';


export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsPORepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    let resolution_financials: Awaited<ReturnType<typeof getOrderResolutionFinancialSummaries>> = [];
    let resolutionFinancialsWarning: string | null = null;
    if (new URL(req.url).searchParams.get('include') === 'resolutionFinancials') {
      try {
        resolution_financials = await getOrderResolutionFinancialSummaries(businessId, 'supplier', Number(params.id));
      } catch (error) {
        resolutionFinancialsWarning = 'Shortfall financial details are temporarily unavailable. The purchase order can still be viewed and received.';
        await reportRuntimeIssue({
          businessId, source: 'ims_purchase_orders', operation: 'load_resolution_financials',
          title: 'Purchase order shortfall financial details could not be loaded', error,
          reference: { type: 'purchase_order', id: params.id },
        }).catch(() => {});
      }
    }
    return NextResponse.json({
      success: true,
      data: { ...data, resolution_financials },
      ...(resolutionFinancialsWarning ? { warning: resolutionFinancialsWarning } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, status, operationKey, expectedUpdatedAt, ...poData } = body;

    // Handle status transition
    let xeroWarning: string | null = null;
    if (status) {
      // Fetch freight treatment setting for this business
      let freightTreatment: 'expense' | 'capitalise' = 'expense';
      let landedTreatment: 'expense' | 'capitalise' = 'capitalise';
      try {
        const rows = await imsQuery<{ key: string; value: string }>(
          `SELECT \`key\`, value FROM ims_settings
           WHERE business_id = ? AND \`key\` IN ('freight_treatment', 'landed_cost_treatment')`,
          [businessId]
        );
        for (const row of rows) {
          if (row.key === 'freight_treatment' && row.value === 'capitalise') freightTreatment = 'capitalise';
          if (row.key === 'landed_cost_treatment' && row.value === 'expense') landedTreatment = 'expense';
        }
      } catch {}

      // Capture prior status before changeStatus to detect received → ordered revert
      const priorPo = await ImsPORepo.get(Number(params.id), businessId);

      await ImsPORepo.changeStatus(Number(params.id), status, freightTreatment, {
        includeLandedCosts: landedTreatment === 'capitalise',
        includeFreight: freightTreatment === 'capitalise',
      }, typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : null);

      // EVENT-DRIVEN CACHE UPDATE: update global_incoming and stock fields on PO changes
      const poDataFull = await ImsPORepo.get(Number(params.id), businessId);
      if (poDataFull && (poDataFull.items?.length ?? 0) > 0) {
        const vids = poDataFull.items!.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO:', err));
        }
      }

      // Await void for revert/cancel; fire Xero sync on confirmed/received; skip if bill already exists
      if (status === 'cancelled') {
        xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);
      } else if (status === 'draft') {
        // Revert to draft → void existing Xero bill (triggerPOXeroVoid also clears xero_bill_id)
        xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);
      } else if (status === 'confirmed') {
        if (priorPo?.status === 'complete') {
          // Reverting from received: void the AUTHORISED Xero bill, then create a new Draft
          xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);
          // xero_bill_id is now cleared — create a fresh Draft Bill
          triggerPOXeroSync(businessId, Number(params.id), 'confirmed').catch(() => {});
        } else {
          // Normal confirmed: create Draft Bill if none exists yet
          const hasExistingBill = !!(poDataFull as any)?.xero_bill_id;
          if (!hasExistingBill) {
            triggerPOXeroSync(businessId, Number(params.id), 'confirmed').catch(() => {});
          }
        }
      } else if (status === 'complete') {
        // Only fire sync on full receive via IMS list (batch API fires its own sync)
        triggerPOXeroSync(businessId, Number(params.id), status).catch(() => {});
      }
      // 'partially_received' → no Xero action (not fully received yet)

    } else {
      const existing = await ImsPORepo.get(Number(params.id), businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      const hasXeroChanges = hasXeroVisibleOrderChanges(
        'purchase_order', existing as unknown as Record<string, unknown>, poData, items,
      );
      let xeroState: XeroDocumentEditState | null = null;
      if (existing.xero_bill_id && hasXeroChanges) {
        try {
          xeroState = await getXeroInvoiceEditState(businessId, existing.xero_bill_id);
        } catch (error) {
          await reportRuntimeIssue({
            businessId, source: 'ims_purchase_orders', operation: 'xero_edit_preflight',
            title: 'Purchase order Xero edit preflight failed', error,
            reference: { type: 'purchase_order', id: params.id },
          });
        }
        const assessment = assessXeroDocumentEdit(true, xeroState);
        if (!assessment.allowed) {
          return NextResponse.json({
            success: false,
            error: `${assessment.message} Use the purchase-order correction workflow instead.`,
            code: assessment.reason,
          }, { status: 409 });
        }
      }
      const { landed_costs, ...cleanPoData } = poData;
      const amendmentKey = typeof operationKey === 'string' && operationKey.trim() ? operationKey.trim() : randomUUID();
      const requestHash = createHash('sha256').update(JSON.stringify({ poData: cleanPoData, items, landed_costs })).digest('hex');
      await ImsPORepo.update(Number(params.id), cleanPoData, items, landed_costs, {
        operationKey: amendmentKey,
        requestHash,
        expectedUpdatedAt: typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : null,
        actorId: session.userId,
        actorName: session.name ?? session.email,
      });

      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO:', err));
        }
      }

      if (existing.xero_bill_id && hasXeroChanges) {
        const result = await triggerPOXeroUpdate(businessId, Number(params.id));
        xeroWarning = result.warning;
        if (result.warning) {
          await recordXeroReconciliationIssue({
            businessId, targetType: 'purchase_order', referenceId: params.id,
            xeroId: existing.xero_bill_id, ruleKey: 'post_edit_sync_failed', severity: 'error',
            summary: result.warning, expected: { xeroUpdated: true }, actual: { xeroUpdated: false },
          });
        }
      }
    }
    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    if (e instanceof OrderAmendmentConflict) {
      return NextResponse.json({
        success: false,
        error: e.message,
        code: e.code,
      }, { status: 409 });
    }
    if (e instanceof OrderLifecycleConflict) {
      return NextResponse.json({
        success: false,
        error: e.message,
        code: e.code,
      }, { status: 409 });
    }
    const isReversalConflict = String(e?.message ?? '').startsWith('Cannot reverse PO receipt:');
    if (!isReversalConflict) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_purchase_orders',
        operation: 'update',
        title: 'Purchase order update failed',
        error: e,
        reference: { type: 'purchase_order', id: params.id },
      });
    }
    return NextResponse.json({ success: false, error: e.message }, { status: isReversalConflict ? 409 : 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsPORepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    if (existing.status !== 'draft') {
      return NextResponse.json({
        success: false,
        error: 'Only draft purchase orders can be deleted. Cancel confirmed orders or reverse received stock instead.',
      }, { status: 409 });
    }

    // Void the Xero bill before deleting (if one exists)
    const xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);

    await ImsPORepo.delete(Number(params.id), businessId);

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses incoming stock)
    if (existing && (existing.items?.length ?? 0) > 0) {
      const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO deletion:', err));
      }
    }

    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_purchase_orders',
      operation: 'delete',
      title: 'Purchase order deletion failed',
      error: e,
      reference: { type: 'purchase_order', id: params.id },
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
