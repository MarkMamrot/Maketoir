import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  shopifyDisabledResponse: vi.fn(),
  getOperationContext: vi.fn(),
  ensureSchema: vi.fn(),
  getMapping: vi.fn(),
  recordMapping: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
  getCustomerPage: vi.fn(),
  getOrdersForSync: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: mocks.shopifyDisabledResponse }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({
  getShopifyOperationContext: mocks.getOperationContext,
  ShopifyOperationContextError: class ShopifyOperationContextError extends Error {},
}));
vi.mock('@/lib/ims/ensureContactShopifyCustomerSchema', () => ({ ensureContactShopifyCustomerSchema: mocks.ensureSchema }));
vi.mock('@/lib/ims/contactChannelMappings', () => ({ getContactChannelMapping: mocks.getMapping, recordInboundContactChannelMapping: mocks.recordMapping }));
vi.mock('@/lib/ims/shopifyCustomerSync', () => ({ syncRetailCustomerToShopify: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.execute, imsQuery: mocks.query }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: vi.fn(function () {
    return { getCustomerPage: mocks.getCustomerPage, getOrdersForSync: mocks.getOrdersForSync };
  }),
}));

import { POST } from '../route';

function pull(options: Record<string, unknown> = {}) {
  return POST(new Request('http://localhost/api/ims/shopify/sync-customers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'pull', channelInstanceId: 'store-1', ...options }),
  }));
}

describe('POST /api/ims/shopify/sync-customers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.shopifyDisabledResponse.mockResolvedValue(null);
    mocks.getOperationContext.mockResolvedValue({ credentials: { shopDomain: 'test.myshopify.com', token: 'test-token' } });
    mocks.getMapping.mockResolvedValue(null);
    mocks.recordMapping.mockResolvedValue({ mappingStatus: 'linked' });
    mocks.query.mockResolvedValue([]);
    mocks.execute.mockResolvedValue({ insertId: 42 });
    mocks.getOrdersForSync.mockResolvedValue([]);
    mocks.getCustomerPage.mockResolvedValue({
      customers: [
        { id: 1, created_at: '2000-01-01', state: 'enabled' },
        { id: 2, created_at: '2000-01-01', state: 'disabled' },
        { id: 3 },
      ],
      nextPageInfo: null,
    });
  });

  it('requires explicit storefront selection before schema or credential work', async () => {
    const response = await POST(new Request('http://localhost/api/ims/shopify/sync-customers', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'pull' }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'channelInstanceId is required.' });
    expect(mocks.ensureSchema).not.toHaveBeenCalled();
    expect(mocks.getOperationContext).not.toHaveBeenCalled();
  });

  it.each([null, '', '  ', 0, '0'])('uses no activity cutoff for %j, but preserves Shopify-disabled status', async inactiveAfterMonths => {
    const response = await pull({ inactiveAfterMonths });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, created: 3, total: 3 });
    expect(mocks.getOrdersForSync).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.map(([, values]) => values[9])).toEqual([1, 0, 1]);
  });

  it.each(['mapped', 'email'])('reactivates an old inactive contact matched by %s without a cutoff', async match => {
    const existing = { id: 42, type: 'retail_customer', name: 'In-store customer', email: 'customer@example.com', is_active: 0 };
    mocks.getCustomerPage.mockResolvedValue({
      customers: [{ id: 1, email: existing.email, created_at: '2000-01-01' }],
      nextPageInfo: null,
    });
    if (match === 'mapped') mocks.getMapping.mockResolvedValue({ mappingStatus: 'linked', contactId: 42 });
    mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM ims_contacts') ? [existing] : []);

    const response = await pull({ inactiveAfterMonths: null });

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith('UPDATE ims_contacts SET is_active = ? WHERE id = ?', [1, 42]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.getOrdersForSync).not.toHaveBeenCalled();
  });

  it.each([{}, { inactiveAfterMonths: 60 }, { inactiveAfterMonths: '60' }])('retains the 60-month cutoff for %j', async options => {
    const response = await pull(options);

    expect(response.status).toBe(200);
    expect(mocks.getOrdersForSync).toHaveBeenCalledWith(60);
    expect(mocks.execute.mock.calls.map(([, values]) => values[9])).toEqual([0, 0, 0]);
    expect(await response.json()).toMatchObject({ created: 3, total: 3 });
  });

  it('keeps recent customers and customers with recent Shopify orders active with a cutoff', async () => {
    mocks.getCustomerPage.mockResolvedValue({
      customers: [
        { id: 1, created_at: '2000-01-01' },
        { id: 2, created_at: new Date().toISOString() },
        { id: 3, state: 'disabled', created_at: new Date().toISOString() },
      ],
      nextPageInfo: 'next-page',
    });
    mocks.getOrdersForSync.mockResolvedValue([{ customer: { id: 1 } }]);

    const response = await pull({ inactiveAfterMonths: 12, pageInfo: 'current-page' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hasMore: true, nextPageInfo: 'next-page' });
    expect(mocks.getCustomerPage).toHaveBeenCalledWith('current-page', 100);
    expect(mocks.getOrdersForSync).toHaveBeenCalledWith(12);
    expect(mocks.execute.mock.calls.map(([, values]) => values[9])).toEqual([1, 1, 0]);
  });

  it.each([-1, 1.5, 'invalid', false, {}])('rejects invalid activity limits: %j', async inactiveAfterMonths => {
    const response = await pull({ inactiveAfterMonths });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Inactive after must be blank or a non-negative whole number of months.' });
    expect(mocks.ensureSchema).not.toHaveBeenCalled();
    expect(mocks.getCustomerPage).not.toHaveBeenCalled();
  });
});