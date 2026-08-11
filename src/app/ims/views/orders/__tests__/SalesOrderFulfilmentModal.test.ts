import { describe, expect, it } from 'vitest';
import { buildSalesOrderFulfilmentRequest } from '../SalesOrderFulfilmentModal';

describe('buildSalesOrderFulfilmentRequest', () => {
  it('uses the partial fulfilment route for partial shipments', () => {
    const payload = buildSalesOrderFulfilmentRequest('partial', 42, [{ itemId: 7, quantity: 3 }]);

    expect(payload).toEqual({
      endpoint: '/api/ims/sales-orders/42/fulfil',
      body: { shipmentQuantities: [{ itemId: 7, quantity: 3 }] },
    });
  });

  it('uses the backorder route for backorder splits', () => {
    const payload = buildSalesOrderFulfilmentRequest('backorder', 42, [{ itemId: 7, quantity: 3 }]);

    expect(payload).toEqual({
      endpoint: '/api/ims/sales-orders/42/backorder',
      body: { fulfilQuantities: [{ itemId: 7, quantity: 3 }] },
    });
  });
});
