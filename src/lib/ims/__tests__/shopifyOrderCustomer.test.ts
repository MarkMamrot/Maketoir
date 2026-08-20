import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsExecute, mockImsQuery } = vi.hoisted(() => ({
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mockImsExecute, imsQuery: mockImsQuery }));

import {
  getShopifyOrderCustomerId,
  parseShopifyOrderCustomer,
  resolveShopifyOrderCustomerId,
} from '@/lib/ims/shopifyOrderCustomer';

describe('Shopify order customer resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts only a positive Shopify customer id', () => {
    expect(getShopifyOrderCustomerId({ customer: { id: 12345 } })).toBe('12345');
    expect(getShopifyOrderCustomerId({ customer: null })).toBeNull();
    expect(getShopifyOrderCustomerId({ customer: { id: 'gid://shopify/Customer/12345' } })).toBeNull();
  });

  it('normalizes the supplied Shopify customer fields', () => {
    expect(parseShopifyOrderCustomer({ customer: {
      id: 12345,
      first_name: ' Ada ',
      last_name: ' Lovelace ',
      email: ' ada@example.com ',
      default_address: { address1: '1 Example St', city: 'Melbourne', province: 'VIC', zip: '3000' },
    } })).toMatchObject({
      id: '12345',
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      city: 'Melbourne',
      state: 'VIC',
      postcode: '3000',
    });
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

  it('creates an exact retail contact for an identified Shopify customer', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    mockImsExecute.mockResolvedValueOnce({ insertId: 88 });

    await expect(resolveShopifyOrderCustomerId(
      'business-1',
      { customer: { id: 999, first_name: 'New', last_name: 'Customer', email: 'new@example.com' } },
      7,
      { createIfMissing: true },
    )).resolves.toBe(88);

    expect(mockImsExecute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, 'retail_customer'"),
      expect.arrayContaining(['business-1', 'New Customer', '999']),
    );
    expect(mockImsExecute.mock.calls[0][0]).not.toContain('loyalty_member');
  });

  it('uses the winning contact id when concurrent ingestion creates the same Shopify customer', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    mockImsExecute.mockResolvedValueOnce({ insertId: 91 });

    await expect(resolveShopifyOrderCustomerId(
      'business-1',
      { customer: { id: 999 } },
      7,
      { createIfMissing: true },
    )).resolves.toBe(91);
    expect(mockImsExecute.mock.calls[0][0]).toContain('LAST_INSERT_ID(id)');
  });
});