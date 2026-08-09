import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPool: vi.fn(),
  imsQuery: vi.fn(),
  mainQuery: vi.fn(),
  requireManager: vi.fn(),
  timeZone: vi.fn(),
  dailyTransactions: vi.fn(),
  graphData: vi.fn(),
  reportIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.getPool, imsQuery: mocks.imsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.mainQuery }));
vi.mock('@/lib/sessionUtils', () => ({ requirePosManagerTier: mocks.requireManager }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mocks.timeZone }));
vi.mock('@/lib/db/PosRepository', () => ({
  PosReportsRepo: { dailyTransactions: mocks.dailyTransactions, graphData: mocks.graphData },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportIssue }));
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => ({ value: JSON.stringify({ businessId: 'business-1', location_id: 1 }) }),
  }),
}));

import { GET as getCashBanking } from '../cash-banking/route';
import { GET as getInventoryValuation } from '../inventory-valuation/route';
import { GET as getPosPriceChanges } from '../pos-price-changes/route';
import { GET as getPosRegisters } from '../pos-registers/route';
import { GET as getProductMargin } from '../product-margin/route';
import { GET as getSalesByBranch } from '../sales-by-branch/route';
import { GET as getSalesSearch } from '../sales-search/route';
import { GET as getSalesSummary } from '../sales-summary/route';
import { GET as getPosDaily } from '@/app/api/pos/reports/daily/route';
import { GET as getPosGraph } from '@/app/api/pos/reports/graph/route';

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe('empty tenant report contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
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
    expect(await response.json()).toEqual({ success: true, data: [] });
  });

  it('returns an empty Product Margin report', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
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

  it('returns an empty Cash Banking report', async () => {
    const response = await getCashBanking(request('/api/ims/reports/cash-banking?from=2026-08-01&to=2026-08-09'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, canRecordCorrection: true, deposits: [] });
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