import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { ShippingAmendmentError } from '@/lib/ims/shipping/shippingAmendmentPolicy';
import { ShippingBatchError } from '@/lib/ims/shipping/shippingBatchTypes';
import { getShippingOrderPreparation, saveShippingOrderPreparation } from '@/lib/ims/shipping/shippingPreparation';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

async function preparationRoute(request: Request, id: string, write: boolean) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (write && (session.tier === 'Advisor' || session.role === 'Advisor'))
    return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const soId = Number(id);
  if (!Number.isSafeInteger(soId) || soId <= 0)
    return NextResponse.json({ error: 'A valid sales order ID is required.' }, { status: 400 });
  try {
    const data = await runImsForBusiness(session.businessId, async () => write
      ? saveShippingOrderPreparation(session.businessId, soId, await request.json())
      : getShippingOrderPreparation(session.businessId, soId));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ShippingAmendmentError || error instanceof ShippingBatchError)
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    if (error instanceof SyntaxError)
      return NextResponse.json({ success: false, error: 'Invalid JSON request.' }, { status: 400 });
    const message = error instanceof Error ? error.message : 'Unable to save order dimensions.';
    if (write && /required|choose|not found|incomplete|cannot|exceeds|remaining|already used|valid|country|HS code|dangerous|restricted|confirm|declared value/i.test(message))
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_shipping',
      operation: write ? 'save_order_preparation' : 'get_order_preparation',
      title: 'Shipping order preparation failed', error, context: { soId },
    });
    return NextResponse.json({ success: false, error: 'Unable to load or save order dimensions.' }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return preparationRoute(request, params.id, false);
}
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return preparationRoute(request, params.id, true);
}
