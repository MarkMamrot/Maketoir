import { beforeEach, describe, expect, it, vi } from 'vitest';

const { imsQuery, imsExecute } = vi.hoisted(() => ({ imsQuery: vi.fn(), imsExecute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery, imsExecute }));
import { upsertLoyaltyPortalCustomer } from '../LoyaltyPortalIdentity';

describe('loyalty portal identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates by Shopify ID without enabling loyalty', async () => {
    imsQuery.mockResolvedValue([]);
    imsExecute.mockResolvedValue({ insertId: 42 });
    await expect(upsertLoyaltyPortalCustomer('biz-1', {
      id: 99, email: 'buyer@example.com', firstName: 'Ada', lastName: 'Lovelace', phone: null,
    })).resolves.toBe(42);
    expect(imsExecute.mock.calls[0][0]).toContain('shopify_customer_id');
    expect(imsExecute.mock.calls[0][0]).not.toContain('loyalty_member');
  });

  it('updates only the exact Shopify-linked contact', async () => {
    imsQuery.mockResolvedValue([{ id: 7 }]);
    imsExecute.mockResolvedValue({ affectedRows: 1 });
    await expect(upsertLoyaltyPortalCustomer('biz-1', {
      id: 99, email: 'buyer@example.com', firstName: null, lastName: null, phone: null,
    })).resolves.toBe(7);
    expect(imsExecute.mock.calls[0][1].slice(-3)).toEqual([7, 'biz-1', '99']);
  });
});