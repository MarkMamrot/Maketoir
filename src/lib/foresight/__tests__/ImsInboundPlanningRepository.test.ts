import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockRunImsForBusiness } = vi.hoisted(() => ({ mockImsQuery: vi.fn(), mockRunImsForBusiness: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));

import { ImsInboundPlanningRepository } from '../repositories/ImsInboundPlanningRepository';

describe('ImsInboundPlanningRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mockImsQuery.mockResolvedValue([{
      po_id: 19, po_number: 'PO-0019', status: 'partially_received', order_date: '2026-07-20',
      expected_date: '2026-08-10', supplier_name: 'Supplier', variant_id: 'variant-1', sku: 'SKU-1',
      product_name: 'Music Box', variant_label: '', qty_ordered: '12', qty_received: '5',
      qty_outstanding: '7', updated_at: '2026-08-01 10:00:00',
    }]);
  });

  it('runs in explicit tenant context and returns only outstanding open inbound lines', async () => {
    const rows = await ImsInboundPlanningRepository.listOpenInbound('business-1', 30);
    const sql = String(mockImsQuery.mock.calls[0][0]);

    expect(mockRunImsForBusiness).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(sql).toContain("po.status IN ('confirmed', 'partially_received')");
    expect(sql).toContain('item.qty_ordered > item.qty_received');
    expect(sql).toContain('LIMIT 30');
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['business-1', 'business-1', 'business-1', 'business-1']);
    expect(rows[0]).toMatchObject({ purchaseOrderId: 19, quantityOutstanding: 7, variantLabel: 'Default' });
  });
});