import type { CachedProduct, DeviceConfig } from './_types';
import { parseCatalogueResponse } from '@/lib/pos/catalogueProtocol';
import {
  applyCatalogueDelivery, catalogueMetadata, finishCatalogueReceipt, scheduleCatalogueRebuild,
  disableCatalogueProtocol, clearLocalStockChanges, loadPersistentProductsCache,
  loadProductSyncMetadata,
} from './_productDatabase';

export async function withCatalogueLock<T>(config: DeviceConfig, task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) {
    if ((await loadProductSyncMetadata(config))?.catalogue?.epoch) throw new CatalogueBrowserError();
    return task();
  }
  return await navigator.locks.request<Promise<T>>(`pos-catalogue:${config.business_id}:${config.location_id}`, task);
}

export class CatalogueBrowserError extends Error {
  constructor() { super('Update this browser before using incremental catalogue sync.'); }
}

export class CatalogueHttpError extends Error {
  constructor(public readonly status: number) { super(`Catalogue refresh returned HTTP ${status}.`); }
}

export interface CatalogueRefreshOptions {
  config: DeviceConfig;
  full: boolean;
  signal: AbortSignal;
  isCurrent: () => boolean;
  protectStock: (products: CachedProduct[], fromCache?: boolean) => CachedProduct[];
  apply: (products: CachedProduct[], removed: string[], full: boolean) => void;
  pendingStock: () => Set<string>;
}

export class CatalogueDeferredError extends Error {
  constructor() { super('Catalogue rebuild is waiting for another register. Retry shortly.'); }
}

export async function refreshCatalogue(options: CatalogueRefreshOptions): Promise<'disabled' | 'fresh' | 'deferred'> {
  const run = async (): Promise<'disabled' | 'fresh' | 'deferred'> => {
    const metadata = await catalogueMetadata(options.config);
    const catalogue = metadata.catalogue;
    if (!catalogue) throw new Error('Catalogue cache identity is unavailable.');
    if (!options.isCurrent()) throw new DOMException('Catalogue session changed.', 'AbortError');
    // Another tab may have advanced the shared consumer while this tab was idle.
    const cached = await loadPersistentProductsCache(options.config);
    if (cached && options.isCurrent()) options.apply(options.protectStock(cached.products, true), [], true);
    const url = `/api/pos/products/sync?location_id=${options.config.location_id}`;
    const send = async (body: { consumerId: string; full: boolean; ack?: string; renew?: string; refreshIds?: string[] }) => {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, supportsLocks: Boolean(navigator.locks) }), signal: options.signal, cache: 'no-store',
      });
      if (!response.ok) throw new CatalogueHttpError(response.status);
      return response.json() as Promise<unknown>;
    };
    const acknowledge = async (receipt: string) => {
      const response = await send({ consumerId: catalogue.consumerId, full: false, ack: receipt });
      if (typeof response === 'object' && response !== null && 'mode' in response && response.mode === 'disabled') {
        await disableCatalogueProtocol(options.config);
        return;
      }
      if (typeof response !== 'object' || response === null || !('acknowledged' in response) || response.acknowledged !== true
        || !('completedFullAt' in response) || typeof response.completedFullAt !== 'number' || !Number.isFinite(response.completedFullAt)
        || !('nextFullAt' in response) || typeof response.nextFullAt !== 'number' || !Number.isFinite(response.nextFullAt)) {
        throw new Error('Catalogue acknowledgement was not confirmed.');
      }
      await finishCatalogueReceipt(options.config, receipt, true, {
        acknowledged: true, completedFullAt: response.completedFullAt, nextFullAt: response.nextFullAt,
      });
    };
    if (catalogue.pendingReceipt) {
      try { await acknowledge(catalogue.pendingReceipt); }
      catch (error) {
        if (error instanceof CatalogueHttpError && error.status === 409) await finishCatalogueReceipt(options.config, catalogue.pendingReceipt, false);
        else throw error;
      }
    }
    let full = options.full || !catalogue.epoch;
    const pendingAtStart = options.pendingStock();
    const forced = (catalogue.dirtyStockIds ?? []).filter(id => !pendingAtStart.has(id)).slice(0, 400);
    for (let page = 0; page < 50; page++) {
      if (!options.isCurrent()) throw new DOMException('Catalogue session changed.', 'AbortError');
      const started = performance.now();
      const delivery = parseCatalogueResponse(await send({ consumerId: catalogue.consumerId, full, refreshIds: page === 0 ? forced : [] }));
      if (delivery.mode === 'disabled') {
        await disableCatalogueProtocol(options.config);
        return 'disabled';
      }
      if (delivery.mode === 'deferred') return 'deferred';
      if (!('products' in delivery)) throw new Error('Catalogue response has no products.');
      if (delivery.mode === 'full' && performance.now() - started >= 120_000) throw new Error('Full catalogue delivery took too long; retry safely.');
      if (!options.isCurrent()) throw new DOMException('Catalogue session changed.', 'AbortError');
      if (delivery.consumerId !== catalogue.consumerId) throw new Error('Catalogue consumer mismatch.');
      const renew = async () => {
        const response = await send({ consumerId: catalogue.consumerId, full: false, renew: delivery.receipt });
        if (typeof response !== 'object' || response === null || !('renewed' in response) || response.renewed !== true) {
          throw new Error('Full catalogue lease renewal was not confirmed.');
        }
      };
      let renewal: Promise<void> | undefined;
      let leaseFailure: unknown;
      if (delivery.mode === 'full') await renew();
      const heartbeat = delivery.mode === 'full' ? setInterval(() => {
        if (!renewal && !leaseFailure) {
          renewal = renew().catch(error => { leaseFailure = error; }).finally(() => { renewal = undefined; });
        }
      }, 45_000) : undefined;
      try {
        const protectedDelivery = { ...delivery, products: options.protectStock(delivery.products) };
        await applyCatalogueDelivery(options.config, protectedDelivery);
        if (options.isCurrent()) options.apply(protectedDelivery.products, delivery.removed, delivery.mode === 'full');
        clearInterval(heartbeat);
        await renewal;
        if (leaseFailure) throw leaseFailure;
        await acknowledge(delivery.receipt);
      } finally {
        clearInterval(heartbeat);
        await renewal;
      }
      // A full snapshot is followed by a delta to catch commits during its download.
      if (!delivery.more && delivery.mode === 'delta') {
        const pending = options.pendingStock();
        await clearLocalStockChanges(options.config, forced.filter(id => !pending.has(id)));
        return 'fresh';
      }
      full = false;
    }
    throw new Error('Catalogue catch-up is still pending. Keep POS online and retry Sync.');
  };
  return navigator.locks ? withCatalogueLock(options.config, run) : run();
}

export { scheduleCatalogueRebuild };
