/**
 * POST /api/ims/xero/void
 * Body: { type: 'po' | 'so', id: number }
 *
 * Manually voids the Xero bill/invoice linked to a PO or SO.
 * Returns { success, xeroWarning? } — xeroWarning is set when the void
 * failed or the document has payments applied (SO invoices only).
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { triggerPOXeroVoid, triggerSOXeroVoid } from '@/lib/ims/xeroHooks';


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    const { type, id } = await req.json() as { type: 'po' | 'so'; id: number };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    const warning = type === 'po'
      ? await triggerPOXeroVoid(businessId, Number(id))
      : await triggerSOXeroVoid(businessId, Number(id));

    if (warning) {
      return NextResponse.json({ success: false, xeroWarning: warning });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
