import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { triggerSOXeroSync, triggerSOXeroVoid, triggerSOXeroUpdate } from '@/lib/ims/xeroHooks';
import { getXeroInvoiceEditState } from '@/services/XeroSyncService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getOrderResolutionFinancialSummaries } from '@/lib/ims/orderResolution/financialSummary';
import { assessXeroDocumentEdit, hasXeroVisibleOrderChanges, type XeroDocumentEditState } from '@/lib/xero/documentEditPolicy';
import { recordXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';


export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsSORepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const resolution_financials = await getOrderResolutionFinancialSummaries(businessId, 'customer', Number(params.id));
    return NextResponse.json({ success: true, data: { ...data, resolution_financials } });
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
    const { items, status, xeroOverrideReason, ...soData } = body;

    let xeroWarning: string | null = null;
    if (status) {
      const existing = await ImsSORepo.get(Number(params.id), businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      await ImsSORepo.changeStatus(Number(params.id), status);

      // EVENT-DRIVEN CACHE UPDATE
      if ((existing.items?.length ?? 0) > 0) {
        const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO:', err));
        }
      }

      // Await void for revert/cancel so warning can be returned; fire-and-forget for other transitions
      if (status === 'draft' || status === 'cancelled') {
        xeroWarning = await triggerSOXeroVoid(businessId, Number(params.id)).catch(() => null);
      } else if (status === 'fulfilled') {
        await triggerSOXeroSync(businessId, Number(params.id), 'fulfilled').catch(err => console.error('[Xero] SO invoice approve failed:', err));
      } else {
        triggerSOXeroSync(businessId, Number(params.id), status).catch(() => {});
      }

    } else {
      const existing = await ImsSORepo.get(Number(params.id), businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      if (['partially_fulfilled', 'fulfilled'].includes(String(existing.status))) {
        const lockedFields = ['customer_id', 'location_id', 'order_date', 'payment_terms', 'price_tier', 'tax_treatment', 'tax_code', 'freight', 'discount'];
        if (items !== undefined || lockedFields.some(field => soData[field] !== undefined)) {
          return NextResponse.json({
            success: false,
            error: 'Customer, location, pricing, and order lines cannot be changed after any quantity has been fulfilled. Create a new sales order or process a return instead.',
          }, { status: 409 });
        }
      }
      const hasXeroChanges = hasXeroVisibleOrderChanges(
        'sales_order', existing as unknown as Record<string, unknown>, soData, items,
      );
      let xeroState: XeroDocumentEditState | null = null;
      let isXeroOverride = false;
      if (existing.xero_invoice_id && hasXeroChanges) {
        try {
          xeroState = await getXeroInvoiceEditState(businessId, existing.xero_invoice_id);
        } catch (error) {
          await reportRuntimeIssue({
            businessId, source: 'ims_sales_orders', operation: 'xero_edit_preflight',
            title: 'Sales order Xero edit preflight failed', error,
            reference: { type: 'sales_order', id: params.id },
          });
        }
        const assessment = assessXeroDocumentEdit(true, xeroState);
        if (!assessment.allowed) {
          const overrideReason = typeof xeroOverrideReason === 'string' ? xeroOverrideReason.trim() : '';
          const canOverride = ['Admin', 'SuperAdmin'].includes(session.tier ?? '') && overrideReason.length > 0;
          if (!canOverride) {
          return NextResponse.json({
            success: false,
              error: `${assessment.message} An Admin or SuperAdmin can save a local override by providing xeroOverrideReason.`,
              xeroOverrideAvailable: ['Admin', 'SuperAdmin'].includes(session.tier ?? ''),
          }, { status: 409 });
          }
          isXeroOverride = true;
        }
      }
      await ImsSORepo.update(Number(params.id), soData, items);

      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO:', err));
        }
      }

      if (isXeroOverride) {
        xeroWarning = 'Sales order saved locally as an Admin override. The linked Xero invoice was not changed.';
        await recordXeroReconciliationIssue({
          businessId, targetType: 'sales_order', referenceId: params.id,
          xeroId: existing.xero_invoice_id, ruleKey: 'admin_edit_override', severity: 'warning',
          summary: xeroWarning, expected: { localEdit: true }, actual: xeroState,
          eventType: 'override', actorId: session.userId, actorName: session.name ?? session.email,
          reason: xeroOverrideReason.trim(),
        });
      } else if (existing.xero_invoice_id && hasXeroChanges) {
        const result = await triggerSOXeroUpdate(businessId, Number(params.id));
        xeroWarning = result.warning;
        if (result.warning) {
          await recordXeroReconciliationIssue({
            businessId, targetType: 'sales_order', referenceId: params.id,
            xeroId: existing.xero_invoice_id, ruleKey: 'post_edit_sync_failed', severity: 'error',
            summary: result.warning, expected: { xeroUpdated: true }, actual: { xeroUpdated: false },
          });
        }
      }
    }
    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    const message = String(e?.message ?? 'Sales order update failed');
    const isShippedEditConflict = message.includes('cannot be changed after any quantity has been fulfilled');
    if (isShippedEditConflict) {
      return NextResponse.json({ success: false, error: message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_sales_orders',
      operation: 'update',
      title: 'Sales order update failed',
      error: e,
      reference: { type: 'sales_order', id: params.id },
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsSORepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    if (existing.status !== 'draft') {
      return NextResponse.json({
        success: false,
        error: 'Only draft sales orders can be deleted. Cancel confirmed orders or reverse fulfilled orders instead.',
      }, { status: 409 });
    }

    // Void the Xero invoice before deleting (if one exists)
    const xeroWarning = await triggerSOXeroVoid(businessId, Number(params.id)).catch(() => null);

    await ImsSORepo.delete(Number(params.id), businessId);

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses committed stock & sales)
    if (existing && (existing.items?.length ?? 0) > 0) {
      const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO deletion:', err));
      }
    }

    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_sales_orders',
      operation: 'delete',
      title: 'Sales order deletion failed',
      error: e,
      reference: { type: 'sales_order', id: params.id },
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
