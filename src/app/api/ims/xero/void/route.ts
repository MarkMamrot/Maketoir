/**
 * POST /api/ims/xero/void
 * Body: { type: 'po' | 'so' | 'cn' | 'scn', id: number }
 *
 * Manually voids the Xero document linked to a PO/SO/CN/SCN.
 * Returns { success, xeroWarning? } — xeroWarning is set when the void
 * failed or the document has payments applied (SO invoices only).
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { triggerCNXeroVoid, triggerPOXeroVoid, triggerSOXeroVoid, triggerSupplierCNXeroVoid } from '@/lib/ims/xeroHooks';


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    const { type, id } = await req.json() as { type: 'po' | 'so' | 'cn' | 'scn'; id: number };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    let warning: string | null = null;
    if (type === 'po') {
      warning = await triggerPOXeroVoid(businessId, Number(id));
    } else if (type === 'so') {
      warning = await triggerSOXeroVoid(businessId, Number(id));
    } else if (type === 'cn') {
      warning = await triggerCNXeroVoid(businessId, Number(id));
    } else if (type === 'scn') {
      warning = await triggerSupplierCNXeroVoid(businessId, Number(id));
    } else {
      return NextResponse.json({ error: 'Unsupported type' }, { status: 400 });
    }

    if (warning) {
      return NextResponse.json({ success: false, xeroWarning: warning });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
