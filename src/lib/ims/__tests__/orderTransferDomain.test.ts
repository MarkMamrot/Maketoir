import { describe, expect, it } from 'vitest';
import {
  calculateOrderTransferQuantityRules,
  getOrderTransferConflicts,
  type OrderTransferDocument,
} from '../orderTransfers/domain';

describe('order transfer quantity rules', () => {
  it('offers bounded presets across ready, allocated, and unsourced quantities', () => {
    expect(calculateOrderTransferQuantityRules({
      orderedQuantity: 10,
      processedQuantity: 2,
      readyQuantity: 3,
      allocatedIncomingQuantity: 4,
    })).toEqual({
      outstanding: 8,
      unavailableNow: 5,
      readyNow: 3,
      allocatedIncoming: 4,
      unallocatedShortage: 1,
    });
  });

  it('does not count incoming allocation against quantity already ready now', () => {
    expect(calculateOrderTransferQuantityRules({
      orderedQuantity: 5,
      processedQuantity: 0,
      readyQuantity: 4,
      allocatedIncomingQuantity: 4,
    })).toEqual({
      outstanding: 5,
      unavailableNow: 1,
      readyNow: 4,
      allocatedIncoming: 1,
      unallocatedShortage: 0,
    });
  });

  it('conserves four-decimal quantities and caps every rule at outstanding', () => {
    expect(calculateOrderTransferQuantityRules({
      orderedQuantity: 3.3333,
      processedQuantity: 1.1111,
      readyQuantity: 9,
      allocatedIncomingQuantity: 9,
    })).toEqual({
      outstanding: 2.2222,
      unavailableNow: 0,
      readyNow: 2.2222,
      allocatedIncoming: 0,
      unallocatedShortage: 0,
    });
  });

  it('rejects negative, non-finite, and over-processed inputs', () => {
    expect(() => calculateOrderTransferQuantityRules({
      orderedQuantity: 1,
      processedQuantity: 2,
      readyQuantity: 0,
      allocatedIncomingQuantity: 0,
    })).toThrow('cannot exceed');
    expect(() => calculateOrderTransferQuantityRules({
      orderedQuantity: 1,
      processedQuantity: 0,
      readyQuantity: -1,
      allocatedIncomingQuantity: 0,
    })).toThrow('cannot be negative');
    expect(() => calculateOrderTransferQuantityRules({
      orderedQuantity: Number.NaN,
      processedQuantity: 0,
      readyQuantity: 0,
      allocatedIncomingQuantity: 0,
    })).toThrow('finite number');
  });
});

describe('order transfer compatibility', () => {
  const source: OrderTransferDocument = {
    id: 1,
    kind: 'sales_order',
    businessId: 'business-1',
    contactId: 10,
    locationId: 3,
    currencyCode: 'aud',
    exchangeRate: 1,
    taxTreatment: 'inc_tax',
    taxCode: 'OUTPUT',
    paymentTerms: 'Net 30',
    priceTier: 'wholesale',
    status: 'partially_fulfilled',
  };

  it('allows commercially matching open orders, including partially processed sources', () => {
    expect(getOrderTransferConflicts(source, {
      ...source,
      id: 2,
      currencyCode: 'AUD',
      status: 'backordered',
    })).toEqual([]);
  });

  it('returns every reason an existing destination cannot be selected', () => {
    expect(getOrderTransferConflicts(source, {
      ...source,
      id: 2,
      contactId: 11,
      locationId: 4,
      status: 'fulfilled',
      hasPayments: true,
      xeroDocumentId: 'invoice-1',
      xeroDocumentStatus: 'AUTHORISED',
      hasSubmittedShipment: true,
      commerciallyEditable: false,
    })).toEqual([
      'Customer does not match.',
      'Location does not match.',
      'Destination order is not open.',
      'Destination order has payments.',
      'Destination order has a non-Draft Xero document.',
      'Destination order has a submitted shipment.',
      'Destination order is controlled by an external channel.',
    ]);
  });

  it('rejects cross-type and cross-tenant movement', () => {
    expect(getOrderTransferConflicts(source, {
      ...source,
      id: 2,
      kind: 'purchase_order',
      businessId: 'business-2',
      status: 'confirmed',
    })).toEqual(expect.arrayContaining([
      'Source and destination must be the same order type.',
      'Source and destination belong to different businesses.',
    ]));
  });
});