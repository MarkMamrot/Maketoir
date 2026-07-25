/**
 * POST /api/ims/xero/push
 * Body: { type: 'po' | 'so' | 'cn' | 'scn', id: number }
 * Re-triggers the Xero sync for a queued or failed order.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { triggerPOXeroSync, triggerSOXeroSync, triggerCNXeroSync, triggerSupplierCNXeroSync } from '@/lib/ims/xeroHooks';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;
  let lockKey: string | null = null;

  try {
    const { type, id } = await req.json() as { type: 'po' | 'so' | 'cn' | 'scn'; id: number };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    if (type === 'po') {
      // Determine current PO status so we know which sync to run
      const rows = await imsQuery<{ status: string }>(`SELECT status FROM ims_purchase_orders WHERE id = ?`, [id]);
      const status = rows[0]?.status ?? 'confirmed';
      const syncStatus = status === 'complete' ? 'complete' : 'confirmed';
      await triggerPOXeroSync(businessId, id, syncStatus);
    } else if (type === 'so') {
      await triggerSOXeroSync(businessId, id, 'confirmed');
    } else if (type === 'cn') {
      lockKey = `xero:push:${businessId}:cn:${id}`;
      const lockRows = await query<{ acquired: number }>(`SELECT GET_LOCK(?, 0) AS acquired`, [lockKey]);
      if (!Number(lockRows[0]?.acquired)) {
        return NextResponse.json({ error: 'Retry already in progress for this customer credit note.' }, { status: 409 });
      }
      const cnRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const cn = cnRows[0];
      if (cn?.xero_sync_status === 'synced' && cn?.xero_credit_note_id) {
        return NextResponse.json({ success: true, skipped: true, reason: 'already_synced' });
      }
      await triggerCNXeroSync(businessId, id);
    } else {
      lockKey = `xero:push:${businessId}:scn:${id}`;
      const lockRows = await query<{ acquired: number }>(`SELECT GET_LOCK(?, 0) AS acquired`, [lockKey]);
      if (!Number(lockRows[0]?.acquired)) {
        return NextResponse.json({ error: 'Retry already in progress for this supplier credit note.' }, { status: 409 });
      }
      const scnRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_supplier_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const scn = scnRows[0];
      if (scn?.xero_sync_status === 'synced' && scn?.xero_credit_note_id) {
        return NextResponse.json({ success: true, skipped: true, reason: 'already_synced' });
      }
      await triggerSupplierCNXeroSync(businessId, id);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    if (lockKey) {
      try {
        await query(`SELECT RELEASE_LOCK(?)`, [lockKey]);
      } catch {
        // Non-critical; lock auto-releases when connection closes.
      }
    }
  }
}
