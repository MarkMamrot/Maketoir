/**
 * POST /api/ims/xero/push
 * Body: { type: 'po' | 'so' | 'scn', id: number }
 * Re-triggers the Xero sync for a queued or failed order.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { triggerPOXeroSync, triggerSOXeroSync, triggerSupplierCNXeroSync } from '@/lib/ims/xeroHooks';
import { imsQuery } from '@/services/IMSMySQLService';


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    const { type, id } = await req.json() as { type: 'po' | 'so' | 'scn'; id: number };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    if (type === 'po') {
      // Determine current PO status so we know which sync to run
      const rows = await imsQuery<{ status: string }>(`SELECT status FROM ims_purchase_orders WHERE id = ?`, [id]);
      const status = rows[0]?.status ?? 'confirmed';
      const syncStatus = status === 'complete' ? 'complete' : 'confirmed';
      await triggerPOXeroSync(businessId, id, syncStatus);
    } else if (type === 'so') {
      await triggerSOXeroSync(businessId, id, 'confirmed');
    } else {
      await triggerSupplierCNXeroSync(businessId, id);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
