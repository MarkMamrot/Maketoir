/**
 * GET /api/ims/xero/bill-details?poId=X
 *
 * Fetches live bill details (number, total, status) from Xero for a linked PO.
 * Used by the accounting section to show the Xero bill number/total and flag mismatches.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';
import { xeroApiFetch } from '@/services/XeroService';


export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  const url = new URL(req.url);
  const poId = url.searchParams.get('poId');
  if (!poId || isNaN(Number(poId))) {
    return NextResponse.json({ error: 'Invalid poId' }, { status: 400 });
  }

  try {
    const rows = await imsQuery<{ xero_bill_id: string | null }>(
      `SELECT xero_bill_id FROM ims_purchase_orders WHERE id = ? AND business_id = ? LIMIT 1`,
      [Number(poId), businessId],
    );
    const xeroId = rows[0]?.xero_bill_id;
    if (!xeroId) {
      return NextResponse.json({ error: 'No Xero bill linked to this PO' }, { status: 404 });
    }

    const result = await xeroApiFetch(businessId, `/Invoices/${xeroId}`, { method: 'GET' });
    const bill = result?.Invoices?.[0];
    if (!bill) {
      return NextResponse.json({ error: 'Bill not found in Xero' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      invoiceNumber: bill.InvoiceNumber ?? null,
      total: bill.Total ?? null,
      subTotal: bill.SubTotal ?? null,
      taxTotal: bill.TotalTax ?? null,
      status: bill.Status ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
