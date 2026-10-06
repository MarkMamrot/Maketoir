import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCurrentImsDb, mockGetPool, mockImsExecute, mockImsQuery, mockConnection } = vi.hoisted(() => ({
  mockGetCurrentImsDb: vi.fn(() => 'tenant-a'),
  mockGetPool: vi.fn(),
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
  mockConnection: {
    beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  },
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetPool,
  imsExecute: mockImsExecute,
  imsQuery: mockImsQuery,
}));

vi.mock('@/services/imsContext', () => ({
  getCurrentImsDb: mockGetCurrentImsDb,
}));

import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';

const expectCollationSafeAttemptJoin = (sql: string) => {
  expect(sql).toContain('BINARY variant.business_id = BINARY mapping.business_id');
  expect(sql).toContain('BINARY variant.variant_id = BINARY mapping.variant_id');
  expect(sql).toContain('wa.business_id COLLATE utf8mb4_general_ci = p.business_id');
  expect(sql).toContain('wa.product_id COLLATE utf8mb4_general_ci = p.product_id');
};

describe('ImsShopifyRepo.listWithShopifyStatus', () => {
  beforeEach(() => {
    mockGetCurrentImsDb.mockReturnValue('tenant-a');
    mockImsExecute.mockReset().mockResolvedValue({});
    mockImsQuery.mockReset();
  });

  it('uses collation-safe joins for channel mappings and website attempts', async () => {
    mockImsQuery.mockResolvedValue([]);

    await ImsShopifyRepo.listWithShopifyStatus('business-1', 'store-1');

    expectCollationSafeAttemptJoin(mockImsQuery.mock.calls[0][0]);
  });

  it('keeps the collation-safe join in the legacy supplier fallback', async () => {
    mockImsQuery
      .mockRejectedValueOnce(new Error('Unknown column p.supplier_contact_id'))
      .mockResolvedValue([]);

    await ImsShopifyRepo.listWithShopifyStatus('business-1', 'store-1');

    expectCollationSafeAttemptJoin(mockImsQuery.mock.calls[1][0]);
  });
});

describe('ImsShopifyRepo.linkVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(mockConnection) });
    mockConnection.execute.mockImplementation(async (sql: string) =>
      sql.trimStart().startsWith('SELECT') ? [[]] : [{ affectedRows: 1 }]);
  });

  it('commits legacy identifiers and the exact-instance mapping in one transaction', async () => {
    await ImsShopifyRepo.linkVariant(
      'variant-1', 'product-2', 'external-variant-3', 'inventory-4', 'business-5', 'store-6',
    );

    expect(mockConnection.beginTransaction).toHaveBeenCalledOnce();
    expect(mockConnection.execute.mock.calls[0][0]).toContain('ims_sales_channel_product_mappings');
    expect(mockConnection.execute.mock.calls[1][0]).toContain('ims_product_variants');
    expect(mockConnection.execute.mock.calls[2][0]).toContain('SET shopify_variant_id = ?');
    expect(mockConnection.execute.mock.calls[3][0]).toContain('ims_sales_channel_product_mappings');
    expect(mockConnection.execute.mock.calls[3][1]).toEqual([
      'business-5', 'store-6', 'variant-1', 'product-2', 'external-variant-3', 'inventory-4',
    ]);
    expect(mockConnection.commit).toHaveBeenCalledOnce();
    expect(mockConnection.rollback).not.toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalledOnce();
  });

  it('rolls back before writing legacy identifiers when another variant owns the Shopify identity', async () => {
    mockConnection.execute.mockResolvedValueOnce([[{ variant_id: 'variant-other' }]]);

    await expect(ImsShopifyRepo.linkVariant(
      'variant-1', 'product-2', 'external-variant-3', 'inventory-4', 'business-5', 'store-6',
    )).rejects.toThrow('already linked to another Solvantis variant');

    expect(mockConnection.execute).toHaveBeenCalledOnce();
    expect(mockConnection.commit).not.toHaveBeenCalled();
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
    expect(mockConnection.release).toHaveBeenCalledOnce();
  });

  it('rolls back when another legacy variant carries the Shopify identity', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ variant_id: 'variant-other' }]]);

    await expect(ImsShopifyRepo.linkVariant(
      'variant-1', 'product-2', 'external-variant-3', 'inventory-4', 'business-5', 'store-6',
    )).rejects.toThrow('already linked to another Solvantis variant');

    expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    expect(mockConnection.commit).not.toHaveBeenCalled();
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
    expect(mockConnection.release).toHaveBeenCalledOnce();
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