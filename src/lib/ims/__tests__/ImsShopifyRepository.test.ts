import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(),
  imsExecute: vi.fn(),
  imsQuery: mockImsQuery,
}));

import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';

const expectCollationSafeAttemptJoin = (sql: string) => {
  expect(sql).toContain('wa.business_id COLLATE utf8mb4_general_ci = p.business_id');
  expect(sql).toContain('wa.product_id COLLATE utf8mb4_general_ci = p.product_id');
};

describe('ImsShopifyRepo.listWithShopifyStatus', () => {
  beforeEach(() => {
    mockImsQuery.mockReset();
  });

  it('uses explicit collations when joining website attempts to products', async () => {
    mockImsQuery.mockResolvedValue([]);

    await ImsShopifyRepo.listWithShopifyStatus('business-1');

    expectCollationSafeAttemptJoin(mockImsQuery.mock.calls[0][0]);
  });

  it('keeps the collation-safe join in the legacy supplier fallback', async () => {
    mockImsQuery
      .mockRejectedValueOnce(new Error('Unknown column p.supplier_contact_id'))
      .mockResolvedValue([]);

    await ImsShopifyRepo.listWithShopifyStatus('business-1');

    expectCollationSafeAttemptJoin(mockImsQuery.mock.calls[1][0]);
  });
});