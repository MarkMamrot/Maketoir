/**
 * POST /api/ims/xero/push
 * Body: { type: 'po' | 'so', id: number }
 * Re-triggers the Xero sync for a queued or failed order.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { triggerPOXeroSync, triggerSOXeroSync } from '@/lib/ims/xeroHooks';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    const { type, id } = await req.json() as { type: 'po' | 'so'; id: number };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    if (type === 'po') {
      // Determine current PO status so we know which sync to run
      const rows = await imsQuery<{ status: string }>(`SELECT status FROM ims_purchase_orders WHERE id = ?`, [id]);
      const status = rows[0]?.status ?? 'approved';
      const syncStatus = status === 'received' ? 'received' : 'approved';
      await triggerPOXeroSync(businessId, id, syncStatus);
    } else {
      await triggerSOXeroSync(businessId, id, 'confirmed');
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
