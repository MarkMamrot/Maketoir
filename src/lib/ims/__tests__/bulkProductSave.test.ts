import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';
import { BulkProductValidationError, createBulkProductSaveService } from '../bulkProductSave';

function product(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'product-client',
    name: 'Harbour Shirt',
    base_sku: 'HLS',
    brand: 'Harbour',
    variants: [{ clientId: 'variant-client', sku: 'HLS-M', option1_name: 'Size', option1_value: 'M' }],
    ...overrides,
  };
}

function connectionWith(responses: unknown[][]) {
  const writes: string[] = [];
  const execute = vi.fn(async (sql: string) => {
    if (/^(INSERT|UPDATE)/.test(sql.trim())) writes.push(sql.trim());
    return [responses.shift() ?? [], []];
  });
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(() => undefined),
    execute,
  } as unknown as PoolConnection;
  return { connection, execute, writes };
}

describe('bulkProductSave', () => {
  it('rolls back without writes when an identifier conflicts', async () => {
    const { connection, writes } = connectionWith([
      [{ product_id: 'existing', product_name: 'Existing Shirt', value: 'HLS' }],
      [],
      [],
    ]);
    const save = createBulkProductSaveService({ getConnection: async () => connection });

    await expect(save('business-1', { products: [product()] })).rejects.toMatchObject({
      name: 'BulkProductValidationError',
      errors: [expect.objectContaining({ clientId: 'product-client', field: 'base_sku' })],
    } satisfies Partial<BulkProductValidationError>);
    expect(writes).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('commits mixed creates and updates and returns client ID mappings', async () => {
    const { connection, writes } = connectionWith([
      [{ product_id: 'product-existing', base_sku: 'OLD' }],
      [{ variant_id: 'variant-existing', product_id: 'product-existing' }],
      [], [], [],
      [], [], [],
      [], [], [], [],
    ]);
    const ids = ['product-new', 'variant-new'];
    const save = createBulkProductSaveService({
      getConnection: async () => connection,
      newId: () => ids.shift() || 'unexpected-id',
    });

    const result = await save('business-1', {
      products: [
        product({
          clientId: 'existing-client',
          productId: 'product-existing',
          base_sku: 'HLS-EDIT',
          variants: [{ clientId: 'existing-variant-client', variantId: 'variant-existing', sku: 'HLS-EDIT-M' }],
        }),
        product({ clientId: 'new-client', name: 'New Shirt', base_sku: 'NEW', variants: [{ clientId: 'new-variant-client', sku: 'NEW' }] }),
      ],
    });

    expect(result).toMatchObject({
      success: true,
      created: 1,
      updated: 1,
      mappings: [
        { clientId: 'existing-client', productId: 'product-existing', variants: [{ clientId: 'existing-variant-client', variantId: 'variant-existing' }] },
        { clientId: 'new-client', productId: 'product-new', variants: [{ clientId: 'new-variant-client', variantId: 'variant-new' }] },
      ],
    });
    expect(writes.filter(sql => sql.startsWith('UPDATE ims_products'))).toHaveLength(1);
    expect(writes.filter(sql => sql.startsWith('INSERT INTO ims_products'))).toHaveLength(1);
    expect(writes.filter(sql => sql.startsWith('UPDATE ims_product_variants'))).toHaveLength(1);
    expect(writes.filter(sql => sql.startsWith('INSERT INTO ims_product_variants'))).toHaveLength(1);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('rejects a supplier that is not owned by the active business', async () => {
    const { connection, execute, writes } = connectionWith([[]]);
    const save = createBulkProductSaveService({ getConnection: async () => connection });

    await expect(save('business-1', {
      products: [product({ supplier_contact_id: 91 })],
    })).rejects.toMatchObject({
      name: 'BulkProductValidationError',
      errors: [expect.objectContaining({ clientId: 'product-client', field: 'supplier_contact_id' })],
    } satisfies Partial<BulkProductValidationError>);
    expect(execute).toHaveBeenCalledWith(
      'SELECT id FROM ims_contacts WHERE business_id = ? AND id = ? LIMIT 1',
      ['business-1', 91],
    );
    expect(writes).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});