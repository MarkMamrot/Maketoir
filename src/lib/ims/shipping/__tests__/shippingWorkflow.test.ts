import { describe, expect, it } from 'vitest';

import {
  canDeleteShippingDraft,
  canTransitionShippingShipment,
  getAusPostLabelBatchLimit,
  getShippingOrderEligibility,
  splitAusPostLabelBatch,
  validateManifestCandidates,
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
    expect(getShippingOrderEligibility({ status: 'confirmed', soType: 'online', channelDeliveryType: 'pickup', remainingQuantity: 1 })).toEqual({
      eligible: false,
      reason: 'Pickup orders do not require carrier shipping.',
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

  it('only deletes local drafts that have not reached a carrier', () => {
    expect(canDeleteShippingDraft('draft', null)).toBe(true);
    expect(canDeleteShippingDraft('quoting', null)).toBe(true);
    expect(canDeleteShippingDraft('failed', null)).toBe(true);
    expect(canDeleteShippingDraft('failed', 'carrier-123')).toBe(false);
    expect(canDeleteShippingDraft('carrier_created', null)).toBe(false);
    expect(canDeleteShippingDraft('label_ready', 'carrier-123')).toBe(false);
  });

  it('groups manifests by carrier account and dispatch location after dispatch', () => {
    const candidate = {
      shipmentId: 1, carrierAccountId: 2, dispatchLocationId: 3, provider: 'auspost_eparcel',
      providerShipmentId: 'AP-SHIP-1', shipmentStatus: 'channel_pending', labelStatus: 'available',
      imsFulfilledAt: '2026-09-09 01:00:00', manifestId: null, parcelCount: 1,
    };
    expect(validateManifestCandidates([candidate])).toEqual([]);
    expect(validateManifestCandidates([candidate, { ...candidate, shipmentId: 2, dispatchLocationId: 4 }]))
      .toContain('Choose shipments from one dispatch location.');
    expect(validateManifestCandidates([{ ...candidate, imsFulfilledAt: null }]))
      .toContain('Every shipment must be marked dispatched.');
    expect(validateManifestCandidates([{ ...candidate, manifestId: 8 }]))
      .toContain('A shipment is already included in a manifest.');
  });

  it('enforces the Australia Post 2,000 parcel manifest limit', () => {
    const candidate = {
      shipmentId: 1, carrierAccountId: 2, dispatchLocationId: 3, provider: 'auspost_eparcel',
      providerShipmentId: 'AP-SHIP-1', shipmentStatus: 'complete', labelStatus: 'available',
      imsFulfilledAt: '2026-09-09 01:00:00', manifestId: null, parcelCount: 2001,
    };
    expect(validateManifestCandidates([candidate])).toContain('Australia Post manifests can contain no more than 2000 parcels.');
    expect(validateManifestCandidates([{ ...candidate, parcelCount: 2000 }])).toEqual([]);
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

  it('rejects an order line that is missing or only partly assigned to parcels', () => {
    expect(validateShippingParcels(
      [{ soItemId: 10, remainingQuantity: 2 }, { soItemId: 11, remainingQuantity: 1 }],
      [{ parcelNumber: 1, lengthMm: 200, widthMm: 150, heightMm: 100, weightKg: 0.8, allocations: [{ soItemId: 10, quantity: 1 }] }],
    )).toEqual([
      'Assign the full remaining quantity for order line 10 to a parcel.',
      'Assign the full remaining quantity for order line 11 to a parcel.',
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