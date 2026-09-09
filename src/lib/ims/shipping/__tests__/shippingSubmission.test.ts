import { describe, expect, it } from 'vitest';

import { buildAusPostDomesticShipment, getAusPostLabelPreference, validateSelectedShippingRate } from '../shippingSubmission';

const shipment = {
  id: 91,
  so_id: 12,
  so_number: 'ONL-20260908-528728',
  channel_order_number: '#47908',
  carrier_account_id: 1,
  provider: 'auspost_eparcel',
  status: 'draft',
  provider_shipment_id: null,
  provider_reference: 'ONL-20260908-528728-operation',
  service_code: 'T28',
  service_name: 'Parcel Post',
  quoted_cost: 12.5,
  sender_json: JSON.stringify({ name: 'Warehouse', lines: ['1 Main St'], suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'AU' }),
  recipient_json: { name: 'Buyer', lines: ['2 High St'], suburb: 'Melbourne', state: 'VIC', postcode: '3000', country: 'AU', email: 'buyer@example.com' },
};

describe('Australia Post shipment submission', () => {
  it('maps a saved shipment and parcels to the domestic shipment contract', () => {
    expect(buildAusPostDomesticShipment(shipment, [{
      id: 101, parcel_number: 1, length_mm: 205, width_mm: 150, height_mm: 99, weight_kg: 1.25,
    }])).toEqual({
      shipment_reference: 'ONL-20260908-528728-operation',
      customer_reference_1: 'ONL-20260908-528728',
      customer_reference_2: '#47908',
      contains_s8_goods: false,
      from: { name: 'Warehouse', lines: ['1 Main St'], suburb: 'Sydney', state: 'NSW', postcode: '2000' },
      to: { name: 'Buyer', lines: ['2 High St'], suburb: 'Melbourne', state: 'VIC', postcode: '3000', email: 'buyer@example.com' },
      items: [{
        item_reference: 'ONL-20260908-528728 #47908 P1', product_id: 'T28', length: 20.5, width: 15, height: 9.9,
        weight: 1.25, authority_to_leave: false, allow_partial_delivery: true,
      }],
    });
  });

  it('uses carrier-supported compact A4 layouts for Parcel and Express Post', () => {
    expect(getAusPostLabelPreference('Parcel Post')).toEqual({ group: 'Parcel Post', layout: 'A4-4pp' });
    expect(getAusPostLabelPreference('Express Post')).toEqual({ group: 'Express Post', layout: 'A4-3pp' });
  });

  it('requires the selected service and reviewed price to match a live carrier quote', () => {
    expect(() => validateSelectedShippingRate(shipment, [{ serviceCode: 'T28', total: 12.5 }])).not.toThrow();
    expect(() => validateSelectedShippingRate(shipment, [{ serviceCode: 'T28', total: 13 }])).toThrow('shipping price changed');
    expect(() => validateSelectedShippingRate(shipment, [{ serviceCode: 'EXP', total: 12.5 }])).toThrow('no longer available');
  });
});