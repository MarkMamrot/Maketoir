/**
 * POST /api/xero/sync/so-invoice
 * Body: { databaseId, soId }
 *
 * Syncs a wholesale Sales Order to Xero as an Invoice.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncSOAsInvoice } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, soId } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!soId) return NextResponse.json({ error: 'soId is required.' }, { status: 400 });

  // Load SO with items
  const soRows = await query(
    `SELECT so.*, c.company_name AS customer_name, l.name AS location_name
     FROM ims_sales_orders so
     LEFT JOIN ims_contacts c ON c.id = so.customer_id
     LEFT JOIN ims_locations l ON l.id = so.location_id
     WHERE so.id = ? AND so.business_id = ?`,
    [soId, databaseId],
  );
  if (!soRows.length) return NextResponse.json({ error: 'SO not found.' }, { status: 404 });
  const so = soRows[0];

  const items = await query(
    `SELECT soi.*, v.sku, p.name AS product_name
     FROM ims_sales_order_items soi
     LEFT JOIN ims_variants v ON v.id = soi.variant_id
     LEFT JOIN ims_products p ON p.id = v.product_id
     WHERE soi.so_id = ?`,
    [soId],
  );

  const soData = { ...so, items };

  try {
    const xeroId = await syncSOAsInvoice(databaseId, soData);
    return NextResponse.json({ success: !!xeroId, xeroId });
  } catch (err: any) {
    return NextResponse.json({ error: 'Sync failed.' }, { status: 500 });
  }
}
