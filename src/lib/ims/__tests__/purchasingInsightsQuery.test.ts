import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { loadPurchaseOrderAging, loadReorderForecast } from '../purchasingInsightsQuery';

describe('purchasing insights queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds reorder suggestions from tenant-owned cache data using the shared formula', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      product_id: 'p-1', product_name: 'Jacket', brand: 'North', variant_id: 'v-1', sku: 'JKT-1',
      pack_size: 6, cost_aud: 20, created_at: null, supplier_contact_id: 7, supplier_name: 'Supply Co',
      lead_time_days: 14, total_soh: 10, total_available: 8, total_incoming: 10, sales_quantity: 90,
    }]);

    const result = await loadReorderForecast({
      businessId: 'biz-1', filterType: 'supplier', filterValue: 'Supply', salesWindowDays: 90,
      orderFrequencyDays: 30, now: Date.parse('2026-09-05T00:00:00Z'),
    });

    expect(mockImsQuery.mock.calls[0][0]).toContain('sc.sales_qty_90d');
    expect(mockImsQuery.mock.calls[0][0]).toContain('p.business_id = ?');
    expect(mockImsQuery.mock.calls[0][0]).toContain('v.business_id = ?');
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 'biz-1', 'biz-1', '%supply%']);
    expect(result).toEqual({
      rows: [expect.objectContaining({
        product: 'Jacket', supplier: 'Supply Co', averageDailySales: 1, coverageDays: 44,
        suggestedQuantity: 26, reorderQuantity: 24, unitCostExTaxAud: 20,
        estimatedValueExTaxAud: 480,
      })],
      totalMatchingSuggestions: 1,
      truncated: false,
    });
  });

  it('returns only bounded overdue open POs with outstanding quantities', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      id: 12, po_number: 'PO-12', status: 'partially_received', supplier_name: 'Supply Co',
      location_id: 4, location_name: 'Main', order_date: '2026-07-01', expected_date: '2026-08-20',
      age_days: 66, days_overdue: 16, outstanding_quantity: '8', outstanding_value_ex_tax: '160',
      currency_code: 'AUD', exchange_rate: '1',
    }]);

    const result = await loadPurchaseOrderAging({
      businessId: 'biz-1', mode: 'overdue', supplierSearch: 'Supply', dueSoonDays: 14, limit: 30,
    });

    expect(mockImsQuery.mock.calls[0][0]).toContain("po.status IN ('confirmed', 'partially_received', 'backordered')");
    expect(mockImsQuery.mock.calls[0][0]).toContain('po.expected_date < CURDATE()');
    expect(mockImsQuery.mock.calls[0][0]).toContain('HAVING outstanding_quantity > 0');
    expect(mockImsQuery.mock.calls[0][1]).toEqual([
      'biz-1', 'biz-1', 'biz-1', 'biz-1', '%supply%', 31,
    ]);
    expect(result).toEqual({
      rows: [expect.objectContaining({
        purchaseOrderId: 12, purchaseOrder: 'PO-12', supplier: 'Supply Co',
        daysOverdue: 16, outstandingQuantity: 8, outstandingValueExTax: 160,
      })],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/email|phone|notes|invoice/i);
  });
});
