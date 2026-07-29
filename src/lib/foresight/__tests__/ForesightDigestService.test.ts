import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRecommendations, mockEvents, mockImplementations, mockOutcomes, mockUpsert, mockListRecent } = vi.hoisted(() => ({
  mockRecommendations: vi.fn(), mockEvents: vi.fn(), mockImplementations: vi.fn(),
  mockOutcomes: vi.fn(), mockUpsert: vi.fn(), mockListRecent: vi.fn(),
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
  ForesightDigestRepository: { upsertDaily: mockUpsert, listRecent: mockListRecent },
}));

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
    mockUpsert.mockResolvedValue(9);
  });

  it('loads only tenant-scoped Foresight data and persists the business-local daily snapshot', async () => {
    const snapshot = await ForesightDigestService.generateDaily('business-1', '2026-07-29');
    expect(snapshot.counts.pendingApproval).toBe(1);
    expect(mockRecommendations).toHaveBeenCalledWith('business-1', expect.arrayContaining(['pending_approval', 'approved']));
    expect(mockEvents).toHaveBeenCalledWith('business-1', [42]);
    expect(mockImplementations).toHaveBeenCalledWith('business-1', [42]);
    expect(mockOutcomes).toHaveBeenCalledWith('business-1', [42]);
    expect(mockUpsert).toHaveBeenCalledWith('business-1', '2026-07-29', snapshot);
  });

  it('produces and persists an empty digest without querying unscoped rows', async () => {
    mockRecommendations.mockResolvedValue([]);
    const snapshot = await ForesightDigestService.generateDaily('business-2', '2026-07-29');
    expect(snapshot.counts.total).toBe(0);
    expect(mockEvents).toHaveBeenCalledWith('business-2', []);
    expect(mockUpsert).toHaveBeenCalledWith('business-2', '2026-07-29', snapshot);
  });
});