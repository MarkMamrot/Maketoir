import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveBySlug: vi.fn(),
  getAuthRateLimit: vi.fn(),
  recordAuthFailure: vi.fn(),
  getShopifyAdminCredentials: vi.fn(),
  findCustomersByExactEmail: vi.fn(),
  runImsForBusiness: vi.fn(),
  upsertLoyaltyPortalCustomer: vi.fn(),
  createCustomerOtp: vi.fn(),
  send: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/loyalty/LoyaltyPortalProfile', () => ({ LoyaltyPortalProfileRepository: { getActiveBySlug: mocks.getActiveBySlug } }));
vi.mock('@/lib/auth/authRateLimit', () => ({
  createAuthRateLimitSubject: vi.fn(() => 'subject-hash'),
  getAuthRateLimit: mocks.getAuthRateLimit,
  recordAuthFailure: mocks.recordAuthFailure,
}));
vi.mock('@/lib/shopifyCredentials', () => ({ getShopifyAdminCredentials: mocks.getShopifyAdminCredentials }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/lib/loyalty/LoyaltyPortalIdentity', () => ({ upsertLoyaltyPortalCustomer: mocks.upsertLoyaltyPortalCustomer }));
vi.mock('@/lib/onlineShop/onlineShopOtp', () => ({
  ONLINE_SHOP_OTP_EXPIRES_SECONDS: 600,
  createCustomerOtp: mocks.createCustomerOtp,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class ShopifyService {
    findCustomersByExactEmail = mocks.findCustomersByExactEmail;
  },
}));
vi.mock('resend', () => ({ Resend: class Resend { emails = { send: mocks.send }; } }));

import { POST } from '../route';

const request = () => new Request('https://solvantis.com.au/api/loyalty/monsterthreads-rewards/auth/code/request', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1' },
  body: JSON.stringify({ email: 'customer@example.com' }),
});

describe('loyalty portal code request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('RESEND_API_KEY', 'resend-test-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Solvantis <rewards@solvantis.example>');
    mocks.getActiveBySlug.mockResolvedValue({ businessId: 'business-1', displayName: 'Monsterthreads Rewards' });
    mocks.getAuthRateLimit.mockResolvedValue({ locked: false });
    mocks.getShopifyAdminCredentials.mockResolvedValue({ shopDomain: 'example.myshopify.com', token: 'secret' });
    mocks.findCustomersByExactEmail.mockResolvedValue([{ id: 99, email: 'customer@example.com', firstName: 'Ada', lastName: null, phone: null }]);
    mocks.runImsForBusiness.mockImplementation(async (_businessId, callback) => callback());
    mocks.upsertLoyaltyPortalCustomer.mockResolvedValue(42);
    mocks.createCustomerOtp.mockResolvedValue({ challengeToken: 'challenge-token', code: '123456' });
    mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    mocks.reportRuntimeIssue.mockResolvedValue(null);
  });

  it('links the Shopify customer, creates a loyalty challenge, and sends the code', async () => {
    const response = await POST(request(), { params: { slug: 'monsterthreads-rewards' } });

    expect(await response.json()).toMatchObject({ success: true, challengeToken: 'challenge-token', expiresInSeconds: 600 });
    expect(mocks.createCustomerOtp).toHaveBeenCalledWith({ businessId: 'business-1', contactId: 42, email: 'customer@example.com', purpose: 'loyalty_portal' });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Solvantis <rewards@solvantis.example>',
      to: 'customer@example.com',
      subject: expect.stringContaining('123456'),
    }), { idempotencyKey: 'loyalty-portal-otp-challenge-token' });
  });

  it('records a contact-link failure without exposing the email in context', async () => {
    mocks.upsertLoyaltyPortalCustomer.mockRejectedValue(new Error("Unknown column 'deleted_at' in 'where clause'"));

    const response = await POST(request(), { params: { slug: 'monsterthreads-rewards' } });

    expect((await response.json()).challengeToken).not.toBe('challenge-token');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      operation: 'request_code',
      context: { stage: 'link_ims_contact' },
    }));
  });

  it('identifies missing email delivery configuration after challenge creation', async () => {
    vi.stubEnv('RESEND_API_KEY', '');

    await POST(request(), { params: { slug: 'monsterthreads-rewards' } });

    expect(mocks.createCustomerOtp).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      context: { stage: 'configure_email' },
    }));
  });
});