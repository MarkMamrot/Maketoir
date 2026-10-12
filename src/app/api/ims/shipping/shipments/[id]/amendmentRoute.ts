import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { ShippingAmendmentError } from '@/lib/ims/shipping/shippingAmendmentPolicy';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function shippingAmendmentRoute(
  id: string, operation: string, write: boolean,
  action: (businessId: string, shipmentId: number) => Promise<unknown>,
) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (write && (session.tier === 'Advisor' || session.role === 'Advisor'))
    return NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 });
  const shipmentId = Number(id);
  if (!Number.isSafeInteger(shipmentId) || shipmentId <= 0)
    return NextResponse.json({ success: false, error: 'A valid shipment ID is required.' }, { status: 400 });
  try {
    const data = await runImsForBusiness(session.businessId, () => action(session.businessId, shipmentId));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ShippingAmendmentError) return NextResponse.json({
      success: false, error: error.message, affectedShipmentIds: error.affectedShipmentIds,
      requiresFreshLabels: error.requiresFreshLabels,
    }, { status: error.status });
    const message = error instanceof Error ? error.message : '';
    const validation = error instanceof SyntaxError ||
      /required|choose|not found|incomplete|cannot|exceeds|remaining|not supported|invalid|country|HS code|dangerous|restricted|declared value|parcel numbers|assign the full|no order lines|confirmed|cancelled|already fulfilled|not ready to ship|missing/i.test(message);
    if (!validation) await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_shipping', operation, title: 'Shipment editor request failed',
      error: new Error('Shipment editor operation failed.'),
      context: { shipmentId, errorType: error instanceof Error ? error.name : 'unknown' },
      reference: { type: 'shipping_shipment', id: shipmentId },
    });
    return NextResponse.json({
      success: false, error: validation ? message || 'Invalid shipment details.' : 'Unable to complete the shipment editor request.',
    }, { status: validation ? 400 : 502 });
  }
}
