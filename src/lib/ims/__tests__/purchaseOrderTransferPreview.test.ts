import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ execute })),
}));

import { previewPurchaseOrderTransfer } from '../orderTransfers/purchaseOrderPreview';

const source = {
  id: 10, po_number: 'PO-10', business_id: 'biz-1', supplier_id: 7, supplier_name: 'Supply Co',
  location_id: 3, location_name: 'Warehouse', order_date: '2026-09-01', status: 'confirmed',
  currency_code: 'AUD', exchange_rate: 1, tax_treatment: 'inc_tax', tax_code: 'INPUT',
  payment_terms: '30 days', supplier_invoice_number: null, is_historical: 0, cin7_order_id: null,
  xero_bill_id: null, has_payments: 0, outstanding_quantity: 7, updated_at: '2026-09-01T00:00:00.000Z',
};

describe('previewPurchaseOrderTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let orderQuery = 0;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_purchase_orders po')) {
        orderQuery++;
        return orderQuery === 1 ? [[source]] : [[
          { ...source, id: 20, po_number: 'PO-20', outstanding_quantity: 2 },
          { ...source, id: 30, po_number: 'PO-30', supplier_id: 9, supplier_name: 'Other Supplier' },
        ]];
      }
      if (sql.includes('FROM ims_purchase_order_items item')) return [[{
        id: 101, variant_id: 'variant-1', qty_ordered: 10, qty_received: 3,
        is_stock_item: 1, sku: 'SKU-1', product_name: 'Blue Shirt',
      }]];
      if (sql.includes('FROM ims_stock_allocations allocation')) return [[
        { id: 501, revision: 2, po_item_id: 101, so_id: 40, so_item_id: 401,
          qty_allocated: 4, qty_received_assigned: 1, promised_date: '2026-10-01', priority: 10,
          promise_status: 'confirmed', so_number: 'SO-40', customer_name: 'Customer A' },
        { id: 502, revision: 1, po_item_id: 101, so_id: 41, so_item_id: 411,
          qty_allocated: 2, qty_received_assigned: 0, promised_date: null, priority: 20,
          promise_status: 'planned', so_number: 'SO-41', customer_name: 'Customer B' },
      ]];
      return [[]];
    });
  });

  it('separates free outstanding supply from individually selectable customer promises', async () => {
    const result = await previewPurchaseOrderTransfer({ businessId: 'biz-1', sourceOrderId: 10 });

    expect(result.source).toEqual(expect.objectContaining({ orderNumber: 'PO-10', conflicts: [] }));
    expect(result.lines).toEqual([expect.objectContaining({
      itemId: 101,
      outstandingQuantity: 7,
      protectedQuantity: 5,
      freeQuantity: 2,
      allocations: [
        expect.objectContaining({ allocationId: 501, revision: 2, salesOrderNumber: 'SO-40', movableQuantity: 3 }),
        expect.objectContaining({ allocationId: 502, revision: 1, salesOrderNumber: 'SO-41', movableQuantity: 2 }),
      ],
    })]);
    expect(result.eligibleTargets.map(target => target.id)).toEqual([20]);
    expect(result.excludedTargets[0]).toEqual(expect.objectContaining({
      id: 30,
      conflicts: expect.arrayContaining(['Supplier does not match.']),
    }));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('allocation.business_id = ?'),
      ['biz-1', 10, 101]);
  });
});