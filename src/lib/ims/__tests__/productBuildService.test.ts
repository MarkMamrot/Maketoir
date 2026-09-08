import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: mocks.getConnection }),
}));

vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { previewProductBuildBatch } from '../builds/buildService';
import { saveProductBuildRecipe } from '../builds/recipeService';

const connection = {
  execute: mocks.execute,
  beginTransaction: mocks.beginTransaction,
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: mocks.release,
};

describe('product build services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue(connection);
  });

  it('previews component availability as on hand less committed', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ id: 7 }], []])
      .mockResolvedValueOnce([[
        { recipe_id: 3, version_id: 9, output_variant_id: 'kit', revision: 2, base_output_quantity: 1, overhead_per_output: 1, component_variant_id: 'part-a', quantity_per_output: 2, sort_order: 0 },
      ], []])
      .mockResolvedValueOnce([[
        { variant_id: 'kit', product_id: 'p-kit', sku: 'KIT', product_name: 'Kit', is_active: 1, product_active: 1, is_stock_item: 1, avg_cost: 3, cost_aud: 3 },
        { variant_id: 'part-a', product_id: 'p-a', sku: 'PART', product_name: 'Part', is_active: 1, product_active: 1, is_stock_item: 1, avg_cost: 4, cost_aud: 4 },
      ], []])
      .mockResolvedValueOnce([[
        { variant_id: 'kit', location_id: 7, qty_on_hand: 1, qty_committed: 0 },
        { variant_id: 'part-a', location_id: 7, qty_on_hand: 10, qty_committed: 5 },
      ], []]);

    const result = await previewProductBuildBatch({
      businessId: 'business-1',
      locationId: 7,
      builds: [{ outputVariantId: 'kit', quantity: 3, recipeRevision: 2 }],
    });

    expect(result.canComplete).toBe(false);
    expect(result.components).toEqual([expect.objectContaining({
      variantId: 'part-a', onHand: 10, committed: 5, available: 5, required: 6, after: -1,
    })]);
    expect(result.builds[0]).toEqual(expect.objectContaining({ outputUnitCost: 9 }));
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('keeps component quantities per output when recipe metadata has a larger base quantity', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ id: 7 }], []])
      .mockResolvedValueOnce([[
        { recipe_id: 3, version_id: 9, output_variant_id: 'kit', revision: 2, base_output_quantity: 5, overhead_per_output: 0, component_variant_id: 'part-a', quantity_per_output: 2, sort_order: 0 },
      ], []])
      .mockResolvedValueOnce([[
        { variant_id: 'kit', product_id: 'p-kit', sku: 'KIT', product_name: 'Kit', is_active: 1, product_active: 1, is_stock_item: 1, avg_cost: 3, cost_aud: 3 },
        { variant_id: 'part-a', product_id: 'p-a', sku: 'PART', product_name: 'Part', is_active: 1, product_active: 1, is_stock_item: 1, avg_cost: 4, cost_aud: 4 },
      ], []])
      .mockResolvedValueOnce([[
        { variant_id: 'kit', location_id: 7, qty_on_hand: 0, qty_committed: 0 },
        { variant_id: 'part-a', location_id: 7, qty_on_hand: 20, qty_committed: 0 },
      ], []]);

    const result = await previewProductBuildBatch({
      businessId: 'business-1',
      locationId: 7,
      builds: [{ outputVariantId: 'kit', quantity: 3, recipeRevision: 2 }],
    });

    expect(result.components[0]).toEqual(expect.objectContaining({ required: 6 }));
  });

  it('saves a recipe by appending a version and advancing the active pointer', async () => {
    mocks.execute
      .mockResolvedValueOnce([[
        { variant_id: 'kit', product_id: 'product-1', variant_active: 1, product_active: 1, is_stock_item: 1 },
        { variant_id: 'part-a', product_id: 'product-2', variant_active: 1, product_active: 1, is_stock_item: 1 },
      ], []])
      .mockResolvedValueOnce([[{ id: 4, active_version_id: 8, revision: 2 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 9 }, []])
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[
        { id: 4, business_id: 'business-1', output_variant_id: 'kit', active_version_id: 9, is_enabled: 1, product_id: 'product-1', product_name: 'Kit', output_sku: 'KIT', output_label: 'Kit', revision: 3, base_output_quantity: 1, overhead_per_output: 1.5, notes: null, created_by: 10, created_by_name: 'Builder', version_created_at: '2026-09-08 00:00:00' },
      ], []])
      .mockResolvedValueOnce([[
        { recipe_version_id: 9, component_variant_id: 'part-a', product_id: 'product-2', product_name: 'Part', sku: 'PART', component_label: 'Part', quantity_per_output: 2, average_cost: 4, sort_order: 0 },
      ], []]);

    const result = await saveProductBuildRecipe({
      businessId: 'business-1',
      productId: 'product-1',
      outputVariantId: 'kit',
      components: [{ variantId: 'part-a', quantityPerOutput: 2 }],
      overheadPerOutput: 1.5,
      expectedRevision: 2,
      actorId: 10,
      actorName: 'Builder',
    });

    expect(result.revision).toBe(3);
    expect(mocks.commit).toHaveBeenCalledOnce();
    const sql = mocks.execute.mock.calls.map(([statement]) => String(statement));
    expect(sql.some(statement => statement.includes('INSERT INTO ims_product_build_recipe_versions'))).toBe(true);
    expect(sql.some(statement => statement.includes('INSERT INTO ims_product_build_recipe_components'))).toBe(true);
    expect(sql.some(statement => statement.includes('UPDATE ims_product_build_recipe_components'))).toBe(false);
  });
});