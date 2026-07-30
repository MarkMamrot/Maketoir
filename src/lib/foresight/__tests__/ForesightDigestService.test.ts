import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRecommendations, mockEvents, mockImplementations, mockOutcomes, mockExecutions, mockUpsert, mockUpsertWeekly, mockListRecent, mockMetrics } = vi.hoisted(() => ({
  mockRecommendations: vi.fn(), mockEvents: vi.fn(), mockImplementations: vi.fn(),
  mockOutcomes: vi.fn(), mockExecutions: vi.fn(), mockUpsert: vi.fn(), mockUpsertWeekly: vi.fn(), mockListRecent: vi.fn(), mockMetrics: vi.fn(),
}));
vi.mock('../repositories/ForesightExecutionRepository', () => ({
  ForesightExecutionRepository: { listForRecommendations: mockExecutions },
}));

vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: {
    listRecommendations: mockRecommendations,
    listRecommendationEvents: mockEvents,
    listRecommendationImplementations: mockImplementations,
    listRecommendationOutcomes: mockOutcomes,
  },
}));
vi.mock('../repositories/ForesightDigestRepository', () => ({
  ForesightDigestRepository: { upsertDaily: mockUpsert, upsertWeekly: mockUpsertWeekly, listRecent: mockListRecent },
}));
vi.mock('../ForesightMetricsService', () => ({ ForesightMetricsService: { getDailyMarketingMetrics: mockMetrics } }));

import { ForesightDigestService } from '../ForesightDigestService';

describe('ForesightDigestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecommendations.mockResolvedValue([{
      id: 42, state: 'pending_approval', channel: 'paid_media', rule_id: 'mer_decline', expires_at: null,
      evidence_json: { quality: { grade: 'good', issues: [] } },
    }]);
    mockEvents.mockResolvedValue([]);
    mockImplementations.mockResolvedValue([]);
    mockOutcomes.mockResolvedValue([]);
    mockExecutions.mockResolvedValue([]);
    mockUpsert.mockResolvedValue(9);
    mockUpsertWeekly.mockResolvedValue(10);
    mockMetrics.mockResolvedValue({ reconciliation: [], paidMedia: [], paidMediaEntities: [] });
  });

  it('loads only tenant-scoped Foresight data and persists the business-local daily snapshot', async () => {
    const snapshot = await ForesightDigestService.generateDaily('business-1', '2026-07-29');
    expect(snapshot.counts.pendingApproval).toBe(1);
    expect(mockRecommendations).toHaveBeenCalledWith('business-1', expect.arrayContaining(['pending_approval', 'approved']));
    expect(mockEvents).toHaveBeenCalledWith('business-1', [42]);
    expect(mockImplementations).toHaveBeenCalledWith('business-1', [42]);
    expect(mockOutcomes).toHaveBeenCalledWith('business-1', [42]);
    expect(mockExecutions).toHaveBeenCalledWith('business-1', [42]);
    expect(mockUpsert).toHaveBeenCalledWith('business-1', '2026-07-29', snapshot);
  });

  it('produces and persists an empty digest without querying unscoped rows', async () => {
    mockRecommendations.mockResolvedValue([]);
    const snapshot = await ForesightDigestService.generateDaily('business-2', '2026-07-29');
    expect(snapshot.counts.total).toBe(0);
    expect(mockEvents).toHaveBeenCalledWith('business-2', []);
    expect(mockUpsert).toHaveBeenCalledWith('business-2', '2026-07-29', snapshot);
  });

  it('builds a weekly summary from the exact tenant-scoped 14-day metric range', async () => {
    const snapshot = await ForesightDigestService.generateWeekly('business-1', '2026-07-28');
    expect(snapshot).toMatchObject({ digestType: 'weekly_summary', digestDate: '2026-07-28' });
    expect(mockMetrics).toHaveBeenCalledWith('business-1', '2026-07-15', '2026-07-28');
    expect(mockRecommendations).toHaveBeenCalledWith('business-1', expect.arrayContaining(['expired']));
    expect(mockUpsertWeekly).toHaveBeenCalledWith('business-1', '2026-07-28', snapshot);
  });
});