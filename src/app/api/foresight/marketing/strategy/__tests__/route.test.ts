import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FORESIGHT_MARKETING_STRATEGY } from '@/lib/foresight/marketingStrategy';

const { mockRequireAdminSession, mockRequireAdminTier, mockLatestStrategy, mockCreateStrategy } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockRequireAdminTier: vi.fn(),
  mockLatestStrategy: vi.fn(),
  mockCreateStrategy: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  requireAdminTier: mockRequireAdminTier,
}));
vi.mock('@/lib/foresight/repositories/ForesightRepository', () => ({
  ForesightRepository: {
    latestStrategy: mockLatestStrategy,
    createStrategyVersion: mockCreateStrategy,
  },
}));

import { GET, PUT } from '../route';

function update(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/foresight/marketing/strategy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/foresight/marketing/strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'business-1' } });
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockLatestStrategy.mockResolvedValue(null);
    mockCreateStrategy.mockResolvedValue(12);
  });

  it('returns explicit defaults when the business has no saved strategy', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockLatestStrategy).toHaveBeenCalledWith('business-1');
    expect(body).toMatchObject({ version: 0, strategy: DEFAULT_FORESIGHT_MARKETING_STRATEGY });
  });

  it('requires Admin tier for updates', async () => {
    mockRequireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });

    const response = await PUT(update({
      strategy: DEFAULT_FORESIGHT_MARKETING_STRATEGY,
      changeReason: 'Initial guardrails',
    }));

    expect(response.status).toBe(403);
    expect(mockCreateStrategy).not.toHaveBeenCalled();
  });

  it('versions a valid strategy for the session business and actor', async () => {
    mockLatestStrategy.mockResolvedValueOnce(null).mockResolvedValueOnce({ version: 1 });

    const response = await PUT(update({
      strategy: DEFAULT_FORESIGHT_MARKETING_STRATEGY,
      changeReason: 'Initial guardrails',
      businessId: 'attempted-other-tenant',
    }));

    expect(response.status).toBe(200);
    expect(mockCreateStrategy).toHaveBeenCalledWith('business-1', expect.objectContaining({
      strategy: DEFAULT_FORESIGHT_MARKETING_STRATEGY,
      authoredBy: 7,
      changeReason: 'Initial guardrails',
    }));
  });

  it('rejects malformed strategies and short audit reasons', async () => {
    const shortReason = await PUT(update({
      strategy: DEFAULT_FORESIGHT_MARKETING_STRATEGY,
      changeReason: 'x',
    }));
    const invalidStrategy = await PUT(update({
      strategy: { ...DEFAULT_FORESIGHT_MARKETING_STRATEGY, paidMedia: {} },
      changeReason: 'Update thresholds',
    }));

    expect(shortReason.status).toBe(400);
    expect(invalidStrategy.status).toBe(400);
    expect(mockCreateStrategy).not.toHaveBeenCalled();
  });
});