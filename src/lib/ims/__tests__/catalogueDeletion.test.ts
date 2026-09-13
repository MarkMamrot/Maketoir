import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  guard: vi.fn(),
}));

const connection = {
  execute: mocks.execute,
  beginTransaction: mocks.beginTransaction,
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: mocks.release,
};

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: vi.fn(async () => connection) }),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
}));
vi.mock('../costing/fifoCostingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../costing/fifoCostingService')>();
  return { ...actual, assertFifoCatalogueDeletionAllowed: mocks.guard };
});

import { FifoCostingConflict } from '../costing/fifoCostingService';
import { ImsProductsRepo, ImsVariantsRepo } from '../ImsRepository';

describe('FIFO-safe catalogue deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('guards every tenant-owned child variant before deleting a product', async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT variant_id')) return [[{ variant_id: 'v-1' }, { variant_id: 'v-2' }]];
      return [{ affectedRows: 1 }];
    });

    await ImsProductsRepo.delete('p-1', 'biz-1');

    expect(mocks.guard).toHaveBeenCalledWith(connection, {
      businessId: 'biz-1', variantIds: ['v-1', 'v-2'], label: 'This product',
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ims_products WHERE product_id = ? AND business_id = ?'),
      ['p-1', 'biz-1'],
    );
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it('tenant-scopes variant deletion after the FIFO guard passes', async () => {
    await ImsVariantsRepo.delete('v-1', 'biz-1');

    expect(mocks.guard).toHaveBeenCalledWith(connection, {
      businessId: 'biz-1', variantIds: ['v-1'], label: 'This variant',
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ims_product_variants WHERE variant_id = ? AND business_id = ?'),
      ['v-1', 'biz-1'],
    );
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('rolls back without deleting when FIFO history blocks the operation', async () => {
    mocks.guard.mockRejectedValue(new FifoCostingConflict('FIFO cost history exists.'));

    await expect(ImsVariantsRepo.delete('v-1', 'biz-1')).rejects.toMatchObject({
      code: 'FIFO_COSTING_CONFLICT',
    });

    expect(mocks.execute).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ims_product_variants'), expect.anything());
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
