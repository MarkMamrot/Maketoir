import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { splitCustomerBackorder } from '@/lib/ims/backorders/customerBackorders';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getXeroInvoiceStatus } from '@/services/XeroSyncService';
import { StockShortfallError } from '@/lib/ims/orderResolution/stockShortfall';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);
  const soId = Number(params.id);

  try {
    const body = await req.json() as {
      operationKey?: string;
      fulfilQuantities?: Array<{ itemId: number; quantity: number }>;
    };
    const existing = await ImsSORepo.get(soId, businessId);
    if (!existing) return NextResponse.json({ error: 'Sales order not found.' }, { status: 404 });
    const xeroInvoiceId = String((existing as any).xero_invoice_id ?? '').trim() || null;
    if (xeroInvoiceId) {
      const xeroStatus = await getXeroInvoiceStatus(businessId, xeroInvoiceId);
      if (xeroStatus !== 'DRAFT') {
        return NextResponse.json({
          error: `The linked Xero invoice is ${xeroStatus ?? 'unavailable'} and cannot be split.`,
        }, { status: 409 });
      }
    }
    const result = await splitCustomerBackorder({
      businessId,
      soId,
      operationKey: String(body.operationKey ?? ''),
      fulfilQuantities: Array.isArray(body.fulfilQuantities) ? body.fulfilQuantities : [],
      verifiedDraftXeroId: xeroInvoiceId,
      allowNegativeStock: body.allowNegativeStock === true,
    });

    if (result.fulfilledVariantIds.length) {
      refreshVariantCache(result.fulfilledVariantIds).catch(() => {});
    }
    await triggerSOXeroSync(businessId, soId, 'fulfilled');
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof StockShortfallError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code, shortfalls: error.shortfalls }, { status: 409 });
    }
    const message = String(error?.message ?? 'Customer backorder failed.');
    const isConflict = /cannot|only confirmed|payments|already linked|insufficient|required for every|at least one/i.test(message);
    if (!isConflict) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_sales_orders',
        operation: 'split_customer_backorder',
        title: 'Customer backorder split failed',
        error,
        context: { soId },
        reference: { type: 'sales_order', id: soId },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: isConflict ? 409 : 500 });
  }
}