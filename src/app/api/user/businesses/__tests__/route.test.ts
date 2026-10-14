import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveAccess: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.getSession }));
vi.mock('@/lib/auth/businessAccess', () => ({ resolveActorBusinessAccess: mocks.resolveAccess }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

describe('accessible businesses Help identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockReturnValue({ userId: 42, businessId: 'sandbox' });
    mocks.reportRuntimeIssue.mockResolvedValue(null);
  });

  it.each(['StandardUser', 'SuperAdmin'])('returns the authenticated actor tier %s independently of business membership', async tier => {
    mocks.resolveAccess.mockResolvedValue({
      actor: { id: 42, tier },
      businesses: [{
        businessId: 'sandbox', name: 'Sandbox', driveFolderId: null,
        hasForesight: false, hasIms: true, hasPos: true, isSandbox: true, tier: 'Admin',
      }],
    });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.userTier).toBe(tier);
    expect(body.businesses[0]).toMatchObject({ tier: 'Admin', active: true });
  });

  it('does not return a Help role without authentication', async () => {
    mocks.getSession.mockReturnValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect((await response.json()).userTier).toBeUndefined();
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
  });
});
