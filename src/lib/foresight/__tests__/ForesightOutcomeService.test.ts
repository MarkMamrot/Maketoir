import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCandidates,
  mockCreateOutcome,
  mockGetMetrics,
  mockSummarize,
  mockAssess,
} = vi.hoisted(() => ({
  mockCandidates: vi.fn(),
  mockCreateOutcome: vi.fn(),
  mockGetMetrics: vi.fn(),
  mockSummarize: vi.fn(),
  mockAssess: vi.fn(),
}));

vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: {
    listRecommendationOutcomeCandidates: mockCandidates,
    createRecommendationOutcome: mockCreateOutcome,
  },
}));
vi.mock('../ForesightMetricsService', () => ({
  ForesightMetricsService: { getDailyMarketingMetrics: mockGetMetrics },
}));
vi.mock('../recommendationOutcomes', () => ({
  summarizePaidMediaOutcomeWindow: mockSummarize,
  assessPaidMediaRecommendationOutcome: mockAssess,
}));

import { ForesightOutcomeService } from '../ForesightOutcomeService';

const candidate = {
  id: 42,
  rule_id: 'mer_deterioration',
  decision: 'approved',
  decided_at: '2026-07-10 14:30:00',
  evidence_json: {
    windowStart: '2026-07-01',
    windowEnd: '2026-07-07',
    observedValues: { currentMer: 1.5, previousMer: 3, merDeteriorationPercent: 25 },
  },
};

describe('ForesightOutcomeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCandidates.mockResolvedValue([candidate]);
    mockGetMetrics.mockResolvedValue({
      reconciliation: Array.from({ length: 7 }, (_, index) => ({ metricDate: `2026-07-${String(index + 11).padStart(2, '0')}` })),
    });
    mockSummarize.mockReturnValue({ windowStart: '2026-07-11', windowEnd: '2026-07-17' });
    mockAssess.mockReturnValue({
      direction: 'improved',
      conditionState: 'resolved',
      primaryMetric: 'paid_media_ecommerce_mer',
      baselineValue: 1.5,
      followupValue: 2.5,
      followup: {},
      explanation: 'Recovered.',
    });
    mockCreateOutcome.mockResolvedValue(9);
  });

  it('measures an eligible decision in the exact tenant-scoped follow-up window', async () => {
    const result = await ForesightOutcomeService.evaluateDuePaidMedia('business-1', '2026-07-29');

    expect(mockCandidates).toHaveBeenCalledWith('business-1', '2026-07-29', 7);
    expect(mockGetMetrics).toHaveBeenCalledWith('business-1', '2026-07-11', '2026-07-17');
    expect(mockCreateOutcome).toHaveBeenCalledWith('business-1', expect.objectContaining({
      recommendationId: 42,
      decision: 'approved',
      horizonDays: 7,
      baselineStart: '2026-07-01',
      baselineEnd: '2026-07-07',
      followupStart: '2026-07-11',
      followupEnd: '2026-07-17',
    }));
    expect(result).toMatchObject({ candidateCount: 1, measuredCount: 1, deferredCount: 0 });
  });

  it('defers incomplete windows so a later ingestion can retry them', async () => {
    mockGetMetrics.mockResolvedValue({ reconciliation: [{ metricDate: '2026-07-11' }] });

    const result = await ForesightOutcomeService.evaluateDuePaidMedia('business-1', '2026-07-29');

    expect(mockCreateOutcome).not.toHaveBeenCalled();
    expect(result).toMatchObject({ measuredCount: 0, deferredCount: 1 });
  });

  it('does not persist a blocked assessment', async () => {
    mockAssess.mockReturnValue({ direction: 'unavailable', conditionState: 'unknown' });

    const result = await ForesightOutcomeService.evaluateDuePaidMedia('business-1', '2026-07-29');

    expect(mockCreateOutcome).not.toHaveBeenCalled();
    expect(result.deferredCount).toBe(1);
  });
});