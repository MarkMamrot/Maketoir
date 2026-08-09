import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { fulfilSalesOrderPartial } from '@/lib/ims/orderResolution/customerFulfilment';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function responseStatus(message: string): number {
  if (message.includes('not found')) return 404;
  if (message.includes('Only confirmed')
    || message.includes('historical')
    || message.includes('already used')
    || message.includes('already assigned')
    || message.includes('exceeds')
    || message.includes('Insufficient')) return 409;
  if (message.includes('required')
    || message.includes('must be')
    || message.includes('cannot be negative')
    || message.includes('may appear only once')) return 400;
  return 500;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const soId = Number(params.id);
  if (!Number.isInteger(soId) || soId <= 0) {
    return NextResponse.json({ error: 'Invalid sales order ID.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const result = await fulfilSalesOrderPartial({
      businessId,
      soId,
      operationKey: String(body.operationKey ?? ''),
      shipmentQuantities: Array.isArray(body.shipmentQuantities) ? body.shipmentQuantities : [],
    });

    if (result.fulfilledVariantIds.length) {
      refreshVariantCache(result.fulfilledVariantIds).catch(() => {});
    }
    if (result.status === 'fulfilled') {
      await triggerSOXeroSync(businessId, soId, 'fulfilled');
    }
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const message = String(error?.message ?? 'Sales order fulfilment failed.');
    const status = responseStatus(message);
    if (status >= 500) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_sales_orders',
        operation: 'partial_fulfilment',
        title: 'Sales order partial fulfilment failed',
        error,
        reference: { type: 'sales_order', id: String(soId) },
      });
    }
    return NextResponse.json({ error: message }, { status });
  }
}