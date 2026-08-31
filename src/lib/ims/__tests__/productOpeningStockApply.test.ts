import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), create: vi.fn(), hash: vi.fn(), transition: vi.fn(), apply: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('../ImsRepository', () => ({ ImsStocktakeRepo: { create: mocks.create } }));
vi.mock('../inventoryDocumentLifecycle', () => ({ hashInventoryDocumentRequest: mocks.hash }));
vi.mock('../stocktakes/stocktakeOperations', () => ({
  transitionStocktake: mocks.transition,
  applyStocktake: mocks.apply,
}));

import { applyProductOpeningStock } from '../productOpeningStock';

const input = {
  businessId: 'business-1',
  productId: 'product-1',
  requestToken: 'request-token-123',
  actorId: 7,
  actorName: 'Alex',
  lines: [{ variantId: 'variant-1', locationId: 3, quantity: 4, minQty: 0, reorderQty: 0 }],
};

function arrangeOwnedEntities(existingStocktake: Array<{ id: number; status: string }> = []) {
  mocks.query.mockImplementation((sql: string) => {
    if (sql.includes('FROM ims_products')) return Promise.resolve([{ product_id: 'product-1', is_stock_item: 1 }]);
    if (sql.includes('FROM ims_product_variants')) return Promise.resolve([{ variant_id: 'variant-1' }]);
    if (sql.includes('FROM ims_locations')) return Promise.resolve([{ id: 3, name: 'Main Store' }]);
    if (sql.includes('FROM ims_stocktakes')) return Promise.resolve(existingStocktake);
    throw new Error(`Unexpected query: ${sql}`);
  });
}

describe('applyProductOpeningStock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hash.mockResolvedValue('request-hash');
    mocks.create.mockResolvedValue(31);
    mocks.transition.mockResolvedValue({ replayed: false });
    mocks.apply.mockResolvedValue({ id: 31, status: 'completed', applied: 1, variances: 1, replayed: false });
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
  });

  it('creates and applies a stocktake with stable operation keys and zero-valued replenishment metadata', async () => {
    arrangeOwnedEntities();

    const result = await applyProductOpeningStock(input);

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ location_id: 3, blank: true }), 'business-1');
    expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', stocktakeId: 31,
      context: expect.objectContaining({ operationKey: 'product-opening-start-request-token-123-3', requestHash: 'request-hash', actorId: 7 }),
    }));
    expect(mocks.execute).toHaveBeenNthCalledWith(2, expect.stringContaining('min_qty = VALUES(min_qty)'),
      ['business-1', 'variant-1', 3, 0, 0]);
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      stocktakeId: 31, context: expect.objectContaining({ operationKey: 'product-opening-apply-request-token-123-3' }),
    }));
    expect(result.locations).toEqual([expect.objectContaining({ locationId: 3, stocktakeId: 31, replayed: false })]);
  });

  it('reuses an in-progress stocktake on a partial retry', async () => {
    arrangeOwnedEntities([{ id: 44, status: 'in_progress' }]);

    await applyProductOpeningStock(input);

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({ stocktakeId: 44 }));
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ stocktakeId: 44 }));
  });

  it('does not rewrite completed stocktake items or replenishment metadata on replay', async () => {
    arrangeOwnedEntities([{ id: 44, status: 'completed' }]);

    await applyProductOpeningStock(input);

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ stocktakeId: 44 }));
  });

  it('rejects variants that do not belong to the product before creating stocktakes', async () => {
    arrangeOwnedEntities();
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM ims_products')) return Promise.resolve([{ product_id: 'product-1', is_stock_item: 1 }]);
      if (sql.includes('FROM ims_product_variants')) return Promise.resolve([]);
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(applyProductOpeningStock(input)).rejects.toThrow('do not belong to this product');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});