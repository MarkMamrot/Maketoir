import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueDelivery } from '@/lib/pos/catalogueProtocol';
import { refreshCatalogue, type CatalogueRefreshOptions } from '../_catalogueSync';
import {
  applyCatalogueDelivery, catalogueMetadata, finishCatalogueReceipt, loadPersistentProductsCache,
  loadProductSyncMetadata, resetProductDatabaseForTests,
} from '../_productDatabase';

const config = { business_id: 'alpha', location_id: 1, location_name: 'Branch', register_id: 1, register_name: 'Till' };
const product = {
  variant_id: 'v', product_id: 'p', name: 'Shirt', code: 'SKU', barcode: null, brand: null,
  price: 20, original_price: null, cost: 10, soh: 10, soh_all: 10, available: 10, available_all: 10, image_url: null,
};
const fetchMock = vi.fn<typeof fetch>();
let options: CatalogueRefreshOptions;
let full: CatalogueDelivery;
let requests: Record<string, unknown>[];

beforeEach(async () => {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => Promise<unknown>) => work() } });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  requests = [];
  const metadata = await catalogueMetadata(config);
  full = {
    protocol: 2, mode: 'full', businessId: 'alpha', locationId: 1, consumerId: metadata.catalogue!.consumerId,
    epoch: 'epoch', receipt: crypto.randomUUID(), serverTime: Date.now(), nextFullAt: Date.now() + 10000,
    timeZone: 'Australia/Sydney', products: [product], removed: [], more: false,
  };
  options = {
    config, full: false, signal: new AbortController().signal, isCurrent: () => true,
    protectStock: products => products, apply: vi.fn(), pendingStock: () => new Set(),
  };
});
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await resetProductDatabaseForTests(); });

function serve(deliveries: unknown[]) {
  fetchMock.mockImplementation(async (_url, init) => {
    const request: Record<string, unknown> = JSON.parse(String(init?.body));
    requests.push(request);
    if (request.renew) return Response.json({ renewed: true });
    if (request.ack) return Response.json({ acknowledged: true, completedFullAt: full.serverTime + 100, nextFullAt: full.nextFullAt + 100 });
    if (!deliveries.length) throw new Error('Unexpected catalogue fetch.');
    return Response.json(deliveries.shift());
  });
}
const empty = (full: CatalogueDelivery): CatalogueDelivery => ({ ...full, mode: 'delta', receipt: crypto.randomUUID(), products: [] });
async function initialize() {
  await applyCatalogueDelivery(config, full);
  await finishCatalogueReceipt(config, full.receipt);
}

describe('shared catalogue refresh', () => {
  it('renews a full lease, durably acknowledges it, then catches up with a delta', async () => {
    serve([full, empty(full)]);
    expect(await refreshCatalogue(options)).toBe('fresh');
    expect(requests.map(request => request.renew ? 'renew' : request.ack ? 'ack' : request.full ? 'full' : 'delta'))
      .toEqual(['full', 'renew', 'ack', 'delta', 'ack']);
    expect((await loadProductSyncMetadata(config))?.last_full_sync_at).toBe(full.serverTime + 100);
    expect((await loadPersistentProductsCache(config))?.products).toEqual([product]);
  });

  it('preserves explicit disabled and deferred outcomes instead of reporting success', async () => {
    serve([{ protocol: 2, mode: 'disabled', retryAfterMs: 300000 }]);
    expect(await refreshCatalogue(options)).toBe('disabled');
    serve([{ protocol: 2, mode: 'deferred', retryAfterMs: 15000 }]);
    expect(await refreshCatalogue(options)).toBe('deferred');
    expect((await loadProductSyncMetadata(config))?.last_full_sync_at).toBeUndefined();
  });

  it('preserves legacy operation on browsers without Web Locks when the protocol is disabled', async () => {
    await initialize();
    vi.stubGlobal('navigator', {});
    serve([{ protocol: 2, mode: 'disabled', retryAfterMs: 300000 }]);
    expect(await refreshCatalogue(options)).toBe('disabled');
    expect(requests[0].supportsLocks).toBe(false);
    expect((await loadProductSyncMetadata(config))?.catalogue?.epoch).toBeUndefined();
  });

  it('recovers a lost acknowledgement before asking for another delivery', async () => {
    await initialize();
    const delta: CatalogueDelivery = { ...full, mode: 'delta', receipt: crypto.randomUUID(), products: [{ ...product, price: 25 }] };
    await applyCatalogueDelivery(config, delta);
    serve([empty(full)]);
    await refreshCatalogue(options);
    expect(requests[0].ack).toBe(delta.receipt);
    expect((await loadPersistentProductsCache(config))?.products[0].price).toBe(25);
    expect((await loadProductSyncMetadata(config))?.catalogue?.pendingReceipt).toBeUndefined();
  });

  it('retains a receipt if acknowledgement cannot reach the server', async () => {
    serve([full]);
    const successfulFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (JSON.parse(String(init?.body)).ack) return Response.json({ error: 'offline' }, { status: 503 });
      return successfulFetch(url, init);
    });
    await expect(refreshCatalogue(options)).rejects.toThrow('HTTP 503');
    const metadata = await loadProductSyncMetadata(config);
    expect(metadata?.catalogue?.pendingReceipt).toBe(full.receipt);
    expect(metadata?.last_full_sync_at).toBeUndefined();
  });

  it('restores another tab’s committed catalogue before an empty shared-consumer delta', async () => {
    await initialize();
    const changed: CatalogueDelivery = { ...full, mode: 'delta', receipt: crypto.randomUUID(), products: [{ ...product, price: 29 }] };
    await applyCatalogueDelivery(config, changed);
    await finishCatalogueReceipt(config, changed.receipt);
    serve([empty(full)]);
    await refreshCatalogue(options);
    expect(options.apply).toHaveBeenCalledWith([{ ...product, price: 29 }], [], true);
  });

  it('ignores a response after the active device scope changes', async () => {
    let current = true;
    options.isCurrent = () => current;
    fetchMock.mockImplementation(async () => { current = false; return Response.json(full); });
    await expect(refreshCatalogue(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await loadPersistentProductsCache(config)).toBeNull();
    expect((await loadProductSyncMetadata(config))?.catalogue?.pendingReceipt).toBeUndefined();
  });

  it('does not fetch or mutate storage for a cancelled session', async () => {
    options.isCurrent = () => false;
    await expect(refreshCatalogue(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed records without acknowledging or replacing the cache', async () => {
    serve([{ ...full, products: [{ ...product, price: 'invalid' }] }]);
    await expect(refreshCatalogue(options)).rejects.toThrow('Invalid catalogue delivery');
    expect(requests).toHaveLength(1);
    expect(await loadPersistentProductsCache(config)).toBeNull();
  });

  it('refuses to apply a full response if its lease cannot be renewed', async () => {
    serve([full]);
    const successfulFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (JSON.parse(String(init?.body)).renew) return Response.json({ error: 'expired' }, { status: 409 });
      return successfulFetch(url, init);
    });
    await expect(refreshCatalogue(options)).rejects.toThrow('HTTP 409');
    expect(await loadPersistentProductsCache(config)).toBeNull();
    expect(requests.some(request => request.ack)).toBe(false);
  });
});
