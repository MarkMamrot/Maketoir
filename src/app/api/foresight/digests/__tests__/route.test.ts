import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTier, mockRunIms, mockTimeZone, mockList, mockGenerate } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockTier: vi.fn(), mockRunIms: vi.fn(), mockTimeZone: vi.fn(),
  mockList: vi.fn(), mockGenerate: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockSession, requireAdminTier: mockTier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({
  DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: mockTimeZone,
}));
vi.mock('@/lib/foresight/ForesightDigestService', () => ({
  ForesightDigestService: { listRecent: mockList, generateDaily: mockGenerate },
}));

import { GET, POST } from '../route';

describe('/api/foresight/digests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: { businessId: 'business-1' } });
    mockTier.mockReturnValue({ user: { businessId: 'business-1' } });
    mockRunIms.mockImplementation(async (_businessId, callback) => callback());
    mockTimeZone.mockResolvedValue('Australia/Sydney');
    mockList.mockResolvedValue([]);
    mockGenerate.mockResolvedValue({ digestDate: '2026-07-29', counts: { total: 2 } });
  });

  it('lists only the session tenant digest history', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith('business-1', 7);
  });

  it('requires Admin tier to refresh a digest', async () => {
    mockTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST();
    expect(response.status).toBe(403);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('generates for the session tenant and its business-local date', async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(mockRunIms).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mockGenerate).toHaveBeenCalledWith('business-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
});