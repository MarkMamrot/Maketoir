import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getProductsSyncWatermark,
  loadProductsCache,
  needsFullProductsResync,
  saveProductsCache,
} from '../_productCache';
import { loadProductSyncMetadata, resetProductDatabaseForTests } from '../_productDatabase';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const config = {
  business_id: 'alpha',
  location_id: 1,
  location_name: 'Alpha',
  register_id: 1,
  register_name: 'A1',
};

const product = { variant_id: 'variant-1', product_id: 'product-1', barcode: '9346524000001' } as any;

describe('POS product cache adapter', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createStorage(), configurable: true });
    localStorage.setItem('pos_device_config', JSON.stringify(config));
  });

  afterEach(() => resetProductDatabaseForTests());

  it('migrates and verifies the legacy tenant catalogue before removing it', async () => {
    const syncedAt = Date.now() - 1_000;
    localStorage.setItem('pos_products_cache:alpha', JSON.stringify({
      cached_at: syncedAt,
      last_synced_at: syncedAt,
      last_full_sync_at: syncedAt,
      products: [product],
    }));

    expect(await loadProductsCache(config)).toEqual([product]);
    expect(localStorage.getItem('pos_products_cache:alpha')).toBeNull();
    expect(await loadProductsCache(config)).toEqual([product]);
    expect(await getProductsSyncWatermark(config)).toBe(syncedAt);
    expect(await needsFullProductsResync(config)).toBe(false);
  });

  it('persists a catalogue without writing the localStorage product key', async () => {
    expect(await saveProductsCache({ config, products: [product], serverTime: 1_000, isFullSync: true })).toBe(true);

    expect(localStorage.getItem('pos_products_cache:alpha')).toBeNull();
    expect(await loadProductsCache(config)).toEqual([product]);
  });

  it('does not make server sync metadata newer for a local product update', async () => {
    await saveProductsCache({ config, products: [product], serverTime: 1_000, isFullSync: true });
    const before = await loadProductSyncMetadata(config);

    await saveProductsCache({ config, products: [{ ...product, stock_qty: 2 }] });

    await expect(loadProductSyncMetadata(config)).resolves.toEqual(before);
  });
});