import { reconcileShippingAmendment } from '@/lib/ims/shipping/shippingAmendments';
import { shippingAmendmentRoute } from '../amendmentRoute';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return shippingAmendmentRoute(params.id, 'reconcile_shipment_amendment', true, reconcileShippingAmendment);
}
