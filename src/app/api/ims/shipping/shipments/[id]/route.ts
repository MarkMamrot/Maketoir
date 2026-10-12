import { amendShippingShipment, getShippingEditableDetail } from '@/lib/ims/shipping/shippingAmendments';
import { ShippingAmendmentError } from '@/lib/ims/shipping/shippingAmendmentPolicy';
import { shippingAmendmentRoute } from './amendmentRoute';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return shippingAmendmentRoute(params.id, 'get_shipment_details', false, getShippingEditableDetail);
}
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return shippingAmendmentRoute(params.id, 'amend_shipment', true, async (businessId, shipmentId) => {
    const input = await request.json();
    if (!input?.service) throw new ShippingAmendmentError('Choose a reviewed postage service before saving shipment details.');
    return amendShippingShipment(businessId, shipmentId, input);
  });
}
