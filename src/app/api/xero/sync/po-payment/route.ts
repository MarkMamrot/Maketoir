/**
 * POST /api/xero/sync/po-payment
 * Body: { databaseId, poId, paymentId }
 *
 * Records a PO payment in Xero against the corresponding Bill.
 * If the Bill is still DRAFT, it approves it first.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncPOPayment, approveBill } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, poId, paymentId } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!poId || !paymentId) return NextResponse.json({ error: 'poId and paymentId are required.' }, { status: 400 });

  // Get the payment record
  const paymentRows = await query(
    'SELECT * FROM ims_purchase_order_payments WHERE id = ? AND po_id = ?',
    [paymentId, poId],
  );
  if (!paymentRows.length) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
  const payment = paymentRows[0];

  // Find the Xero Bill ID from sync log
  const logRows = await query(
    `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [databaseId, poId],
  );

  if (!logRows.length || !logRows[0].xero_id) {
    return NextResponse.json({ error: 'No synced Bill found for this PO. Sync the PO first.' }, { status: 400 });
  }

  const xeroInvoiceId = logRows[0].xero_id;

  try {
    // Approve the bill first (idempotent if already approved)
    await approveBill(databaseId, xeroInvoiceId, poId);

    // Record the payment
    const xeroPaymentId = await syncPOPayment(
      databaseId,
      xeroInvoiceId,
      poId,
      payment.amount,
      payment.payment_date,
      payment.currency_code || 'AUD',
    );

    return NextResponse.json({ success: !!xeroPaymentId, xeroPaymentId });
  } catch (err: any) {
    return NextResponse.json({ error: 'Payment sync failed.' }, { status: 500 });
  }
}
