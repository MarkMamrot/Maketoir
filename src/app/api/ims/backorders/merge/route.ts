import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { mergeCustomerBackorders, mergeSupplierBackorders } from '@/lib/ims/backorders/mergeBackorders';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = String(session.businessId);

  let type = '';
  try {
    const body = await req.json() as { type?: string; orderIds?: number[]; operationKey?: string };
    type = String(body.type ?? '');
    if (type !== 'customer' && type !== 'supplier') {
      return NextResponse.json({ error: 'Backorder type must be customer or supplier.' }, { status: 400 });
    }
    const input = {
      businessId,
      orderIds: Array.isArray(body.orderIds) ? body.orderIds.map(Number) : [],
      operationKey: String(body.operationKey ?? ''),
    };
    const result = type === 'customer'
      ? await mergeCustomerBackorders(input)
      : await mergeSupplierBackorders(input);

    if (result.variantIds.length) refreshVariantCache(result.variantIds).catch(() => {});
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const message = String(error?.message ?? 'Backorder merge failed.');
    const isConflict = /select at least|not found|only held|cannot be merged|linked to Xero|no line items|operation key/i.test(message);
    if (!isConflict) {
      await reportRuntimeIssue({
        businessId,
        source: type === 'supplier' ? 'ims_purchase_orders' : 'ims_sales_orders',
        operation: 'merge_backorders',
        title: 'Backorder merge failed',
        error,
        context: { type },
        reference: { type: 'backorder_merge' },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: isConflict ? 409 : 500 });
  }
}