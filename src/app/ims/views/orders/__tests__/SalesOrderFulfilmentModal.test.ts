import { describe, expect, it } from 'vitest';
import { buildSalesOrderFulfilmentOperationKey, buildSalesOrderFulfilmentRequest, summarizeFulfilmentAllocations } from '../salesOrderFulfilmentRequest';

describe('buildSalesOrderFulfilmentRequest', () => {
  it('summarizes active protection as ready and incoming after prior shipments', () => {
    const result = summarizeFulfilmentAllocations([
      { so_item_id: 7, qty_allocated: 5, qty_received_assigned: 3, qty_fulfilled: 1, state: 'active' },
      { so_item_id: 7, qty_allocated: 2, qty_received_assigned: 0, qty_fulfilled: 0, state: 'active' },
      { so_item_id: 7, qty_allocated: 4, qty_received_assigned: 4, qty_fulfilled: 4, state: 'fulfilled' },
    ]);

    expect(result.get(7)).toEqual({ protected: 6, ready: 2, incoming: 4 });
  });

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

  it('builds the same key for manual retries and canonical line ordering', async () => {
    const first = await buildSalesOrderFulfilmentOperationKey('partial', 42, '2026-08-12T01:02:03.000Z', [
      { itemId: 9, quantity: 1.25 },
      { itemId: 7, quantity: 3 },
    ]);
    const retry = await buildSalesOrderFulfilmentOperationKey('partial', 42, '2026-08-12T01:02:03.000Z', [
      { itemId: 7, quantity: 3 },
      { itemId: 9, quantity: 1.25 },
    ]);

    expect(retry).toBe(first);
    expect(first).toMatch(/^sales_order:42:partial:revision_request:[a-f0-9]{64}$/);
  });

  it('changes the key when mode, loaded revision, or quantities change', async () => {
    const base = await buildSalesOrderFulfilmentOperationKey('partial', 42, 'revision-1', [{ itemId: 7, quantity: 3 }]);

    await expect(buildSalesOrderFulfilmentOperationKey('backorder', 42, 'revision-1', [{ itemId: 7, quantity: 3 }])).resolves.not.toBe(base);
    await expect(buildSalesOrderFulfilmentOperationKey('partial', 42, 'revision-2', [{ itemId: 7, quantity: 3 }])).resolves.not.toBe(base);
    await expect(buildSalesOrderFulfilmentOperationKey('partial', 42, 'revision-1', [{ itemId: 7, quantity: 2 }])).resolves.not.toBe(base);
  });
});
