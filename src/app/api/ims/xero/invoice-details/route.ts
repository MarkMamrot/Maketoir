/**
 * GET /api/ims/xero/invoice-details?soId=X
 *
 * Fetches live invoice details (number, total, status) from Xero for a linked SO.
 * Used by SoAccountingSection to show the Xero invoice number/total and flag mismatches.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { xeroApiFetch } from '@/services/XeroService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  const url = new URL(req.url);
  const soId = url.searchParams.get('soId');
  if (!soId || isNaN(Number(soId))) {
    return NextResponse.json({ error: 'Invalid soId' }, { status: 400 });
  }

  try {
    const rows = await imsQuery<{ xero_invoice_id: string | null }>(
      `SELECT xero_invoice_id FROM ims_sales_orders WHERE id = ? AND business_id = ? LIMIT 1`,
      [Number(soId), businessId],
    );
    const xeroId = rows[0]?.xero_invoice_id;
    if (!xeroId) {
      return NextResponse.json({ error: 'No Xero invoice linked to this SO' }, { status: 404 });
    }

    const result = await xeroApiFetch(businessId, `/Invoices/${xeroId}`, { method: 'GET' });
    const invoice = result?.Invoices?.[0];
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found in Xero' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      invoiceNumber: invoice.InvoiceNumber ?? null,
      total: invoice.Total ?? null,
      subTotal: invoice.SubTotal ?? null,
      taxTotal: invoice.TotalTax ?? null,
      status: invoice.Status ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
