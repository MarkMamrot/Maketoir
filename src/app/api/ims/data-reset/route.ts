import { NextRequest, NextResponse } from 'next/server';
import { imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

/**
 * POST /api/ims/data-reset
 * Body: { confirm: 'DELETE', targets: string[] }
 *
 * Deletes selected transactional data for the authenticated business.
 * Valid targets: 'stocktakes' | 'purchase_orders' | 'sales_orders' | 'pos_sales'
 *
 * Products, variants, stock levels, contacts, locations, settings, and users
 * are never touched.
 */
export async function POST(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const businessId: string = session.businessId;
  if (!businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Require explicit confirmation phrase to prevent accidental calls.
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Confirmation phrase required.' }, { status: 400 });
  }

  const targets: string[] = Array.isArray(body.targets) ? body.targets : [];
  const valid = new Set(['stocktakes', 'purchase_orders', 'sales_orders', 'pos_sales']);
  const invalid = targets.filter(t => !valid.has(t));
  if (invalid.length || targets.length === 0) {
    return NextResponse.json({ error: 'Invalid or empty targets.' }, { status: 400 });
  }

  const summary: Record<string, number> = {};

  // Each group is deleted in child-first order to avoid FK violations where
  // no CASCADE is set. All deletes are scoped strictly to this business_id.
  // pos_sales and pos_register_sessions use location_id; the sub-select scopes
  // them to this business via ims_locations.business_id.

  if (targets.includes('stocktakes')) {
    // Items first (no direct business_id — join via stocktake)
    const [stRes]: any = await getIMSPool().query(
      `DELETE si FROM ims_stocktake_items si
         INNER JOIN ims_stocktakes s ON s.id = si.stocktake_id
         WHERE s.business_id = ?`,
      [businessId],
    );
    const [stMain]: any = await getIMSPool().query(
      `DELETE FROM ims_stocktakes WHERE business_id = ?`,
      [businessId],
    );
    summary.stocktakes = stMain.affectedRows ?? 0;
  }

  if (targets.includes('purchase_orders')) {
    // Attachments file records (if table exists — safe to skip if not)
    try {
      await getIMSPool().query(
        `DELETE f FROM ims_purchase_order_files f
           INNER JOIN ims_purchase_orders po ON po.id = f.po_id
           WHERE po.business_id = ?`,
        [businessId],
      );
    } catch { /* table may not exist in all environments */ }
    await getIMSPool().query(
      `DELETE p FROM ims_purchase_order_payments p
         INNER JOIN ims_purchase_orders po ON po.id = p.po_id
         WHERE po.business_id = ?`,
      [businessId],
    );
    await getIMSPool().query(
      `DELETE i FROM ims_purchase_order_items i
         INNER JOIN ims_purchase_orders po ON po.id = i.po_id
         WHERE po.business_id = ?`,
      [businessId],
    );
    const [poMain]: any = await getIMSPool().query(
      `DELETE FROM ims_purchase_orders WHERE business_id = ?`,
      [businessId],
    );
    summary.purchase_orders = poMain.affectedRows ?? 0;
  }

  if (targets.includes('sales_orders')) {
    // Covers both wholesale SOs and online (so_type = 'online') orders.
    try {
      await getIMSPool().query(
        `DELETE f FROM ims_sales_order_files f
           INNER JOIN ims_sales_orders so ON so.id = f.so_id
           WHERE so.business_id = ?`,
        [businessId],
      );
    } catch { /* table may not exist */ }
    await getIMSPool().query(
      `DELETE p FROM ims_sales_order_payments p
         INNER JOIN ims_sales_orders so ON so.id = p.so_id
         WHERE so.business_id = ?`,
      [businessId],
    );
    await getIMSPool().query(
      `DELETE i FROM ims_sales_order_items i
         INNER JOIN ims_sales_orders so ON so.id = i.so_id
         WHERE so.business_id = ?`,
      [businessId],
    );
    const [soMain]: any = await getIMSPool().query(
      `DELETE FROM ims_sales_orders WHERE business_id = ?`,
      [businessId],
    );
    summary.sales_orders = soMain.affectedRows ?? 0;
  }

  if (targets.includes('pos_sales')) {
    // pos_payments and pos_sale_items are keyed to pos_sales.id.
    // pos_sales.location_id → ims_locations.business_id for scoping.
    await getIMSPool().query(
      `DELETE pp FROM pos_payments pp
         INNER JOIN pos_sales ps ON ps.id = pp.sale_id
         INNER JOIN ims_locations l ON l.id = ps.location_id
         WHERE l.business_id = ?`,
      [businessId],
    );
    await getIMSPool().query(
      `DELETE psi FROM pos_sale_items psi
         INNER JOIN pos_sales ps ON ps.id = psi.sale_id
         INNER JOIN ims_locations l ON l.id = ps.location_id
         WHERE l.business_id = ?`,
      [businessId],
    );
    const [psMain]: any = await getIMSPool().query(
      `DELETE ps FROM pos_sales ps
         INNER JOIN ims_locations l ON l.id = ps.location_id
         WHERE l.business_id = ?`,
      [businessId],
    );
    // EOD reconciliations and register sessions are also per-location.
    try {
      await getIMSPool().query(
        `DELETE eod FROM pos_eod_reconciliations eod
           INNER JOIN ims_locations l ON l.id = eod.location_id
           WHERE l.business_id = ?`,
        [businessId],
      );
    } catch { /* table may not exist */ }
    try {
      await getIMSPool().query(
        `DELETE rs FROM pos_register_sessions rs
           INNER JOIN ims_locations l ON l.id = rs.location_id
           WHERE l.business_id = ?`,
        [businessId],
      );
    } catch { /* table may not exist */ }
    summary.pos_sales = psMain.affectedRows ?? 0;
  }

  // Clear the xero sync log entries for this business (stale references to
  // deleted records can cause confusing errors on the Xero tab).
  try {
    await imsExecute(`DELETE FROM ims_xero_sync_log WHERE business_id = ?`, [businessId]);
  } catch { /* non-critical */ }

  console.log(`[data-reset] Business ${businessId} deleted:`, summary);
  return NextResponse.json({ success: true, deleted: summary });
}
