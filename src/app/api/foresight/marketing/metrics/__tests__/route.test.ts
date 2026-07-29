import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockGetMetrics, mockListRuns } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockGetMetrics: vi.fn(),
  mockListRuns: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock('@/lib/foresight/ForesightMetricsService', () => ({
  ForesightMetricsService: { getDailyMarketingMetrics: mockGetMetrics },
}));
vi.mock('@/lib/foresight/repositories/ForesightIngestionRepository', () => ({
  ForesightIngestionRepository: { listRecentSyncRuns: mockListRuns },
}));

import { GET } from '../route';

describe('GET /api/foresight/marketing/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'business-1' } });
    mockGetMetrics.mockResolvedValue({ paidMedia: [], commerce: [], reconciliation: [] });
    mockListRuns.mockResolvedValue([]);
  });

  it('uses the authenticated business rather than accepting tenant input', async () => {
    const response = await GET(new Request(
      'http://localhost/api/foresight/marketing/metrics?from=2026-07-01&to=2026-07-29',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockGetMetrics).toHaveBeenCalledWith('business-1', '2026-07-01', '2026-07-29');
    expect(mockListRuns).toHaveBeenCalledWith('business-1', 10);
  });

  it('rejects invalid or oversized date ranges', async () => {
    const invalid = await GET(new Request(
      'http://localhost/api/foresight/marketing/metrics?from=invalid&to=2026-07-29',
    ));
    const oversized = await GET(new Request(
      'http://localhost/api/foresight/marketing/metrics?from=2025-01-01&to=2026-07-29',
    ));

    expect(invalid.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(mockGetMetrics).not.toHaveBeenCalled();
  });
});