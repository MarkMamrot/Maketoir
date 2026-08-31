import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadPersistentProductsCache,
  loadProductSyncMetadata,
  productCacheScope,
  resetProductDatabaseForTests,
  savePersistentProductsCache,
} from '../_productDatabase';

const alpha = { business_id: 'alpha', location_id: 1 };
const beta = { business_id: 'beta', location_id: 2 };

function product(variantId: string) {
  return {
    variant_id: variantId,
    product_id: `product-${variantId}`,
    code: `SKU-${variantId}`,
    barcode: `BARCODE-${variantId}`,
    name: `Product ${variantId}`,
    brand: null,
    price: 10,
    original_price: null,
    cost: 5,
    soh: 2,
    soh_all: 2,
    available: 2,
    available_all: 2,
    image_url: null,
  };
}

describe('POS IndexedDB product cache', () => {
  afterEach(() => resetProductDatabaseForTests());

  it('persists products and sync metadata across database reopen', async () => {
    await savePersistentProductsCache({
      config: alpha,
      products: [product('one'), product('two')],
      serverTime: 1_000,
      isFullSync: true,
    });

    const firstRead = await loadPersistentProductsCache(alpha);
    expect(firstRead).toMatchObject({
      scope: productCacheScope(alpha),
      last_synced_at: 1_000,
      last_full_sync_at: 1_000,
    });
    expect(firstRead?.products.map(item => item.variant_id).sort()).toEqual(['one', 'two']);
    await expect(loadProductSyncMetadata(alpha)).resolves.toMatchObject({
      last_synced_at: 1_000,
      last_full_sync_at: 1_000,
    });
  });

  it('keeps catalogues isolated by business and location', async () => {
    await savePersistentProductsCache({ config: alpha, products: [product('alpha')] });
    await savePersistentProductsCache({ config: beta, products: [product('beta')] });

    expect((await loadPersistentProductsCache(alpha))?.products[0]?.variant_id).toBe('alpha');
    expect((await loadPersistentProductsCache(beta))?.products[0]?.variant_id).toBe('beta');
  });

  it('atomically replaces a full catalogue while retaining the last full-sync watermark', async () => {
    await savePersistentProductsCache({ config: alpha, products: [product('old')], serverTime: 1_000, isFullSync: true });
    await savePersistentProductsCache({ config: alpha, products: [product('new')], serverTime: 2_000, isFullSync: false });

    const snapshot = await loadPersistentProductsCache(alpha);
    expect(snapshot?.products.map(item => item.variant_id)).toEqual(['new']);
    expect(snapshot).toMatchObject({ last_synced_at: 2_000, last_full_sync_at: 1_000 });
  });
});
