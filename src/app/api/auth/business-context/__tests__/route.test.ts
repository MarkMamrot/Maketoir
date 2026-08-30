import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  verifyDetails: vi.fn(),
  resolveAccess: vi.fn(),
  setSessionCookie: vi.fn(),
  execute: vi.fn(),
  reportRuntimeIssue: vi.fn(),
  recordActiveBusiness: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ get: mocks.cookieGet }) }));
vi.mock('@/lib/auth/adminSessionToken', () => ({ verifyAdminSessionDetails: mocks.verifyDetails }));
vi.mock('@/lib/auth/adminAuthCookies', () => ({ setAdminSessionCookie: mocks.setSessionCookie }));
vi.mock('@/lib/auth/businessAccess', () => ({
  resolveActorBusinessAccess: mocks.resolveAccess,
  findAccessibleBusiness: (businesses: any[], businessId: string) => businesses.find(business => business.businessId === businessId) ?? null,
}));
vi.mock('@/services/MySQLService', () => ({ execute: mocks.execute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/lib/auth/businessMemberships', () => ({ recordActiveBusiness: mocks.recordActiveBusiness }));

import { POST } from '../route';

const session = {
  userId: 42,
  businessId: 'alpha',
  tier: 'SuperAdmin',
  role: 'admin',
  name: 'Platform Admin',
  company: 'Alpha',
  email: 'platform@example.com',
};
const target = { businessId: 'beta', name: 'Beta', driveFolderId: null, hasForesight: false, hasIms: true, hasPos: true, isSandbox: false, tier: 'Admin' };

function request(businessId: string) {
  return new Request('http://localhost/api/auth/business-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ businessId }),
  });
}

describe('POST /api/auth/business-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mocks.cookieGet.mockReturnValue({ value: 'signed-session' });
    mocks.verifyDetails.mockReturnValue({ data: session, issuedAt: 100, expiresAt: 1300 });
    mocks.resolveAccess.mockResolvedValue({
      actor: { id: 42, name: 'Platform Admin', email: 'platform@example.com', role: 'admin', tier: 'SuperAdmin' },
      businesses: [target],
    });
    mocks.execute.mockResolvedValue({});
    mocks.reportRuntimeIssue.mockResolvedValue(null);
  });

  it('switches only the active business while preserving actor identity and absolute expiry', async () => {
    const response = await POST(request('beta'));

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('user_business_context_events'), [42, 'alpha', 'beta']);
    expect(mocks.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      email: 'platform@example.com',
      tier: 'SuperAdmin',
      businessId: 'beta',
      company: 'Beta',
    }), 300);
  });

  it('uses the target membership tier for an enrolled ordinary user', async () => {
    mocks.resolveAccess.mockResolvedValue({ actor: { id: 42, name: 'User', email: 'user@example.com', role: 'admin', tier: 'StandardUser' }, businesses: [target] });

    const response = await POST(request('beta'));

    expect(response.status).toBe(200);
    expect(mocks.recordActiveBusiness).toHaveBeenCalledWith(42, 'beta');
    expect(mocks.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ tier: 'Admin', businessId: 'beta' }), 300);
  });

  it('rejects an unavailable business without writing an audit event', async () => {
    const response = await POST(request('deleted-business'));

    expect(response.status).toBe(404);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });
});