/**
 * GET /api/ims/xero/queued
 * Returns all POs and SOs with xero_sync_status = 'queued'.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.userSpreadsheetId as string;
  try {
    const pos = await imsQuery<any>(
      `SELECT po.id, po.po_number AS reference, 'po' AS type, po.status,
              po.total_amount, po.xero_synced_at,
              COALESCE(c.name, po.supplier_name_raw) AS contact_name
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
        WHERE po.xero_sync_status = 'queued' AND po.business_id = ?
        ORDER BY po.xero_synced_at DESC`,
      [businessId]
    );
    const sos = await imsQuery<any>(
      `SELECT so.id, so.so_number AS reference, 'so' AS type, so.status,
              so.total_amount, so.xero_synced_at,
              COALESCE(c.name) AS contact_name
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
        WHERE so.xero_sync_status = 'queued' AND so.business_id = ?
        ORDER BY so.xero_synced_at DESC`,
      [businessId]
    );
    return NextResponse.json({ queued: [...pos, ...sos], count: pos.length + sos.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
