/**
 * GET /api/ims/xero/queued
 * Returns all POs, SOs, customer credit notes and supplier credit notes with xero_sync_status = 'queued'.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';


export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
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
    ).catch(() => [] as any[]);
    const sos = await imsQuery<any>(
      `SELECT so.id, so.so_number AS reference, 'so' AS type, so.status,
              so.total_amount, so.xero_synced_at,
              COALESCE(c.name) AS contact_name
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
        WHERE so.xero_sync_status = 'queued' AND so.business_id = ?
        ORDER BY so.xero_synced_at DESC`,
      [businessId]
    ).catch(() => [] as any[]);
    const cns = await imsQuery<any>(
      `SELECT cn.id, cn.cn_number AS reference, 'cn' AS type, cn.status,
              cn.total_amount, cn.xero_synced_at,
              COALESCE(c.name) AS contact_name
         FROM ims_credit_notes cn
         LEFT JOIN ims_contacts c ON c.id = cn.customer_id
        WHERE cn.xero_sync_status = 'queued' AND cn.business_id = ?
        ORDER BY cn.xero_synced_at DESC`,
      [businessId]
    ).catch(() => [] as any[]);
    const scns = await imsQuery<any>(
      `SELECT scn.id, scn.scn_number AS reference, 'scn' AS type, scn.status,
              scn.total_amount, scn.xero_synced_at,
              COALESCE(c.name) AS contact_name
         FROM ims_supplier_credit_notes scn
         LEFT JOIN ims_contacts c ON c.id = scn.supplier_id
        WHERE scn.xero_sync_status = 'queued' AND scn.business_id = ?
        ORDER BY scn.xero_synced_at DESC`,
      [businessId]
    ).catch(() => [] as any[]);
    return NextResponse.json({ queued: [...pos, ...sos, ...cns, ...scns], count: pos.length + sos.length + cns.length + scns.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
