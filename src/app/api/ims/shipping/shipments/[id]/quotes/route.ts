import { quoteShippingAmendment } from '@/lib/ims/shipping/shippingAmendments';
import { shippingAmendmentRoute } from '../amendmentRoute';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return shippingAmendmentRoute(params.id, 'quote_shipment_amendment', true, async (businessId, shipmentId) =>
    quoteShippingAmendment(businessId, shipmentId, await request.json()));
}
