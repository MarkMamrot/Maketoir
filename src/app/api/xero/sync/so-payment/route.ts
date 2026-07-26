/**
 * POST /api/xero/sync/so-payment
 * Body: { databaseId, soId, paymentId, xeroAccountCode? }
 *
 * Records an SO payment in Xero against the corresponding Invoice.
 * If the Invoice is still DRAFT, it approves it first.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { approveInvoice, syncSOPayment } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, soId, paymentId, xeroAccountCode } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!soId || !paymentId) {
    return NextResponse.json({ error: 'soId and paymentId are required.' }, { status: 400 });
  }

  const paymentRows = await query<any>(
    'SELECT * FROM ims_sales_order_payments WHERE id = ? AND so_id = ?',
    [paymentId, soId],
  );
  if (!paymentRows.length) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
  }
  const payment = paymentRows[0];

  const logRows = await query<any>(
    `SELECT xero_id
       FROM xero_sync_log
      WHERE business_id = ?
        AND sync_type = 'so_invoice'
        AND reference_id = ?
        AND status = 'success'
        AND xero_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [databaseId, soId],
  );
  if (!logRows.length || !logRows[0].xero_id) {
    return NextResponse.json({ error: 'No synced Invoice found for this SO. Sync the SO first.' }, { status: 400 });
  }

  let accountCode = typeof xeroAccountCode === 'string' ? xeroAccountCode.trim() : '';
  if (!accountCode && payment.payment_method_id) {
    const methodRows = await query<any>(
      `SELECT xero_account_code
         FROM ims_payment_methods
        WHERE id = ?
        LIMIT 1`,
      [payment.payment_method_id],
    );
    accountCode = String(methodRows[0]?.xero_account_code ?? '').trim();
  }
  if (!accountCode) {
    return NextResponse.json({
      error: 'xeroAccountCode is required (or configure xero_account_code on the SO payment method).',
    }, { status: 400 });
  }

  const xeroInvoiceId = String(logRows[0].xero_id);
  try {
    await approveInvoice(databaseId, xeroInvoiceId, Number(soId));
    const xeroPaymentId = await syncSOPayment(
      databaseId,
      xeroInvoiceId,
      Number(soId),
      Number(payment.amount),
      String(payment.payment_date),
      String(payment.currency_code || 'AUD'),
      accountCode,
    );
    return NextResponse.json({ success: !!xeroPaymentId, xeroPaymentId });
  } catch {
    return NextResponse.json({ error: 'Payment sync failed.' }, { status: 500 });
  }
}
