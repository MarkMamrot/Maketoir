/**
 * POST /api/ims/xero/dismiss
 * Body: { type: 'po' | 'so', id: number }
 *
 * Removes an item from the Xero sync queue without attempting a sync.
 * Sets xero_sync_status = 'error' (removes it from the queued panel)
 * and logs the dismissal to xero_sync_log for audit purposes.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { markPoXeroStatus, markSoXeroStatus } from '@/services/XeroSyncService';
import { imsExecute } from '@/services/IMSMySQLService';


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    const { type, id } = await req.json() as { type: 'po' | 'so'; id: number };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    const syncType = type === 'po' ? 'po_bill' : 'so_invoice';

    // Set xero_sync_status to 'error' — removes from the queued panel
    if (type === 'po') {
      await markPoXeroStatus(id, 'error');
    } else {
      await markSoXeroStatus(id, 'error');
    }

    // Log the dismissal for audit trail
    await imsExecute(
      `INSERT INTO xero_sync_log (business_id, sync_type, reference_id, xero_id, status, detail)
       VALUES (?, ?, ?, NULL, 'skipped', 'Manually dismissed from sync queue')`,
      [businessId, syncType, id],
    );

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
