import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueDelivery } from '@/lib/pos/catalogueProtocol';
import {
  applyCatalogueDelivery, catalogueMetadata, finishCatalogueReceipt, loadPersistentProductsCache,
  loadProductSyncMetadata, resetProductDatabaseForTests, savePersistentProductsCache, scheduleCatalogueRebuild,
  persistLocalStockChange,
} from '../_productDatabase';

const config = { business_id: 'alpha', location_id: 1, location_name: 'Alpha', register_id: 1, register_name: 'Till' };
const product = (id: string) => ({
  variant_id: id, product_id: `p-${id}`, name: id, code: id, barcode: null, brand: null,
  price: 10, original_price: null, cost: 5, soh: 2, soh_all: 2, available: 2, available_all: 2, image_url: null,
});
async function delivery(overrides: Partial<CatalogueDelivery> = {}): Promise<CatalogueDelivery> {
  const metadata = await catalogueMetadata(config);
  return {
    protocol: 2, mode: 'full', businessId: 'alpha', locationId: 1, consumerId: metadata.catalogue!.consumerId,
    epoch: 'epoch', receipt: crypto.randomUUID(), serverTime: Date.now(), nextFullAt: Date.now() + 10000,
    timeZone: 'Australia/Sydney', products: [product('a'), product('b')], removed: [], more: false, ...overrides,
  };
}
afterEach(async () => { vi.restoreAllMocks(); await resetProductDatabaseForTests(); });

describe('incremental catalogue persistence', () => {
  it('upserts/deletes selectively and preserves unrelated rows and full date', async () => {
    const full = await delivery();
    await applyCatalogueDelivery(config, full);
    await finishCatalogueReceipt(config, full.receipt);
    await applyCatalogueDelivery(config, await delivery({
      mode: 'delta', products: [{ ...product('a'), price: 15 }, product('c')], removed: ['b'],
    }));
    const cache = await loadPersistentProductsCache(config);
    expect(cache?.products.map(p => p.variant_id).sort()).toEqual(['a', 'c']);
    expect(cache?.products.find(p => p.variant_id === 'a')?.price).toBe(15);
    expect(cache?.last_full_sync_at).toBe(full.serverTime);
  });

  it('an empty delta retains the same catalogue', async () => {
    await applyCatalogueDelivery(config, await delivery());
    await applyCatalogueDelivery(config, await delivery({ mode: 'delta', products: [] }));
    expect((await loadPersistentProductsCache(config))?.products).toEqual([product('a'), product('b')]);
  });

  it('writes metadata only for an empty delta, and exactly one product for a one-product delta', async () => {
    const full = await delivery();
    await applyCatalogueDelivery(config, full);
    await finishCatalogueReceipt(config, full.receipt);
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    const deletes = vi.spyOn(IDBObjectStore.prototype, 'delete');
    await applyCatalogueDelivery(config, await delivery({ mode: 'delta', products: [] }));
    expect(writes).toHaveBeenCalledTimes(1);
    expect(deletes).not.toHaveBeenCalled();
    writes.mockClear();
    await applyCatalogueDelivery(config, await delivery({ mode: 'delta', products: [{ ...product('a'), price: 22 }] }));
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('does not count an unacknowledged or failed full delivery as a successful rebuild', async () => {
    const full = await delivery();
    await applyCatalogueDelivery(config, full);
    expect((await loadProductSyncMetadata(config))?.last_full_sync_at).toBeUndefined();
    await finishCatalogueReceipt(config, full.receipt, false);
    expect((await loadProductSyncMetadata(config))?.last_full_sync_at).toBeUndefined();
  });

  it('does not replay a persisted full receipt over a newer local update', async () => {
    const full = await delivery();
    await applyCatalogueDelivery(config, full);
    await savePersistentProductsCache({ config, products: [{ ...product('a'), soh: 1 }, product('b')] });
    await applyCatalogueDelivery(config, full);
    expect((await loadPersistentProductsCache(config))?.products.find(p => p.variant_id === 'a')?.soh).toBe(1);
  });

  it('cannot apply another location or cache consumer delivery', async () => {
    await expect(applyCatalogueDelivery(config, await delivery({ locationId: 2 }))).rejects.toThrow();
    await expect(applyCatalogueDelivery(config, await delivery({ consumerId: 'different' }))).rejects.toThrow();
  });

  it('keeps full replacement and receipt atomic when bulkPut fails', async () => {
    await applyCatalogueDelivery(config, await delivery());
    const bad = await delivery({ products: [product('replacement')] });
    Object.defineProperty(bad.products[0], 'price', { get() { throw new Error('storage failure'); } });
    await expect(applyCatalogueDelivery(config, bad)).rejects.toThrow('storage failure');
    expect((await loadPersistentProductsCache(config))?.products.map(p => p.variant_id).sort()).toEqual(['a', 'b']);
  });

  it('retains pending receipt until the exact acknowledgement', async () => {
    const full = await delivery();
    await applyCatalogueDelivery(config, full);
    await finishCatalogueReceipt(config, 'wrong');
    expect((await loadProductSyncMetadata(config))?.catalogue?.pendingReceipt).toBe(full.receipt);
    await finishCatalogueReceipt(config, full.receipt);
    expect((await loadProductSyncMetadata(config))?.catalogue?.pendingReceipt).toBeUndefined();
  });

  it('persists absolute optimistic stock without subtracting it twice or overwriting source fields', async () => {
    const full = await delivery();
    await applyCatalogueDelivery(config, full);
    await finishCatalogueReceipt(config, full.receipt);
    const stock = { ...product('a'), soh: 1, available: 1, price: 999 };
    await persistLocalStockChange(config, [stock]);
    await persistLocalStockChange(config, [stock]);
    const cache = await loadPersistentProductsCache(config);
    expect(cache?.products.find(product => product.variant_id === 'a')).toMatchObject({ soh: 1, available: 1, price: 10 });
    expect(cache?.catalogue?.dirtyStockIds).toEqual(['a']);
  });

  it('uses acknowledged completion time for calendar-month eligibility', async () => {
    const full = await delivery();
    await applyCatalogueDelivery(config, full);
    await finishCatalogueReceipt(config, full.receipt, true, {
      acknowledged: true, completedFullAt: full.serverTime + 5000, nextFullAt: full.nextFullAt + 5000,
    });
    const metadata = await loadProductSyncMetadata(config);
    expect(metadata?.last_full_sync_at).toBe(full.serverTime + 5000);
    expect(metadata?.catalogue?.nextFullAt).toBe(full.nextFullAt + 5000);
  });

  it('persists random rebuild target instead of resampling on every opening', async () => {
    const full = await delivery({ nextFullAt: Date.now() - 1 });
    await applyCatalogueDelivery(config, full);
    await finishCatalogueReceipt(config, full.receipt);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const first = await scheduleCatalogueRebuild(config);
    random.mockReturnValue(0);
    const second = await scheduleCatalogueRebuild(config);
    expect(first).toBeGreaterThan(3_599_000);
    expect(second).toBeGreaterThan(3_599_000);
  });

  it('waits for the next authenticated opening if eligibility is outside today’s two-hour window', async () => {
    const now = Date.parse('2026-10-16T20:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const full = await delivery({ nextFullAt: now + 3 * 60 * 60 * 1000 });
    await applyCatalogueDelivery(config, full);
    await finishCatalogueReceipt(config, full.receipt);
    expect(await scheduleCatalogueRebuild(config)).toBeUndefined();
    clock.mockReturnValue(now + 4 * 60 * 60 * 1000);
    expect(await scheduleCatalogueRebuild(config, false)).toBeUndefined();
    clock.mockReturnValue(now + 24 * 60 * 60 * 1000);
    expect(await scheduleCatalogueRebuild(config, true)).toBe(60 * 60 * 1000);
  });
});
