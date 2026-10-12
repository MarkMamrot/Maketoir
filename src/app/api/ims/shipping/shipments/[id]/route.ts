import { amendShippingShipment, getShippingEditableDetail } from '@/lib/ims/shipping/shippingAmendments';
import { shippingAmendmentRoute } from './amendmentRoute';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return shippingAmendmentRoute(params.id, 'get_shipment_details', false, getShippingEditableDetail);
}
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return shippingAmendmentRoute(params.id, 'amend_shipment', true, async (businessId, shipmentId) =>
    amendShippingShipment(businessId, shipmentId, await request.json()));
}
