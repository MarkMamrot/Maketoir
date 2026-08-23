import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { executeAssistantTool, getAssistantToolDefinitions } from '../tools';

describe('assistant tool policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives separate tool lists for each verified audience', () => {
    expect(getAssistantToolDefinitions('wholesale').map(tool => tool.name)).toEqual([
      'wholesale_catalogue_lookup', 'wholesale_order_summary', 'wholesale_account_summary',
    ]);
    expect(getAssistantToolDefinitions('pos').some(tool => tool.name.startsWith('ims_'))).toBe(false);
    expect(getAssistantToolDefinitions('ims').map(tool => tool.name)).toEqual([
      'ims_product_lookup', 'ims_order_summary', 'ims_order_search', 'ims_stock_alerts',
    ]);
  });

  it('rejects a forged cross-audience tool name before querying', async () => {
    await expect(executeAssistantTool({
      audience: 'wholesale', businessId: 'biz-1', contactId: 1, companyId: 2,
      locationId: 3, memberId: 4, memberRole: 'buyer', brandAccess: { mode: 'all', brands: [] },
    }, 'ims_order_summary', { reference: 'SO-1' })).rejects.toThrow('not available');
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('keeps POS product lookup bound to the verified location and business', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await executeAssistantTool({
      audience: 'pos', businessId: 'biz-1', posUserId: 7, locationId: 9,
      locationName: 'Main', registerId: 2, registerName: 'Front', tier: 'PosUser',
    }, 'pos_product_lookup', { search: 'shirt' });
    expect(mockImsQuery.mock.calls[0][1].slice(0, 2)).toEqual([9, 'biz-1']);
  });

  it('applies selected wholesale brand access to catalogue queries', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await executeAssistantTool({
      audience: 'wholesale', businessId: 'biz-1', contactId: 1, companyId: 2,
      locationId: 3, memberId: 4, memberRole: 'buyer', brandAccess: { mode: 'selected', brands: ['Allowed Brand'] },
    }, 'wholesale_catalogue_lookup', { search: 'shirt' });
    expect(mockImsQuery.mock.calls[0][0]).toContain('LOWER(TRIM(p.brand)) IN (?)');
    expect(mockImsQuery.mock.calls[0][1]).toContain('allowed brand');
  });

  it('returns bounded sales-order lines using the verified business on both queries', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{
        id: 12, reference: 'SO-12', shopify_order_name: '#1042', status: 'fulfilled',
        order_date: '2026-08-22', total_amount: 39.95, so_type: 'online', sales_channel: 'shopify',
        location: 'Main', refunded_amount: 0,
      }])
      .mockResolvedValueOnce([{
        order_id: 12, product: 'Shopify Misc Charge', sku: 'SHOPIFY-MISC', qty_ordered: 1,
        qty_fulfilled: 1, unit_price: 39.95, line_total: 39.95, notes: 'Limited Edition Tote',
      }]);

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_order_summary', { orderType: 'sales', reference: '#1042' }) as any[];

    expect(mockImsQuery.mock.calls[0][1][0]).toBe('biz-1');
    expect(mockImsQuery.mock.calls[1][1][0]).toBe('biz-1');
    expect(mockImsQuery.mock.calls[1][0]).toContain('LIMIT 40');
    expect(result[0].items[0]).toMatchObject({ sku: 'SHOPIFY-MISC', sourceLineTitle: 'Limited Edition Tote' });
  });

  it('bounds recent order research and keeps it business scoped', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_order_search', { orderType: 'sales', status: 'open', channel: 'online', days: 999 });

    expect(mockImsQuery.mock.calls[0][0]).toContain('LIMIT 20');
    expect(mockImsQuery.mock.calls[0][0]).toContain("so.status NOT IN ('fulfilled','cancelled')");
    expect(mockImsQuery.mock.calls[0][0]).toContain("so.so_type = 'online'");
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 90]);
  });

  it('returns only bounded stock exceptions for the verified business', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_stock_alerts', { mode: 'low', threshold: 8 });

    expect(mockImsQuery.mock.calls[0][0]).toContain('HAVING available <= ?');
    expect(mockImsQuery.mock.calls[0][0]).toContain('LIMIT 20');
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 8]);
  });
});