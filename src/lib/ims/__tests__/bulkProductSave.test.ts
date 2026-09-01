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

function locationStockConnection() {
  const execute = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('select product_id, base_sku, is_stock_item')) return [[{ product_id: 'product-existing', base_sku: 'HLS', is_stock_item: 1 }], []];
    if (normalized.startsWith('select v.variant_id, v.product_id')) return [[{ variant_id: 'variant-existing', product_id: 'product-existing' }], []];
    if (normalized.startsWith('select id from ims_locations')) return [[{ id: 7 }], []];
    if (normalized.startsWith('select `key`, value from ims_settings')) return [[
      { key: 'product_allow_opening_stock', value: 'yes' },
      { key: 'product_show_replenishment_quantities', value: 'yes' },
      { key: 'use_zones_bins', value: 'yes' },
    ], []];
    if (normalized.startsWith('select product_id, name as product_name')) return [[], []];
    if (normalized.startsWith('select v.product_id, p.name as product_name')) return [[], []];
    if (normalized.startsWith('insert into ims_stocktakes')) return [{ insertId: 44 }, []];
    return [[], []];
  });
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(() => undefined),
    execute,
  } as unknown as PoolConnection;
  return { connection, execute };
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
    expect(writes.find(sql => sql.startsWith('UPDATE ims_product_variants'))).not.toContain('cost_foreign = ?');
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

  it('rejects an existing variant ID on a new product before opening a transaction', async () => {
    const getConnection = vi.fn();
    const save = createBulkProductSaveService({ getConnection });

    await expect(save('business-1', {
      products: [product({ variants: [{ clientId: 'variant-client', variantId: 'variant-existing', sku: 'HLS-M' }] })],
    })).rejects.toMatchObject({
      name: 'BulkProductValidationError',
      errors: [expect.objectContaining({ clientId: 'variant-client', field: 'variantId' })],
    } satisfies Partial<BulkProductValidationError>);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('adds a variant to an existing product without deleting unsubmitted variants', async () => {
    const { connection, execute, writes } = connectionWith([
      [{ product_id: 'product-existing', base_sku: 'HLS' }],
      [{ variant_id: 'variant-existing', product_id: 'product-existing' }],
      [],
      [],
      [],
    ]);
    const save = createBulkProductSaveService({
      getConnection: async () => connection,
      newId: () => 'variant-new',
    });

    const result = await save('business-1', {
      products: [product({
        productId: 'product-existing',
        variants: [
          { clientId: 'variant-existing-client', variantId: 'variant-existing', sku: 'HLS-M' },
          { clientId: 'variant-new-client', sku: 'HLS-L' },
        ],
      })],
    });

    expect(result.mappings[0].variants).toEqual([
      { clientId: 'variant-existing-client', variantId: 'variant-existing' },
      { clientId: 'variant-new-client', variantId: 'variant-new' },
    ]);
    expect(writes.some(sql => sql.startsWith('DELETE'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('variant-unsubmitted'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects SOH edits when opening stock is disabled in Product settings', async () => {
    const { connection } = connectionWith([
      [{ product_id: 'product-existing', base_sku: 'HLS', is_stock_item: 1 }],
      [{ variant_id: 'variant-existing', product_id: 'product-existing' }],
      [{ id: 7 }],
      [{ key: 'product_allow_opening_stock', value: 'no' }],
      [],
      [],
    ]);
    const save = createBulkProductSaveService({ getConnection: async () => connection });

    await expect(save('business-1', { products: [product({
      productId: 'product-existing',
      variants: [{ clientId: 'variant-client', variantId: 'variant-existing', sku: 'HLS-M', locationStock: [{ locationId: 7, quantity: 5 }] }],
    })] })).rejects.toMatchObject({
      errors: [expect.objectContaining({ field: 'location_7_soh' })],
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('completes explicit SOH counts on the bulk transaction before commit', async () => {
    const { connection, execute } = locationStockConnection();
    const applyStocktake = vi.fn(async () => ({ id: 44, status: 'completed' as const, applied: 1, variances: 1, countStartVariances: 1, replayed: false }));
    const save = createBulkProductSaveService({ getConnection: async () => connection, applyStocktake });

    await save('business-1', {
      requestToken: 'request-token-123',
      products: [product({
        productId: 'product-existing',
        variants: [{ clientId: 'variant-client', variantId: 'variant-existing', sku: 'HLS-M', locationStock: [{ locationId: 7, quantity: 5, minQty: 2, reorderQty: 3, zone: 'A', bin: '12' }] }],
      })],
    });

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock (business_id, variant_id, location_id'))).toBe(true);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stocktake_items'))).toBe(true);
    expect(applyStocktake).toHaveBeenCalledWith(connection, expect.objectContaining({ businessId: 'business-1', stocktakeId: 44 }));
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('rolls back all product changes when stocktake completion fails', async () => {
    const { connection } = locationStockConnection();
    const applyStocktake = vi.fn(async () => { throw new Error('stocktake failed'); });
    const save = createBulkProductSaveService({ getConnection: async () => connection, applyStocktake });

    await expect(save('business-1', {
      requestToken: 'request-token-123',
      products: [product({
        productId: 'product-existing',
        variants: [{ clientId: 'variant-client', variantId: 'variant-existing', sku: 'HLS-M', locationStock: [{ locationId: 7, quantity: 5 }] }],
      })],
    })).rejects.toThrow('stocktake failed');
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});