import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTier, mockGet, mockCreate, mockRunIms } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockTier: vi.fn(), mockGet: vi.fn(), mockCreate: vi.fn(), mockRunIms: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockSession, requireAdminTier: mockTier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({
  DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: vi.fn(),
}));
vi.mock('@/lib/foresight/repositories/ForesightCampaignActivationRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignActivationRepository')>();
  return {
    CampaignActivationValidationError: actual.CampaignActivationValidationError,
    ForesightCampaignActivationRepository: { getForThread: mockGet, create: mockCreate },
  };
});

import { CampaignActivationValidationError } from '@/lib/foresight/repositories/ForesightCampaignActivationRepository';
import { GET, POST } from '../route';

const context = { params: { threadId: '12' } };
const payload = {
  deliverableVersionId: 80, documentHash: 'b'.repeat(64), activatedOn: '2026-08-01',
  channels: [{ channel: 'meta', campaignId: 'campaign-1' }], assetIds: ['meta-primary'],
  publishedDetails: 'Published approved products.', operatorNote: 'Manually checked.',
};

describe('/api/foresight/planning/threads/[threadId]/activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockRunIms.mockResolvedValue('Australia/Perth');
    mockGet.mockResolvedValue({ id: 91 });
    mockCreate.mockResolvedValue({ id: 91 });
  });

  it('reads only through the session tenant', async () => {
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith('business-1', 12);
  });

  it('creates through the session tenant with a server-derived business date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T06:00:00Z'));
    try {
      const response = await POST(new Request('http://localhost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }), context);
      expect(response.status).toBe(201);
      expect(mockRunIms).toHaveBeenCalledWith('business-1', expect.any(Function));
      expect(mockCreate).toHaveBeenCalledWith('business-1', 12, expect.objectContaining({
        deliverableVersionId: 80, businessToday: '2026-08-02', horizonDays: 7, activatedBy: 7,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an expected 422 for a rejected activation transition', async () => {
    mockCreate.mockRejectedValue(new CampaignActivationValidationError('The exact package must be accepted.'));
    const response = await POST(new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('ACTIVATION_REJECTED');
  });
});