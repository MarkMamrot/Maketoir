import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { getShopifyOrderCustomerId, resolveShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';

describe('Shopify order customer resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts only a positive Shopify customer id', () => {
    expect(getShopifyOrderCustomerId({ customer: { id: 12345 } })).toBe('12345');
    expect(getShopifyOrderCustomerId({ customer: null })).toBeNull();
    expect(getShopifyOrderCustomerId({ customer: { id: 'gid://shopify/Customer/12345' } })).toBeNull();
  });

  it('resolves an exact tenant-scoped Shopify customer match', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 42 }]);

    await expect(resolveShopifyOrderCustomerId('business-1', { customer: { id: 12345 } }, 7)).resolves.toBe(42);
    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('shopify_customer_id = ?'), ['business-1', '12345']);
  });

  it('retains the operational fallback for guest or unknown customers', async () => {
    await expect(resolveShopifyOrderCustomerId('business-1', { customer: null }, 7)).resolves.toBe(7);
    expect(mockImsQuery).not.toHaveBeenCalled();

    mockImsQuery.mockResolvedValueOnce([]);
    await expect(resolveShopifyOrderCustomerId('business-1', { customer: { id: 999 } }, 7)).resolves.toBe(7);
  });
});