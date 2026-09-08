import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; pid: string } }) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const poId = Number(params.id);
    const paymentId = Number(params.pid);
    if (!poId || !paymentId) {
      return NextResponse.json({ success: false, error: 'Invalid PO/payment id.' }, { status: 400 });
    }

    const po = await ImsPORepo.get(poId, session.businessId);
    if (!po) return NextResponse.json({ success: false, error: 'PO not found.' }, { status: 404 });
    const payment = (po.payments ?? []).find((p: any) => Number(p.id) === paymentId);
    if (!payment) return NextResponse.json({ success: false, error: 'Payment not found.' }, { status: 404 });
    const application = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_early_payment_discount_applications
        WHERE business_id = ? AND document_type = 'purchase_order' AND document_id = ? AND settlement_payment_id = ? LIMIT 1`,
      [session.businessId, poId, paymentId],
    );
    if (application[0]) return NextResponse.json({ success: false, error: 'This payment applied an early-payment discount and cannot be deleted separately.' }, { status: 409 });

    await ImsPORepo.deletePayment(Number(params.pid));

    const xeroRows = await query<any>(
      `SELECT id
         FROM xero_sync_log
        WHERE business_id = ?
          AND sync_type = 'po_payment'
          AND reference_id = ?
          AND status = 'success'
        LIMIT 1`,
      [session.businessId, poId],
    ).catch(() => []);

    const xeroWarning = xeroRows.length > 0
      ? 'This payment was deleted in IMS, but Xero payments are not automatically reversed. Please have your bookkeeper remove the matching payment from the Xero bill manually.'
      : null;

    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
