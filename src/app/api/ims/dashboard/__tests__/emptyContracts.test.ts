import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getStats: vi.fn(),
  imsQuery: vi.fn(),
  reportIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsDashboardRepo: { getStats: mocks.getStats } }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportIssue }));

import { GET as getDashboard } from '../route';
import { GET as getOpenOnlineSales } from '../../online-sales/open/route';

describe('initial IMS empty contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.reportIssue.mockResolvedValue(1);
  });

  it('returns zero dashboard statistics for a new tenant', async () => {
    const emptyStats = {
      products: 0,
      variants: 0,
      locations: 0,
      openPOs: 0,
      openSOs: 0,
      lowStock: 0,
      stockValue: 0,
      stockItemCount: 0,
      openRegisters: [],
      posRegisters: [],
      recentPOs: [],
      recentSOs: [],
    };
    mocks.getStats.mockResolvedValue(emptyStats);

    const response = await getDashboard();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: emptyStats });
  });

  it('returns an empty open-online-orders list without issuing an IN query', async () => {
    mocks.imsQuery.mockResolvedValueOnce([]);

    const response = await getOpenOnlineSales();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, orders: [] });
    expect(mocks.imsQuery).toHaveBeenCalledTimes(1);
  });

  it('reports dashboard database failures instead of presenting zero statistics', async () => {
    const error = new Error('Missing table');
    mocks.getStats.mockRejectedValue(error);

    const response = await getDashboard();

    expect(response.status).toBe(500);
    expect(mocks.reportIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      operation: 'load_stats',
      error,
    }));
  });
});