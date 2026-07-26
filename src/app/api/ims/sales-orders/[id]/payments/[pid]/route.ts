import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; pid: string } }) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const soId = Number(params.id);
    const paymentId = Number(params.pid);
    if (!soId || !paymentId) {
      return NextResponse.json({ success: false, error: 'Invalid SO/payment id.' }, { status: 400 });
    }

    const so = await ImsSORepo.get(soId, session.businessId);
    if (!so) return NextResponse.json({ success: false, error: 'SO not found.' }, { status: 404 });
    const payment = (so.payments ?? []).find((p: any) => Number(p.id) === paymentId);
    if (!payment) return NextResponse.json({ success: false, error: 'Payment not found.' }, { status: 404 });

    await ImsSORepo.deletePayment(Number(params.pid));

    const xeroRows = await query<any>(
      `SELECT id
         FROM xero_sync_log
        WHERE business_id = ?
          AND sync_type = 'so_payment'
          AND reference_id = ?
          AND status = 'success'
        LIMIT 1`,
      [session.businessId, soId],
    ).catch(() => []);

    const xeroWarning = xeroRows.length > 0
      ? 'This payment was deleted in IMS, but Xero payments are not automatically reversed. Please have your bookkeeper remove the matching payment from the Xero invoice manually.'
      : null;

    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
