/**
 * POST /api/xero/sync/po-bill
 * Body: { databaseId, poId }
 *
 * Syncs a single PO to Xero as a Draft Bill.
 * Called manually from the UI or automatically on PO creation.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncPOAsDraftBill, approveBill, syncPOReceivedJournal } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, poId, action } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!poId) return NextResponse.json({ error: 'poId is required.' }, { status: 400 });

  // Load PO with items and payments
  const poRows = await query(
    `SELECT po.*, c.company_name AS supplier_name, l.name AS location_name
     FROM ims_purchase_orders po
     LEFT JOIN ims_contacts c ON c.id = po.supplier_id
     LEFT JOIN ims_locations l ON l.id = po.location_id
     WHERE po.id = ? AND po.business_id = ?`,
    [poId, databaseId],
  );
  if (!poRows.length) return NextResponse.json({ error: 'PO not found.' }, { status: 404 });
  const po = poRows[0];

  const items = await query(
    `SELECT poi.*, v.sku, p.name AS product_name
     FROM ims_purchase_order_items poi
     LEFT JOIN ims_variants v ON v.id = poi.variant_id
     LEFT JOIN ims_products p ON p.id = v.product_id
     WHERE poi.po_id = ?`,
    [poId],
  );

  const payments = await query(
    'SELECT * FROM ims_purchase_order_payments WHERE po_id = ?',
    [poId],
  );

  const poData = { ...po, items, payments };

  try {
    if (action === 'approve') {
      // Find existing Xero bill ID from sync log
      const logRows = await query(
        `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        [databaseId, poId],
      );
      if (!logRows.length || !logRows[0].xero_id) {
        return NextResponse.json({ error: 'No synced Draft Bill found for this PO.' }, { status: 400 });
      }
      const ok = await approveBill(databaseId, logRows[0].xero_id, poId);
      return NextResponse.json({ success: ok, xeroId: logRows[0].xero_id });
    }

    if (action === 'received-journal') {
      // Post the "received" transfer journal (In Transit → Inventory Asset)
      const journalId = await syncPOReceivedJournal(
        databaseId, poId, po.po_number, po.total_amount, po.location_id,
      );
      return NextResponse.json({ success: !!journalId, xeroId: journalId });
    }

    // Default: create Draft Bill
    const xeroId = await syncPOAsDraftBill(databaseId, poData);
    return NextResponse.json({ success: !!xeroId, xeroId });
  } catch (err: any) {
    return NextResponse.json({ error: 'Sync failed.' }, { status: 500 });
  }
}
