import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), execute: vi.fn(), context: vi.fn(), create: vi.fn(), report: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: JSON.stringify({ businessId: 'biz-1' }) }) }) }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/lib/channels/shopifyInstanceSettings', () => ({ shopifyInstanceSettings: () => ({ giftCards: { mode: 'combined' } }) }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class { createGiftCard = mocks.create; } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { POST } from '../route';

describe('POS gift card code validation', () => {
  const request = (code: string | undefined, channelInstanceId = 'shop-1') => new Request('http://localhost/api/pos/gift-card', {
    method: 'POST', body: JSON.stringify({ code, channelInstanceId, amount: 50 }),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.query.mockResolvedValue([]);
    mocks.execute.mockResolvedValue({ insertId: 1 });
    mocks.context.mockResolvedValue({ instance: { settings: {} }, credentials: { shopDomain: 'example.myshopify.com', token: 'test' } });
    mocks.create.mockResolvedValue({ id: 123, code: 'GENERATED123', currency: 'AUD' });
  });
  it('rejects a short trimmed Shopify code before database or provider calls', async () => {
    const response = await POST(request('  ABC1234  '));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Shopify gift card codes must contain at least 8 characters.' });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('accepts an eight-character Shopify code', async () => {
    expect((await POST(request('ABC12345'))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ initial_value: 50, code: 'ABC12345' });
  });
  it('allows Shopify to generate a code when none is supplied', async () => {
    expect((await POST(request(undefined))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ initial_value: 50 });
  });
  it('preserves short local-only codes', async () => {
    expect((await POST(request('ABCD', ''))).status).toBe(201);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});