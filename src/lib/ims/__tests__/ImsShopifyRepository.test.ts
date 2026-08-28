import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCurrentImsDb, mockImsExecute, mockImsQuery } = vi.hoisted(() => ({
  mockGetCurrentImsDb: vi.fn(() => 'tenant-a'),
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(),
  imsExecute: mockImsExecute,
  imsQuery: mockImsQuery,
}));

vi.mock('@/services/imsContext', () => ({
  getCurrentImsDb: mockGetCurrentImsDb,
}));

import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';

const expectCollationSafeAttemptJoin = (sql: string) => {
  expect(sql).toContain('wa.business_id COLLATE utf8mb4_general_ci = p.business_id');
  expect(sql).toContain('wa.product_id COLLATE utf8mb4_general_ci = p.product_id');
};

describe('ImsShopifyRepo.listWithShopifyStatus', () => {
  beforeEach(() => {
    mockGetCurrentImsDb.mockReturnValue('tenant-a');
    mockImsExecute.mockReset().mockResolvedValue({});
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

describe('ImsShopifyRepo sync log schema', () => {
  it('ensures the table once for each tenant schema before logging', async () => {
    await ImsShopifyRepo.logAction('reconcile', 'success', 'First', 'business-1');
    await ImsShopifyRepo.logAction('reconcile', 'success', 'Second', 'business-1');

    expect(mockImsExecute.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS ims_shopify_sync_log'))).toHaveLength(1);

    mockGetCurrentImsDb.mockReturnValue('tenant-b');
    await ImsShopifyRepo.logAction('reconcile', 'success', 'Other tenant', 'business-2');

    expect(mockImsExecute.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS ims_shopify_sync_log'))).toHaveLength(2);
  });
});