import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  isShopifyFallbackProduct: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/shopifyFallbackVariant', () => ({ isShopifyFallbackProduct: mocks.isShopifyFallbackProduct }));

import { PUT } from '../route';

function request(updates: unknown[], locationId = 7) {
  return new Request('http://localhost/api/ims/products/bulk-edit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_id: locationId, updates }),
  });
}

const cases: Array<{
  name: string;
  fields: { min_qty?: number | null; reorder_qty?: number | null };
  updateClause: string;
  insertValues: Array<number | null>;
}> = [
  { name: 'Min only', fields: { min_qty: 8 }, updateClause: 'min_qty = VALUES(min_qty)', insertValues: [8, null] },
  { name: 'Reorder only', fields: { reorder_qty: 6 }, updateClause: 'reorder_qty = VALUES(reorder_qty)', insertValues: [null, 6] },
  {
    name: 'both settings', fields: { min_qty: 8, reorder_qty: 6 },
    updateClause: 'min_qty = VALUES(min_qty), reorder_qty = VALUES(reorder_qty)', insertValues: [8, 6],
  },
  { name: 'Min explicitly zero', fields: { min_qty: 0 }, updateClause: 'min_qty = VALUES(min_qty)', insertValues: [0, null] },
  { name: 'Reorder explicitly zero', fields: { reorder_qty: 0 }, updateClause: 'reorder_qty = VALUES(reorder_qty)', insertValues: [null, 0] },
  { name: 'Min explicitly null', fields: { min_qty: null }, updateClause: 'min_qty = VALUES(min_qty)', insertValues: [null, null] },
  { name: 'Reorder explicitly null', fields: { reorder_qty: null }, updateClause: 'reorder_qty = VALUES(reorder_qty)', insertValues: [null, null] },
  {
    name: 'both settings zero', fields: { min_qty: 0, reorder_qty: 0 },
    updateClause: 'min_qty = VALUES(min_qty), reorder_qty = VALUES(reorder_qty)', insertValues: [0, 0],
  },
  {
    name: 'both settings null', fields: { min_qty: null, reorder_qty: null },
    updateClause: 'min_qty = VALUES(min_qty), reorder_qty = VALUES(reorder_qty)', insertValues: [null, null],
  },
];

describe('PUT /api/ims/products/bulk-edit replenishment settings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.isShopifyFallbackProduct.mockResolvedValue(false);
    mocks.imsQuery.mockResolvedValue([{ variant_id: 'variant-1' }, { variant_id: 'variant-2' }]);
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it.each(cases)('updates only supplied fields for $name and defaults new rows to zero', async ({ fields, updateClause, insertValues }) => {
    const response = await PUT(request([{ product_id: 'product-1', ...fields }]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true, productUpdates: 0, stockUpdates: 2, variantUpdates: 0, skippedSystemProducts: 0,
    });
    expect(mocks.isShopifyFallbackProduct).toHaveBeenCalledWith('product-1', 'business-1');
    expect(mocks.getSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.imsQuery.mock.invocationCallOrder[0]);
    expect(mocks.imsQuery).toHaveBeenCalledExactlyOnceWith(
      'SELECT variant_id FROM ims_product_variants WHERE product_id = ? AND is_active = 1',
      ['product-1'],
    );
    expect(mocks.imsExecute).toHaveBeenCalledTimes(2);
    for (const [index, variantId] of ['variant-1', 'variant-2'].entries()) {
      const [sql, values] = mocks.imsExecute.mock.calls[index];
      expect(sql.replace(/\s+/g, ' ').trim()).toBe(
        'INSERT INTO ims_stock (variant_id, location_id, min_qty, reorder_qty) '
        + 'VALUES (?, ?, COALESCE(?,0), COALESCE(?,0)) ON DUPLICATE KEY UPDATE ' + updateClause,
      );
      expect(values).toEqual([variantId, 7, ...insertValues]);
    }
  });

  it('does not write stock settings when neither quantity was edited', async () => {
    const response = await PUT(request([{ product_id: 'product-1', brand: 'Example Brand' }]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ productUpdates: 1, stockUpdates: 0 });
    expect(mocks.imsQuery).not.toHaveBeenCalled();
    expect(mocks.imsExecute).toHaveBeenCalledExactlyOnceWith(
      'UPDATE ims_products SET brand = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?',
      ['Example Brand', 'product-1'],
    );
  });

  it('does not create settings for products without active variants', async () => {
    mocks.imsQuery.mockResolvedValue([]);
    const response = await PUT(request([{ product_id: 'product-1', min_qty: 8 }]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ stockUpdates: 0 });
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('keeps system fallback products protected', async () => {
    mocks.isShopifyFallbackProduct.mockResolvedValue(true);
    const response = await PUT(request([{ product_id: 'product-1', min_qty: 8 }]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ stockUpdates: 0, skippedSystemProducts: 1 });
    expect(mocks.imsQuery).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated saves before any database access', async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await PUT(request([{ product_id: 'product-1', min_qty: 8 }]));

    expect(response.status).toBe(401);
    expect(mocks.isShopifyFallbackProduct).not.toHaveBeenCalled();
    expect(mocks.imsQuery).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('rejects a missing branch before any stock access', async () => {
    const response = await PUT(request([{ product_id: 'product-1', min_qty: 8 }], 0));

    expect(response.status).toBe(400);
    expect(mocks.imsQuery).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });
});
