import { describe, expect, it } from 'vitest';

import {
  canTransitionShippingShipment,
  getAusPostLabelBatchLimit,
  getShippingOrderEligibility,
  splitAusPostLabelBatch,
  validateShippingParcels,
} from '../shippingWorkflow';

describe('shipping workflow', () => {
  it('allows confirmed and partially fulfilled online or wholesale orders with remaining quantities', () => {
    expect(getShippingOrderEligibility({ status: 'confirmed', soType: 'online', remainingQuantity: 2 })).toEqual({ eligible: true });
    expect(getShippingOrderEligibility({ status: 'partially_fulfilled', soType: 'b2b', remainingQuantity: 0.5 })).toEqual({ eligible: true });
  });

  it('rejects POS, draft, completed, and empty orders with actionable reasons', () => {
    expect(getShippingOrderEligibility({ status: 'confirmed', soType: 'online', isPosLedger: true, remainingQuantity: 1 })).toEqual({
      eligible: false,
      reason: 'POS sales cannot be shipped from Sales Orders.',
    });
    expect(getShippingOrderEligibility({ status: 'draft', soType: 'b2b', remainingQuantity: 1 }).eligible).toBe(false);
    expect(getShippingOrderEligibility({ status: 'fulfilled', soType: 'online', remainingQuantity: 1 }).eligible).toBe(false);
    expect(getShippingOrderEligibility({ status: 'confirmed', soType: 'online', remainingQuantity: 0 })).toEqual({
      eligible: false,
      reason: 'This order has no remaining quantity.',
    });
  });

  it('permits only resumable forward shipment transitions and terminal manifest or void states', () => {
    expect(canTransitionShippingShipment('draft', 'quoting')).toBe(true);
    expect(canTransitionShippingShipment('label_ready', 'ims_fulfilled')).toBe(true);
    expect(canTransitionShippingShipment('complete', 'manifested')).toBe(true);
    expect(canTransitionShippingShipment('manifested', 'voided')).toBe(false);
    expect(canTransitionShippingShipment('ims_fulfilled', 'voided')).toBe(false);
  });

  it('accepts fractional line allocations and rejects over-allocation or invalid parcels', () => {
    expect(validateShippingParcels(
      [{ soItemId: 10, remainingQuantity: 1.5 }],
      [{ parcelNumber: 1, lengthMm: 200, widthMm: 150, heightMm: 100, weightKg: 0.8, allocations: [{ soItemId: 10, quantity: 1.5 }] }],
    )).toEqual([]);

    expect(validateShippingParcels(
      [{ soItemId: 10, remainingQuantity: 1 }],
      [{ parcelNumber: 1, lengthMm: 0, widthMm: 150, heightMm: 100, weightKg: 0.8, allocations: [{ soItemId: 10, quantity: 2 }] }],
    )).toEqual([
      'Parcel 1 requires positive dimensions and weight.',
      'Allocated quantity exceeds the remaining quantity for order line 10.',
    ]);
  });

  it('enforces Australia Post synchronous PDF and ZPL label limits', () => {
    expect(getAusPostLabelBatchLimit('PDF', true)).toBe(250);
    expect(getAusPostLabelBatchLimit('PDF', false)).toBeNull();
    expect(getAusPostLabelBatchLimit('ZPL', false)).toBe(50);
    expect(splitAusPostLabelBatch(Array.from({ length: 101 }, (_, index) => index), 'ZPL', true).map(batch => batch.length))
      .toEqual([50, 50, 1]);
  });
});