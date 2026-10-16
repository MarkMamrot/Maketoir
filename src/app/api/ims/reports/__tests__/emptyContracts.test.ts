import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getImsDbName: vi.fn(),
  getPool: vi.fn(),
  imsQuery: vi.fn(),
  mainQuery: vi.fn(),
  mainExecute: vi.fn(),
  requireManager: vi.fn(),
  timeZone: vi.fn(),
  dailyTransactions: vi.fn(),
  graphData: vi.fn(),
  reportIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({
  getImsDbNameStrict: mocks.getImsDbName,
  runImsForBusiness: async (_businessId: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.getPool, imsQuery: mocks.imsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.mainQuery, execute: mocks.mainExecute }));
vi.mock('@/lib/sessionUtils', () => ({ requirePosManagerTier: mocks.requireManager }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mocks.timeZone }));
vi.mock('@/lib/db/PosRepository', () => ({
  PosReportsRepo: { dailyTransactions: mocks.dailyTransactions, graphData: mocks.graphData },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportIssue }));
vi.mock('@/lib/ims/bookkeeperAudit/cogsPostingAdapter', () => ({ loadCogsPostingAuditFindings: vi.fn().mockResolvedValue([]) }));
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => ({ value: JSON.stringify({ businessId: 'business-1', location_id: 1 }) }),
  }),
}));

import { GET as getCashBanking } from '../cash-banking/route';
import { GET as getBookkeeperAudit } from '../bookkeeper-audit/route';
import { GET as getInventoryValuation } from '../inventory-valuation/route';
import { GET as getPosPriceChanges } from '../pos-price-changes/route';
import { GET as getPosRegisters } from '../pos-registers/route';
import { GET as getProductMargin } from '../product-margin/route';
import { GET as getSalesByBranch } from '../sales-by-branch/route';
import { GET as getSalesSearch } from '../sales-search/route';
import { GET as getSalesSummary } from '../sales-summary/route';
import { GET as getStockAvailability } from '../stock-availability/route';
import { GET as getPosDaily } from '@/app/api/pos/reports/daily/route';
import { GET as getPosGraph } from '@/app/api/pos/reports/graph/route';

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe('empty tenant report contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.getImsDbName.mockResolvedValue('tenant_business_1');
    mocks.imsQuery.mockResolvedValue([]);
    mocks.mainQuery.mockResolvedValue([]);
    mocks.requireManager.mockReturnValue({
      response: null,
      user: { businessId: 'business-1', tier: 'Admin' },
    });
    mocks.timeZone.mockResolvedValue('Australia/Sydney');
    mocks.dailyTransactions.mockResolvedValue([]);
    mocks.graphData.mockResolvedValue([]);
    mocks.reportIssue.mockResolvedValue(1);
  });

  it('returns an empty Sales by Branch report', async () => {
    const poolQuery = vi.fn()
      .mockResolvedValueOnce([[{ total: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);
    mocks.getPool.mockReturnValue({ query: poolQuery });

    const response = await getSalesByBranch(request('/api/ims/reports/sales-by-branch'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ success: true, rows: [], total: 0, totalQty: 0, totalAmount: 0, locations: [] }));
  });

  it('returns setup guidance when Sales Summary has no active locations', async () => {
    mocks.getPool.mockReturnValue({ query: vi.fn().mockResolvedValue([[], []]) });

    const response = await getSalesSummary(request('/api/ims/reports/sales-summary'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Select at least one active location.' });
  });

  it('returns an empty Sales Search report', async () => {
    mocks.getPool.mockReturnValue({
      query: vi.fn()
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([[{ total: 0, totalQty: 0, totalRevenue: 0 }], []]),
    });

    const response = await getSalesSearch(request('/api/ims/reports/sales-search'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ success: true, rows: [], total: 0, totalQty: 0, totalRevenue: 0 }));
  });

  it('returns an empty Inventory Valuation report', async () => {
    const response = await getInventoryValuation(request('/api/ims/reports/inventory-valuation'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      as_at: expect.any(String),
      business_today: expect.any(String),
      time_zone: 'Australia/Sydney',
      historical: false,
      data: [],
      ownership: 'owned',
      ownership_totals: { owned_value: 0, consignment_value: 0 },
      costing_method: 'average_cost',
      cost_epoch_id: null,
      reconciliation: {
        status: 'balanced', mismatched_sku_count: 0, mismatched_location_count: 0,
        stock_quantity: 0, valued_quantity: 0, mismatches: [],
      },
    });
  });

  it('returns an empty Bookkeeper Audit with explicit month-end coverage', async () => {
    const response = await getBookkeeperAudit(request('/api/ims/reports/bookkeeper-audit'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      success: true,
      asOfDate: expect.any(String),
      coverage: { operational: 'checked', cogs: 'checked', xero: 'checked', monthEndInventory: 'not_yet_checked' },
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'negative_stock', status: 'checked' }),
        expect.objectContaining({ id: 'sales_cogs', status: 'checked' }),
        expect.objectContaining({ id: 'xero_documents', status: 'checked' }),
        expect.objectContaining({ id: 'month_end_inventory', status: 'not_yet_checked' }),
      ]),
      summary: { open: 0, accepted: 0, critical: 0, error: 0, warning: 0 },
      items: [],
    }));
    expect(mocks.imsQuery).toHaveBeenCalledTimes(3);
    expect(mocks.mainQuery).toHaveBeenCalledWith(expect.stringContaining('bookkeeper_audit_reviews'), ['business-1']);
  });

  it('excludes consignment from default owned valuation using tenant-scoped supplier classification', async () => {
    await getInventoryValuation(request('/api/ims/reports/inventory-valuation'));
    const query = mocks.imsQuery.mock.calls.find(([sql]) => String(sql).includes('c.name as supplier_name'));
    expect(query?.[0]).toContain('NOT EXISTS');
    expect(query?.[0]).toContain('owner.business_id = p.business_id');
    expect(query?.[0]).toContain('owner.is_consignment = 1');
  });

  it('separates consignment indicative value from owned asset value in all-ownership reports', async () => {
    mocks.imsQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { variant_id: 'own', sku: 'OWN', soh: '2', cost: '20', total_value: '40', is_consignment: 0, layer_quantity: null },
      { variant_id: 'con', sku: 'CON', soh: '10', cost: '50', total_value: '500', is_consignment: 1, layer_quantity: null },
    ]);
    const response = await getInventoryValuation(request('/api/ims/reports/inventory-valuation?ownership=all'));
    const body = await response.json();
    expect(body.ownership_totals).toEqual({ owned_value: 40, consignment_value: 500 });
    expect(body.data[1]).toMatchObject({ is_consignment: true, cost: 50, soh: 10, total_value: 500 });
  });

  it('rejects unknown ownership filters before any valuation query', async () => {
    const response = await getInventoryValuation(request('/api/ims/reports/inventory-valuation?ownership=unknown'));
    expect(response.status).toBe(400);
    expect(mocks.imsQuery).not.toHaveBeenCalled();
    expect(mocks.reportIssue).not.toHaveBeenCalled();
  });

  it('values FIFO inventory from remaining layers and reports quantity mismatches', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ active_method: 'fifo', active_epoch_id: 12 }])
      .mockResolvedValueOnce([{
        variant_id: 'v-1', sku: 'SKU-1', name: 'Product', brand: 'Brand', supplier_name: 'Supplier',
        cost: '5', soh: '3', total_value: '10', layer_quantity: '2',
      }])
      .mockResolvedValueOnce([{
        variant_id: 'v-1', location_id: 7, stock_quantity: '3', layer_quantity: '2',
      }]);

    const response = await getInventoryValuation(request('/api/ims/reports/inventory-valuation'));
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      costing_method: 'fifo',
      cost_epoch_id: 12,
      reconciliation: {
        status: 'mismatch', mismatched_sku_count: 1, mismatched_location_count: 1,
        stock_quantity: 3, valued_quantity: 2,
        mismatches: [{ variant_id: 'v-1', location_id: 7, stock_quantity: 3, layer_quantity: 2, reconciliation_delta: 1 }],
      },
      data: [{ cost: 5, soh: 3, total_value: 10, layer_quantity: 2, reconciliation_delta: 1 }],
    });
    expect(mocks.imsQuery.mock.calls[1][0]).toContain('SUM(remaining_quantity * unit_cost) AS layer_value');
    expect(mocks.imsQuery.mock.calls[1][1]).toEqual(['business-1', 'business-1', 12, 'business-1']);
    expect(mocks.imsQuery.mock.calls[2][0]).toContain('GROUP BY position.variant_id, position.location_id');
    expect(mocks.imsQuery.mock.calls[2][0]).toContain('BINARY s.variant_id AS variant_id');
  });

  it('reports offsetting FIFO discrepancies at separate locations', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ active_method: 'fifo', active_epoch_id: 12 }])
      .mockResolvedValueOnce([{
        variant_id: 'v-1', sku: 'SKU-1', name: 'Product', brand: 'Brand', supplier_name: 'Supplier',
        cost: '5', soh: '4', total_value: '20', layer_quantity: '4',
      }])
      .mockResolvedValueOnce([
        { variant_id: 'v-1', location_id: 7, stock_quantity: '3', layer_quantity: '2' },
        { variant_id: 'v-1', location_id: 8, stock_quantity: '1', layer_quantity: '2' },
      ]);

    const response = await getInventoryValuation(request('/api/ims/reports/inventory-valuation'));
    const body = await response.json();

    expect(body.data[0].reconciliation_delta).toBe(0);
    expect(body.reconciliation).toMatchObject({
      status: 'mismatch',
      mismatched_sku_count: 1,
      mismatched_location_count: 2,
      mismatches: [
        { variant_id: 'v-1', location_id: 7, reconciliation_delta: 1 },
        { variant_id: 'v-1', location_id: 8, reconciliation_delta: -1 },
      ],
    });
  });

  it('returns an empty Product Margin report', async () => {
    const response = await getProductMargin(request('/api/ims/reports/product-margin'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ success: true, data: [], total: 0 }));
  });

  it('returns an empty POS Price Changes report', async () => {
    const response = await getPosPriceChanges(request('/api/ims/reports/pos-price-changes'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: [] });
  });

  it('returns an empty POS Registers report', async () => {
    const response = await getPosRegisters(request('/api/ims/reports/pos-registers?date=2026-08-09'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, sessions: [], date: '2026-08-09' });
  });

  it('links a posted cash till variance to the POS Registers reconciliation', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{
        id: 171,
        register_name: 'Default Register',
        location_name: 'Newtown Shop',
        location_id: 1,
        status: 'closed',
        opened_at: '2026-08-18 10:30:00',
        opened_by: 'Newtown',
        opening_float: '400.00',
        closed_at: '2026-08-18 17:54:00',
        closed_by: 'Newtown',
      }])
      .mockResolvedValueOnce([{
        id: 647,
        register_session_id: 171,
        payment_method: 'Cash',
        expected_amount: '357.05',
        counted_amount: '400.05',
        xero_invoice_id: 'invoice-1',
        xero_synced_at: '2026-08-18 17:54:00',
      }]);
    mocks.mainQuery.mockResolvedValueOnce([{
      eod_reconciliation_id: 647,
      till_variance: '-357.00',
      variance_status: 'completed',
      xero_variance_id: 'variance-1',
    }]);

    const response = await getPosRegisters(request('/api/ims/reports/pos-registers?date=2026-08-18'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessions[0].reconciliations[0]).toEqual(expect.objectContaining({
      variance: -357,
      till_variance: -357,
      variance_status: 'completed',
      xero_variance_id: 'variance-1',
    }));
  });

  it('returns corrected counts, float-adjusted totals and latest closing evidence without replacing posted accounting values', async () => {
    const snapshot = [{ id: 8, payment_method: 'Cash', previous_counted: 818, counted_amount: 815.99 }];
    mocks.imsQuery
      .mockResolvedValueOnce([{
        id: 4, register_name: 'Till 1', location_name: 'Sydney', location_id: 2,
        status: 'closed', opening_float: '200.00',
      }])
      .mockResolvedValueOnce([
        { id: 8, register_session_id: 4, payment_method: 'Cash', expected_amount: '618', counted_amount: '815.99', xero_invoice_id: 'invoice-1' },
        { id: 9, register_session_id: 4, payment_method: 'Card', expected_amount: '100', counted_amount: '100', xero_invoice_id: 'invoice-2' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 11, register_session_id: 4, actor_name: 'Alex', reason: 'Closing sheet checked',
        created_at: '2026-10-16 10:00:00', counts_snapshot: JSON.stringify(snapshot),
      }]);
    mocks.mainQuery.mockResolvedValueOnce([{
      eod_reconciliation_id: 8, till_variance: '0', variance_status: 'completed', xero_variance_id: 'original-posting',
    }]);
    const response = await getPosRegisters(request('/api/ims/reports/pos-registers?date=2026-10-16'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sessions[0]).toMatchObject({
      latest_closing_correction: { id: 11, actor_name: 'Alex', reason: 'Closing sheet checked', counts_snapshot: snapshot },
      total_expected: 718, total_counted: 915.99,
    });
    expect(body.sessions[0].total_variance).toBeCloseTo(-2.01, 2);
    expect(body.sessions[0].reconciliations[0]).toMatchObject({
      id: 8, counted_amount: 815.99, till_variance: 0, variance_status: 'completed',
      xero_invoice_id: 'invoice-1', xero_variance_id: 'original-posting',
    });
    expect(body.sessions[0].reconciliations[0].variance).toBeCloseTo(-2.01, 2);
    expect(mocks.imsQuery.mock.calls[3][1]).toEqual(['business-1', 4, 'business-1']);
  });

  it('returns an empty Cash Banking report', async () => {
    const response = await getCashBanking(request('/api/ims/reports/cash-banking?from=2026-08-01&to=2026-08-09'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, canRecordCorrection: true, deposits: [] });
  });

  it('returns an empty Stock Availability management report', async () => {
    const response = await getStockAvailability();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      rows: [],
      summary: {
        unsourcedUnits: 0,
        unsourcedValue: 0,
        readyUnits: 0,
        readyValue: 0,
        protectedIncomingUnits: 0,
        protectedIncomingCost: 0,
        overduePromises: 0,
        atRiskPromises: 0,
      },
    });
  });

  it('returns zeroed POS Daily totals', async () => {
    const response = await getPosDaily(request('/api/pos/reports/daily?location_id=1&date=2026-08-09'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transactions: [],
      summary: { total_revenue: 0, total_count: 0, by_method: {} },
    });
  });

  it('returns an empty POS Graph series', async () => {
    const response = await getPosGraph(request('/api/pos/reports/graph?location_id=1&days=30'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });
});