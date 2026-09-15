import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), verifyState: vi.fn(), cookieGet: vi.fn(), authorize: vi.fn(), exchange: vi.fn(),
  participations: vi.fn(), requireAu: vi.fn(), report: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ get: mocks.cookieGet }) }));
vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.session }));
vi.mock('@/lib/channels/amazonOAuthState', () => ({ verifyAmazonOAuthState: mocks.verifyState }));
vi.mock('@/lib/channels/amazonChannelRepository', () => ({ authorizeAmazonChannel: mocks.authorize }));
vi.mock('@/lib/channels/amazonSpApi', () => ({
  exchangeAmazonAuthorizationCode: mocks.exchange,
  getAmazonMarketplaceParticipations: mocks.participations,
  requireActiveAmazonAustraliaParticipation: mocks.requireAu,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';

function request(query: string) {
  return new Request(`http://localhost/api/ims/amazon/callback?${query}`);
}

describe('GET /api/ims/amazon/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = 'http://localhost:3000';
    mocks.session.mockReturnValue({ businessId: 'business-1', userId: 7, tier: 'Admin' });
    mocks.verifyState.mockReturnValue({ businessId: 'business-1', userId: 7, nonce: 'nonce', displayName: 'Amazon Retail' });
    mocks.cookieGet.mockReturnValue({ value: 'nonce' });
    mocks.exchange.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 });
    mocks.participations.mockResolvedValue([{ marketplace: { id: 'au' } }]);
    mocks.requireAu.mockReturnValue({ storeName: 'Retail AU' });
    mocks.authorize.mockResolvedValue('instance-1');
    mocks.report.mockResolvedValue(undefined);
  });

  it('rejects mismatched authorization state before token exchange', async () => {
    mocks.verifyState.mockReturnValue(null);
    const response = await GET(request('state=bad&selling_partner_id=A1SELLER99&spapi_oauth_code=code'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('amazonError=');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('verifies AU participation and persists the exact seller account', async () => {
    const response = await GET(request('state=signed&selling_partner_id=A1SELLER99&spapi_oauth_code=code'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('amazonSuccess=');
    expect(mocks.exchange).toHaveBeenCalledWith('code', 'http://localhost:3000/api/ims/amazon/callback');
    expect(mocks.authorize).toHaveBeenCalledWith({
      businessId: 'business-1', sellerId: 'A1SELLER99', displayName: 'Amazon Retail',
      storeName: 'Retail AU', refreshToken: 'refresh',
    });
  });

  it('reports operational failure without returning provider details', async () => {
    mocks.exchange.mockRejectedValue(new Error('secret provider response'));
    const response = await GET(request('state=signed&selling_partner_id=A1SELLER99&spapi_oauth_code=code'));
    expect(response.headers.get('location')).toContain(encodeURIComponent('Amazon connection could not be completed.'));
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'authorize_amazon',
    }));
  });
});