import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { triggerSOXeroSync, triggerSOXeroVoid, triggerSOXeroUpdate } from '@/lib/ims/xeroHooks';
import { getXeroInvoiceEditState } from '@/services/XeroSyncService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getOrderResolutionFinancialSummaries } from '@/lib/ims/orderResolution/financialSummary';
import { assessXeroDocumentEdit, hasXeroVisibleOrderChanges, type XeroDocumentEditState } from '@/lib/xero/documentEditPolicy';
import { recordXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';
import { OrderLifecycleConflict } from '@/lib/ims/orderLifecyclePolicy';
import { OrderAmendmentConflict } from '@/lib/ims/orderAmendmentPlan';
import { getOrderActivityHistory } from '@/lib/ims/orderAmendmentHistory';
import { listStockAllocations } from '@/lib/ims/stockAllocation/service';
import { imsQuery } from '@/services/IMSMySQLService';


export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsSORepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const shipments = await imsQuery<any>(
      `SELECT id, shopify_fulfilment_id, status, fulfilled_at, shopify_updated_at
         FROM ims_so_shipments
        WHERE business_id = ? AND so_id = ?
        ORDER BY COALESCE(fulfilled_at, created_at), id`,
      [businessId, Number(params.id)],
    );
    if (shipments.length > 0) {
      const placeholders = shipments.map(() => '?').join(',');
      const shipmentIds = shipments.map(shipment => Number(shipment.id));
      const [shipmentItems, tracking] = await Promise.all([
        imsQuery<any>(
          `SELECT si.shipment_id, si.shopify_line_item_id, si.quantity,
                  v.sku,
                  COALESCE(p.name, soi.notes) AS product_name,
                  CONCAT_WS(' / ',
                    NULLIF(v.option1_value, ''),
                    NULLIF(v.option2_value, ''),
                    NULLIF(v.option3_value, '')
                  ) AS variant_label
             FROM ims_so_shipment_items si
             LEFT JOIN ims_sales_order_items soi
               ON soi.business_id COLLATE utf8mb4_general_ci = si.business_id COLLATE utf8mb4_general_ci
              AND soi.so_id = ?
              AND CAST(soi.shopify_line_item_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_general_ci
                = si.shopify_line_item_id COLLATE utf8mb4_general_ci
             LEFT JOIN ims_product_variants v
               ON v.business_id COLLATE utf8mb4_general_ci = si.business_id COLLATE utf8mb4_general_ci
              AND v.variant_id COLLATE utf8mb4_general_ci = soi.variant_id COLLATE utf8mb4_general_ci
             LEFT JOIN ims_products p
               ON p.business_id COLLATE utf8mb4_general_ci = si.business_id COLLATE utf8mb4_general_ci
              AND p.product_id COLLATE utf8mb4_general_ci = v.product_id COLLATE utf8mb4_general_ci
            WHERE si.business_id COLLATE utf8mb4_general_ci = ? AND si.shipment_id IN (${placeholders})
            ORDER BY si.id`,
          [Number(params.id), businessId, ...shipmentIds],
        ),
        imsQuery<any>(
          `SELECT shipment_id, company, tracking_number, tracking_url
             FROM ims_so_shipment_tracking
            WHERE business_id = ? AND shipment_id IN (${placeholders})
            ORDER BY id`,
          [businessId, ...shipmentIds],
        ),
      ]);
      for (const shipment of shipments) {
        shipment.items = shipmentItems.filter(item => Number(item.shipment_id) === Number(shipment.id));
        shipment.tracking = tracking.filter(item => Number(item.shipment_id) === Number(shipment.id));
      }
    }
    let activity_history: Awaited<ReturnType<typeof getOrderActivityHistory>> = [];
    try {
      activity_history = await getOrderActivityHistory(businessId, 'sales_order', Number(params.id));
    } catch (error) {
      await reportRuntimeIssue({
        businessId, source: 'ims_sales_orders', operation: 'load_activity_history',
        title: 'Sales order activity history could not be loaded', error,
        reference: { type: 'sales_order', id: params.id },
      }).catch(() => {});
    }
    let resolution_financials: Awaited<ReturnType<typeof getOrderResolutionFinancialSummaries>> = [];
    let resolutionFinancialsWarning: string | null = null;
    try {
      resolution_financials = await getOrderResolutionFinancialSummaries(businessId, 'customer', Number(params.id));
    } catch (error) {
      resolutionFinancialsWarning = 'Shortfall financial details are temporarily unavailable. The sales order can still be viewed.';
      await reportRuntimeIssue({
        businessId, source: 'ims_sales_orders', operation: 'load_resolution_financials',
        title: 'Sales order shortfall financial details could not be loaded', error,
        reference: { type: 'sales_order', id: params.id },
      }).catch(() => {});
    }
    let stock_allocations: Awaited<ReturnType<typeof listStockAllocations>> = [];
    try {
      stock_allocations = await listStockAllocations({ businessId, soId: Number(params.id) });
    } catch (error) {
      await reportRuntimeIssue({
        businessId, source: 'ims_sales_orders', operation: 'load_stock_allocations',
        title: 'Sales order stock allocations could not be loaded', error,
        reference: { type: 'sales_order', id: params.id },
      }).catch(() => {});
    }
    return NextResponse.json({
      success: true,
      data: {
        ...data,
        saleType: data.so_type === 'online' ? 'online' : data.so_type,
        sourceSystem: data.shopify_order_id ? 'shopify' : null,
        shipments,
        resolution_financials,
        stock_allocations,
        activity_history,
        amendment_history: activity_history,
      },
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
    const { items, status, operationKey, expectedUpdatedAt, ...soData } = body;

    let xeroWarning: string | null = null;
    if (status) {
      const existing = await ImsSORepo.get(Number(params.id), businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      if (status === 'fulfilled' && existing.status !== 'partially_fulfilled') {
        throw new OrderLifecycleConflict('Use Fulfil to record shipment quantities before completing a sales order.');
      }
      if (existing.status === 'partially_fulfilled' && status !== 'fulfilled') {
        throw new OrderLifecycleConflict('Use Continue Fulfilment or Resolve Outstanding for a partially fulfilled sales order.');
      }
      const statusOperationKey = typeof operationKey === 'string' && operationKey.trim() ? operationKey.trim() : randomUUID();
      const statusRequestHash = createHash('sha256').update(JSON.stringify({ status })).digest('hex');
      await ImsSORepo.changeStatus(
        Number(params.id), status, typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : null,
        {
          operationKey: statusOperationKey,
          requestHash: statusRequestHash,
          actorId: session.userId,
          actorName: session.name ?? session.email,
        },
      );

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
        const lockedFields = ['customer_id', 'location_id', 'order_date', 'delivery_address', 'delivery_address2', 'delivery_suburb', 'delivery_city', 'delivery_state', 'delivery_postcode', 'delivery_country', 'payment_terms', 'price_tier', 'tax_treatment', 'tax_code', 'freight', 'discount'];
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
          return NextResponse.json({
            success: false,
            error: `${assessment.message} Use the sales-order correction workflow instead.`,
            code: assessment.reason,
          }, { status: 409 });
        }
      }
      const amendmentKey = typeof operationKey === 'string' && operationKey.trim() ? operationKey.trim() : randomUUID();
      const requestHash = createHash('sha256').update(JSON.stringify({ soData, items })).digest('hex');
      await ImsSORepo.update(Number(params.id), soData, items, {
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
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO:', err));
        }
      }

      if (existing.xero_invoice_id && hasXeroChanges) {
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
