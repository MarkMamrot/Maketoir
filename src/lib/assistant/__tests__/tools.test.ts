import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockImsQuery,
  mockLoadAssistantSalesPerformance,
  mockLoadReorderForecast,
  mockLoadPurchaseOrderAging,
  mockLoadXeroDiagnostics,
  mockLoadShopifyDiagnostics,
  mockAssertXeroAccountingEnabled,
  mockAssertShopifyEnabled,
  mockLoadPosRegisterStatus,
  mockLoadPosRecentTransactions,
  mockGetBusinessFeatureFlags,
  mockGetBusinessTimeZone,
  mockLoadAssistantMarketingPerformance,
  mockLoadAssistantMarketingRecommendations,
} = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockLoadAssistantSalesPerformance: vi.fn(),
  mockLoadReorderForecast: vi.fn(),
  mockLoadPurchaseOrderAging: vi.fn(),
  mockLoadXeroDiagnostics: vi.fn(),
  mockLoadShopifyDiagnostics: vi.fn(),
  mockAssertXeroAccountingEnabled: vi.fn(),
  mockAssertShopifyEnabled: vi.fn(),
  mockLoadPosRegisterStatus: vi.fn(),
  mockLoadPosRecentTransactions: vi.fn(),
  mockGetBusinessFeatureFlags: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
  mockLoadAssistantMarketingPerformance: vi.fn(),
  mockLoadAssistantMarketingRecommendations: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/ims/salesSummaryQuery', () => ({ loadAssistantSalesPerformance: mockLoadAssistantSalesPerformance }));
vi.mock('@/lib/ims/purchasingInsightsQuery', () => ({
  loadReorderForecast: mockLoadReorderForecast,
  loadPurchaseOrderAging: mockLoadPurchaseOrderAging,
}));
vi.mock('@/lib/ims/integrationDiagnostics', () => ({
  loadXeroDiagnostics: mockLoadXeroDiagnostics,
  loadShopifyDiagnostics: mockLoadShopifyDiagnostics,
}));
vi.mock('@/lib/ims/businessOperations', () => ({
  assertXeroAccountingEnabled: mockAssertXeroAccountingEnabled,
  assertShopifyEnabled: mockAssertShopifyEnabled,
  isXeroAccountingDisabledError: (error: unknown) => error instanceof Error && error.message === 'Xero disabled',
  isOnlineChannelDisabledError: (error: unknown) => error instanceof Error && error.message === 'Shopify disabled',
}));
vi.mock('@/lib/pos/assistantOperations', () => ({
  loadPosRegisterStatus: mockLoadPosRegisterStatus,
  loadPosRecentTransactions: mockLoadPosRecentTransactions,
}));
vi.mock('@/lib/businessFeatures', () => ({ getBusinessFeatureFlags: mockGetBusinessFeatureFlags }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));
vi.mock('@/lib/foresight/assistantInsights', () => ({
  loadAssistantMarketingPerformance: mockLoadAssistantMarketingPerformance,
  loadAssistantMarketingRecommendations: mockLoadAssistantMarketingRecommendations,
}));

import { executeAssistantTool, getAssistantToolDefinitions } from '../tools';

describe('assistant tool policy', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockGetBusinessFeatureFlags.mockResolvedValue({ 'foresight.marketing': true });
    mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
  });

  it('derives separate tool lists for each verified audience', () => {
    const wholesale = {
      audience: 'wholesale' as const, businessId: 'biz-1', contactId: 1, companyId: 2,
      locationId: 3, memberId: 4, memberRole: 'buyer' as const, brandAccess: { mode: 'all' as const, brands: [] },
    };
    const pos = {
      audience: 'pos' as const, businessId: 'biz-1', posUserId: 7, locationId: 9,
      locationName: 'Main', registerId: 2, registerName: 'Front', tier: 'PosUser' as const,
    };
    const ims = { audience: 'ims' as const, businessId: 'biz-1', userId: 7, tier: 'Admin' as const };
    expect(getAssistantToolDefinitions(wholesale).map(tool => tool.name)).toEqual([
      'wholesale_catalogue_lookup', 'wholesale_order_summary', 'wholesale_account_summary',
    ]);
    expect(getAssistantToolDefinitions(pos).some(tool => tool.name.startsWith('ims_'))).toBe(false);
    expect(getAssistantToolDefinitions(ims, {
      xero: true, shopify: true, 'foresight.marketing': true,
    }).map(tool => tool.name)).toEqual([
      'ims_product_lookup', 'ims_order_summary', 'ims_order_search', 'ims_stock_alerts',
      'ims_inventory_position', 'ims_stock_movement_history',
      'ims_stock_allocation_exceptions', 'ims_customer_lookup', 'ims_customer_activity',
      'ims_sales_performance', 'ims_reorder_forecast', 'ims_purchase_order_aging',
      'ims_xero_sync_diagnostics', 'ims_shopify_sync_diagnostics',
      'ims_marketing_performance', 'ims_marketing_recommendations',
    ]);
  });

  it('feature-gates and bounds governed marketing performance for the verified business', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T01:00:00Z'));
    mockLoadAssistantMarketingPerformance.mockResolvedValueOnce({ paidMedia: [], commerce: [], quality: { grade: 'good', issues: [] } });

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_marketing_performance', { days: 999 }) as any;

    expect(mockGetBusinessFeatureFlags).toHaveBeenCalledWith('biz-1');
    expect(mockGetBusinessTimeZone).toHaveBeenCalledWith('biz-1');
    expect(mockLoadAssistantMarketingPerformance).toHaveBeenCalledWith({
      businessId: 'biz-1', fromDate: '2026-06-08', toDate: '2026-09-05',
    });
    expect(result.days).toBe(90);
    expect(result.scope).toContain('no advertising platform was contacted live');
  });

  it('returns only requested stored recommendation states and performs no mutation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T01:00:00Z'));
    mockLoadAssistantMarketingRecommendations.mockResolvedValueOnce({ rows: [], truncated: false });

    await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'StandardUser',
    }, 'ims_marketing_recommendations', { state: 'pending_approval' });

    expect(mockLoadAssistantMarketingRecommendations).toHaveBeenCalledWith({
      businessId: 'biz-1', businessToday: '2026-09-06', states: ['pending_approval'], limit: 20,
    });
  });

  it('denies Foresight tools when Marketing is disabled', async () => {
    mockGetBusinessFeatureFlags.mockResolvedValueOnce({ 'foresight.marketing': false });
    await expect(executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_marketing_performance', {})).rejects.toMatchObject({ name: 'AssistantToolAccessError' });
    expect(mockLoadAssistantMarketingPerformance).not.toHaveBeenCalled();
  });

  it('denies forged Advisor access to restricted operational tools', async () => {
    await expect(executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Advisor',
    }, 'ims_xero_sync_diagnostics', {})).rejects.toMatchObject({ name: 'AssistantToolAccessError' });
    expect(mockLoadXeroDiagnostics).not.toHaveBeenCalled();
  });

  it('bounds sales performance to the verified business, date cap, and selected locations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T12:00:00Z'));
    mockLoadAssistantSalesPerformance.mockResolvedValueOnce({
      rows: [{
        locationId: 4, location: 'Main', salesQuantity: 10, salesAmountTaxInclusive: 110,
        coveredSalesAmountTaxInclusive: 55, attachedCogs: 30, grossProfit: 20,
        grossProfitPercent: 40, cogsCoveragePercent: 50,
      }],
      totals: {
        salesQuantity: 10, salesAmountTaxInclusive: 110, coveredSalesAmountTaxInclusive: 55,
        attachedCogs: 30, grossProfit: 20, grossProfitPercent: 40, cogsCoveragePercent: 50,
      },
    });

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_sales_performance', { days: 999, locationIds: '4, 4, bad, 8' }) as any;

    expect(mockLoadAssistantSalesPerformance).toHaveBeenCalledWith({
      businessId: 'biz-1', fromDate: '2025-08-23', toDate: '2026-08-22', locationIds: [4, 8],
    });
    expect(result.totals.cogsCoveragePercent).toBe(50);
    expect(result.marginBasis).toContain('Coverage below 100%');
    expect(JSON.stringify(result)).not.toMatch(/customer|email|phone/i);
  });

  it('normalises a reorder forecast and keeps it bound to the verified business', async () => {
    mockLoadReorderForecast.mockResolvedValueOnce({ rows: [], totalMatchingSuggestions: 0, truncated: false });

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_reorder_forecast', {
      filterType: 'supplier', filterValue: 'Supply_Co%', salesWindowDays: 180, orderFrequencyDays: 999,
    }) as any;

    expect(mockLoadReorderForecast).toHaveBeenCalledWith({
      businessId: 'biz-1', filterType: 'supplier', filterValue: 'SupplyCo',
      salesWindowDays: 180, orderFrequencyDays: 365,
    });
    expect(result.method).toContain('Suggestions require staff review');
    await expect(executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_reorder_forecast', {
      filterType: 'brand', filterValue: 'North', salesWindowDays: 30,
    })).rejects.toThrow('7, 90, 180, or 365');
  });

  it('bounds purchase-order aging and omits private supplier details', async () => {
    mockLoadPurchaseOrderAging.mockResolvedValueOnce({ rows: [], truncated: false });

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_purchase_order_aging', {
      mode: 'due_soon', supplier: 'Supply_Co%', dueSoonDays: 999,
    }) as any;

    expect(mockLoadPurchaseOrderAging).toHaveBeenCalledWith({
      businessId: 'biz-1', mode: 'due_soon', supplierSearch: 'SupplyCo', dueSoonDays: 90, limit: 30,
    });
    expect(result.valueBasis).toContain('tax-exclusive');
    expect(JSON.stringify(result)).not.toMatch(/email|phone|notes|invoice|payment/i);
  });

  it('capability-gates local Xero diagnostics and bounds the history window', async () => {
    mockLoadXeroDiagnostics.mockResolvedValueOnce({
      connected: true, queued: [], recentFailures: [], queuedTruncated: false, failuresTruncated: false,
    });

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_xero_sync_diagnostics', { days: 999 }) as any;

    expect(mockAssertXeroAccountingEnabled).toHaveBeenCalledWith('biz-1');
    expect(mockLoadXeroDiagnostics).toHaveBeenCalledWith({ businessId: 'biz-1', days: 365, limit: 30 });
    expect(result.scope).toContain('Xero was not contacted');

    mockAssertXeroAccountingEnabled.mockRejectedValueOnce(new Error('Xero disabled'));
    await expect(executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_xero_sync_diagnostics', {})).rejects.toMatchObject({ name: 'AssistantToolAccessError' });
  });

  it('capability-gates local Shopify diagnostics using the verified business', async () => {
    mockLoadShopifyDiagnostics.mockResolvedValueOnce({
      connected: true, orderSyncEnabled: true, recentActivity: [], truncated: false,
    });

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_shopify_sync_diagnostics', {}) as any;

    expect(mockAssertShopifyEnabled).toHaveBeenCalledWith('biz-1');
    expect(mockLoadShopifyDiagnostics).toHaveBeenCalledWith({ businessId: 'biz-1', limit: 30 });
    expect(result.scope).toContain('Shopify and live webhook registration were not contacted');
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

  it('keeps POS operational tools bound to the verified business, location, and register', async () => {
    const principal = {
      audience: 'pos' as const, businessId: 'biz-1', posUserId: 7, locationId: 9,
      locationName: 'Main', registerId: 2, registerName: 'Front', tier: 'PosUser' as const,
    };
    mockLoadPosRegisterStatus.mockResolvedValueOnce({ status: 'open', session: { saleCount: 3 } });
    mockLoadPosRecentTransactions.mockResolvedValueOnce({ rows: [], truncated: false });

    const status = await executeAssistantTool(principal, 'pos_register_status', {}) as any;
    const transactions = await executeAssistantTool(principal, 'pos_recent_transactions', { days: 999 }) as any;

    expect(mockLoadPosRegisterStatus).toHaveBeenCalledWith({ businessId: 'biz-1', locationId: 9, registerId: 2 });
    expect(mockLoadPosRecentTransactions).toHaveBeenCalledWith({
      businessId: 'biz-1', locationId: 9, registerId: 2, days: 30, limit: 20,
    });
    expect(status.scope).toContain('parked carts and offline queues are not included');
    expect(transactions.scope).toContain('Customer, cashier, notes, payment references');
  });

  it('rejects POS operational tools when no verified register is assigned', async () => {
    await expect(executeAssistantTool({
      audience: 'pos', businessId: 'biz-1', posUserId: 7, locationId: 9,
      locationName: 'Main', registerId: null, registerName: null, tier: 'PosUser',
    }, 'pos_register_status', {})).rejects.toMatchObject({ name: 'AssistantToolAccessError' });
    expect(mockLoadPosRegisterStatus).not.toHaveBeenCalled();
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

  it('returns a bounded inventory position owned by the verified business', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      product_id: 'p-1', name: 'Jumper', variant_id: 'v-1', sku: 'JUM-1',
      location_id: 9, location_name: 'Main', qty_on_hand: 12, qty_committed: 3,
      available: 9, qty_incoming: 5, min_qty: 4, reorder_qty: 8, avg_cost: 21.5,
    }]);
    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_inventory_position', { search: 'JUM-1', location: 'Main' }) as any[];

    expect(mockImsQuery.mock.calls[0][0]).toContain('p.business_id = ?');
    expect(mockImsQuery.mock.calls[0][0]).toContain('LIMIT 30');
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', '%JUM-1%', '%JUM-1%', '%JUM-1%', 'Main']);
    expect(result[0]).toMatchObject({ quantityOnHand: 12, committed: 3, available: 9, incoming: 5, weightedAverageCost: 21.5 });
  });

  it('caps movement history and verifies product ownership through the business', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_stock_movement_history', { search: 'JUM-1', location: 'Main', days: 999 });

    expect(mockImsQuery.mock.calls[0][0]).toContain('p.business_id = ?');
    expect(mockImsQuery.mock.calls[0][0]).toContain('LIMIT 50');
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', '%JUM-1%', '%JUM-1%', '%JUM-1%', 365, 'Main']);
  });

  it('returns allocation exceptions without customer or supplier identities', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      so_id: 11, so_item_id: 12, so_number: 'SO-11', status: 'confirmed',
      customer_name: 'Private Customer', supplier_names: 'Private Supplier',
      location_id: 9, location_name: 'Main', expected_date: null, created_at: '2026-09-01',
      variant_id: 'v-1', sku: 'JUM-1', product_name: 'Jumper', variant_label: 'Blue',
      qty_ordered: 10, qty_fulfilled: 2, qty_on_hand: 5, qty_committed: 8, qty_incoming: 7,
      qty_allocated: 6, qty_received_assigned: 3, allocation_qty_fulfilled: 0,
      allocation_count: 2, at_risk_count: 0, earliest_incoming_date: null,
    }]);
    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_stock_allocation_exceptions', { issue: 'unsourced' }) as any[];

    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 'biz-1', 'biz-1', 'biz-1']);
    expect(result[0]).toMatchObject({ salesOrder: 'SO-11', outstanding: 8, protected: 6, unsourced: 2 });
    expect(result[0]).not.toHaveProperty('customer_name');
    expect(result[0]).not.toHaveProperty('supplier_names');
  });

  it('returns customer identity without contact channels or addresses', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      id: 21, type: 'retail_customer', name: 'Alex Retail', company: null,
      customer_code: 'C-000021', customer_group: 'VIP', loyalty_member: 1,
      email: 'not-returned@example.com', phone: '0400000000',
    }]);
    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_customer_lookup', { search: 'Alex' }) as any[];

    expect(mockImsQuery.mock.calls[0][0]).toContain('business_id = ?');
    expect(mockImsQuery.mock.calls[0][0]).toContain('LIMIT 10');
    expect(result[0]).toEqual({
      contactId: 21, displayName: 'Alex Retail', company: null,
      customerCode: 'C-000021', customerType: 'retail_customer',
      customerGroup: 'VIP', loyaltyMember: true,
    });
  });

  it('rejects invalid customer activity IDs before querying', async () => {
    await expect(executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_customer_activity', { contactId: 0 })).rejects.toThrow('positive customer contact ID');
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('removes contact channels, free text, and staff identity from customer activity evidence', async () => {
    mockImsQuery.mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes('SELECT * FROM ims_contacts')) return [{
        id: 21, business_id: 'biz-1', type: 'retail_customer', name: 'Alex Retail',
        company: 'Alex Co', customer_code: 'C-000021', is_active: 1, store_credit: 15,
        email: 'private@example.com', phone: '0400000000', address: 'Private address',
      }];
      if (sql.includes('FROM pos_sales ps') && sql.includes('COUNT(*)')) return [{ transaction_count: 2, net_total: 80 }];
      if (sql.includes('COUNT(*) AS order_count')) return [{ order_count: 1, order_total: 50 }];
      if (sql.includes('COUNT(*) AS credit_count')) return [{ credit_count: 1, credit_total: 10 }];
      if (sql.includes('FROM loyalty_accounts') && sql.includes('balance_points')) return [{ balance_points: 25 }];
      if (sql.includes('FROM ims_crm_tasks') && sql.includes('open_count')) return [{ open_count: 1, overdue_count: 0 }];
      if (sql.includes('FROM pos_sales ps') && sql.includes('ps.id')) return [{
        id: 31, sale_type: 'sale', status: 'completed', total: 80,
        cashier_name: 'Private Staff', location_name: 'Main', created_at: '2026-09-01',
      }];
      if (sql.includes('FROM ims_crm_interactions')) return [{ body: 'Private free-text note', actor_name: 'Private Staff' }];
      return [];
    });

    const result = await executeAssistantTool({
      audience: 'ims', businessId: 'biz-1', userId: 7, tier: 'Admin',
    }, 'ims_customer_activity', { contactId: 21, days: 999 }) as any;

    expect(result.customer).toEqual({
      contactId: 21, displayName: 'Alex Retail', company: 'Alex Co',
      customerCode: 'C-000021', customerType: 'retail_customer', active: true,
    });
    expect(result.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.activity[0]).toMatchObject({ category: 'sale', amount: 80 });
    expect(JSON.stringify(result)).not.toContain('private@example.com');
    expect(JSON.stringify(result)).not.toContain('Private free-text note');
    expect(JSON.stringify(result)).not.toContain('Private Staff');
  });
});