import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { loadStockAllocationSuggestions } from '../stockAllocation/suggestionService';

describe('loadStockAllocationSuggestions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('suggests free incoming supply by required date before order age', async () => {
    mockImsQuery
      .mockResolvedValueOnce([
        {
          so_id: 10, so_item_id: 11, so_number: 'SO-10', customer_name: 'Older customer',
          location_id: 4, location_name: 'Main', expected_date: '2026-10-20', created_at: '2026-09-01T00:00:00Z',
          variant_id: 'variant-1', sku: 'SKU-1', product_name: 'Product', qty_ordered: 4, qty_fulfilled: 0,
          qty_allocated: 0, allocation_qty_fulfilled: 0,
        },
        {
          so_id: 12, so_item_id: 13, so_number: 'SO-12', customer_name: 'Required first',
          location_id: 4, location_name: 'Main', expected_date: '2026-10-10', created_at: '2026-10-01T00:00:00Z',
          variant_id: 'variant-1', sku: 'SKU-1', product_name: 'Product', qty_ordered: 4, qty_fulfilled: 0,
          qty_allocated: 0, allocation_qty_fulfilled: 0,
        },
        {
          so_id: 14, so_item_id: 15, so_number: 'SO-14', customer_name: 'Different product',
          location_id: 4, location_name: 'Main', expected_date: '2026-10-30', created_at: '2026-10-02T00:00:00Z',
          variant_id: 'variant-2', sku: 'SKU-2', product_name: 'Other product', qty_ordered: 1, qty_fulfilled: 0,
          qty_allocated: 0, allocation_qty_fulfilled: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          po_id: 20, po_item_id: 21, po_number: 'PO-20', supplier_name: 'Supplier',
          variant_id: 'variant-1', location_id: 4, qty_ordered: 6, qty_received: 0,
          active_allocated_quantity: 0, expected_date: '2026-10-08', status: 'confirmed',
        },
        {
          po_id: 22, po_item_id: 23, po_number: 'PO-22', supplier_name: 'Supplier',
          variant_id: 'variant-2', location_id: 4, qty_ordered: 1, qty_received: 0,
          active_allocated_quantity: 0, expected_date: '2026-10-09', status: 'confirmed',
        },
      ]);

    await expect(loadStockAllocationSuggestions('biz-1')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ soItemId: 13, soNumber: 'SO-12', poItemId: 21, quantity: 4, priorityPosition: 1 }),
      expect.objectContaining({ soItemId: 11, soNumber: 'SO-10', poItemId: 21, quantity: 2, priorityPosition: 2 }),
      expect.objectContaining({ soItemId: 15, soNumber: 'SO-14', poItemId: 23, quantity: 1, priorityPosition: 1 }),
    ]));
    expect(mockImsQuery.mock.calls[1][1]).toEqual(['biz-1', 'biz-1']);
  });
});