import Dexie, { type EntityTable } from 'dexie';
import type { CachedProduct, DeviceConfig } from './_types';
import type { CatalogueAcknowledgement, CatalogueDelivery } from '@/lib/pos/catalogueProtocol';
import { rebuildTarget } from '@/lib/pos/catalogueProtocol';

interface StoredProduct extends CachedProduct {
  storage_key: string;
  scope: string;
}

export interface ProductSyncMetadata {
  scope: string;
  cached_at: number;
  last_synced_at?: number;
  last_full_sync_at?: number;
  catalogue?: {
    consumerId: string;
    epoch?: string;
    pendingReceipt?: string;
    pendingFullAt?: number;
    pendingNextFullAt?: number;
    nextFullAt?: number;
    rebuildAt?: number;
    serverOffset: number;
    timeZone?: string;
    openingDate?: string;
    openedAt?: number;
    dirtyStockIds?: string[];
  };
}

export interface ProductCacheSnapshot extends ProductSyncMetadata {
  products: CachedProduct[];
}

class PosProductDatabase extends Dexie {
  products!: EntityTable<StoredProduct, 'storage_key'>;
  metadata!: EntityTable<ProductSyncMetadata, 'scope'>;

  constructor() {
    super('solvantis-pos-products');
    this.version(1).stores({
      products: '&storage_key, scope, product_id, barcode, code',
      metadata: '&scope',
    });
  }
}

let database: PosProductDatabase | null = null;

function getDatabase(): PosProductDatabase {
  database ??= new PosProductDatabase();
  return database;
}

export function productCacheScope(config: Pick<DeviceConfig, 'business_id' | 'location_id'>): string {
  return `${config.business_id}:${config.location_id}`;
}

export async function loadPersistentProductsCache(
  config: Pick<DeviceConfig, 'business_id' | 'location_id'>,
): Promise<ProductCacheSnapshot | null> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  const [metadata, rows] = await Promise.all([
    db.metadata.get(scope),
    db.products.where('scope').equals(scope).toArray(),
  ]);
  if (!metadata || !rows.length) return null;
  const products = rows.map(({ storage_key: _storageKey, scope: _scope, ...product }) => product);
  return { ...metadata, products };
}

export async function loadProductSyncMetadata(
  config: Pick<DeviceConfig, 'business_id' | 'location_id'>,
): Promise<ProductSyncMetadata | null> {
  return (await getDatabase().metadata.get(productCacheScope(config))) ?? null;
}

export async function savePersistentProductsCache(input: {
  config: Pick<DeviceConfig, 'business_id' | 'location_id'>;
  products: CachedProduct[];
  serverTime?: number;
  isFullSync?: boolean;
  migratedMetadata?: Pick<ProductSyncMetadata, 'cached_at' | 'last_synced_at' | 'last_full_sync_at'>;
}): Promise<void> {
  const db = getDatabase();
  const scope = productCacheScope(input.config);
  await db.transaction('rw', db.products, db.metadata, async () => {
    const existing = await db.metadata.get(scope);
    if (existing?.catalogue?.epoch && input.serverTime === undefined && !input.migratedMetadata) {
      const stored = await db.products.where('scope').equals(scope).toArray();
      const previous = new Map(stored.map(row => {
        const { storage_key, scope: storedScope, ...product } = row;
        void storage_key;
        void storedScope;
        return [product.variant_id, product] as const;
      }));
      const changed = input.products.filter(product => JSON.stringify(product) !== JSON.stringify(previous.get(product.variant_id)));
      if (changed.length) await db.products.bulkPut(changed.map(product => ({ ...product, scope, storage_key: `${scope}:${product.variant_id}` })));
      return;
    }
    await db.products.where('scope').equals(scope).delete();
    await db.products.bulkPut(input.products.map(product => ({
      ...product,
      scope,
      storage_key: `${scope}:${product.variant_id}`,
    })));
    await db.metadata.put({
      ...existing,
      scope,
      cached_at: input.serverTime != null
        ? Date.now()
        : (input.migratedMetadata?.cached_at ?? existing?.cached_at ?? Date.now()),
      last_synced_at: input.serverTime ?? input.migratedMetadata?.last_synced_at ?? existing?.last_synced_at,
      last_full_sync_at: input.isFullSync
        ? (input.serverTime ?? Date.now())
        : (input.migratedMetadata?.last_full_sync_at ?? existing?.last_full_sync_at),
    });
  });
}

export async function catalogueMetadata(config: Pick<DeviceConfig, 'business_id' | 'location_id'>): Promise<ProductSyncMetadata> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  return db.transaction('rw', db.metadata, async () => {
    const existing = await db.metadata.get(scope) ?? { scope, cached_at: 0 };
    if (!existing.catalogue) {
      existing.catalogue = { consumerId: crypto.randomUUID(), serverOffset: 0 };
      await db.metadata.put(existing);
    }
    return existing;
  });
}

export async function applyCatalogueDelivery(config: DeviceConfig, delivery: CatalogueDelivery): Promise<void> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  if (delivery.businessId !== config.business_id || delivery.locationId !== config.location_id) throw new Error('Catalogue response belongs to a different location.');
  await db.transaction('rw', db.products, db.metadata, async () => {
    const metadata = await db.metadata.get(scope);
    if (!metadata?.catalogue || metadata.catalogue.consumerId !== delivery.consumerId) throw new Error('Catalogue cache identity changed.');
    if (delivery.mode === 'delta' && metadata.catalogue.epoch !== delivery.epoch) throw new Error('Catalogue baseline changed; a full rebuild is required.');
    if (metadata.catalogue.pendingReceipt === delivery.receipt) return;
    if (delivery.mode === 'full') await db.products.where('scope').equals(scope).delete();
    else if (delivery.removed.length) await db.products.bulkDelete(delivery.removed.map(id => `${scope}:${id}`));
    if (delivery.products.length) await db.products.bulkPut(delivery.products.map(product => ({ ...product, scope, storage_key: `${scope}:${product.variant_id}` })));
    await db.metadata.put({
      ...metadata,
      cached_at: delivery.more ? metadata.cached_at : Date.now(),
      last_synced_at: delivery.more ? metadata.last_synced_at : delivery.serverTime,
      last_full_sync_at: metadata.last_full_sync_at,
      catalogue: {
        ...metadata.catalogue, epoch: delivery.epoch, pendingReceipt: delivery.receipt,
        nextFullAt: delivery.mode === 'full' ? metadata.catalogue.nextFullAt : delivery.nextFullAt,
        pendingFullAt: delivery.mode === 'full' ? delivery.serverTime : undefined,
        pendingNextFullAt: delivery.mode === 'full' ? delivery.nextFullAt : undefined,
        serverOffset: delivery.serverTime - Date.now(),
        timeZone: delivery.timeZone,
      },
    });
  });
}

export async function finishCatalogueReceipt(config: DeviceConfig, receipt: string, accepted = true, completion?: CatalogueAcknowledgement): Promise<void> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  await db.transaction('rw', db.metadata, async () => {
    const metadata = await db.metadata.get(scope);
    if (metadata?.catalogue?.pendingReceipt === receipt) {
      if (accepted && metadata.catalogue.pendingFullAt !== undefined) {
        metadata.last_full_sync_at = completion?.completedFullAt ?? metadata.catalogue.pendingFullAt;
        metadata.catalogue.nextFullAt = completion?.nextFullAt ?? metadata.catalogue.pendingNextFullAt;
        metadata.catalogue.rebuildAt = undefined;
      }
      delete metadata.catalogue.pendingReceipt;
      delete metadata.catalogue.pendingFullAt;
      delete metadata.catalogue.pendingNextFullAt;
      await db.metadata.put(metadata);
    }
  });
}

export async function disableCatalogueProtocol(config: DeviceConfig): Promise<void> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  await db.transaction('rw', db.metadata, async () => {
    const metadata = await db.metadata.get(scope);
    if (metadata?.catalogue) {
      metadata.catalogue = { consumerId: metadata.catalogue.consumerId, serverOffset: 0 };
      await db.metadata.put(metadata);
    }
  });
}

export async function persistLocalStockChange(
  config: DeviceConfig, stocks: Pick<CachedProduct, 'variant_id' | 'soh' | 'soh_all' | 'available' | 'available_all'>[],
): Promise<boolean> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  return db.transaction('rw', db.products, db.metadata, async () => {
    const metadata = await db.metadata.get(scope);
    if (!metadata?.catalogue?.epoch) return false;
    const changed: StoredProduct[] = [];
    for (const stock of stocks) {
      const product = await db.products.get(`${scope}:${stock.variant_id}`);
      if (!product) continue;
      changed.push({ ...product, soh: stock.soh, soh_all: stock.soh_all, available: stock.available, available_all: stock.available_all });
    }
    if (changed.length) await db.products.bulkPut(changed);
    metadata.catalogue.dirtyStockIds = [...new Set([...(metadata.catalogue.dirtyStockIds ?? []), ...stocks.map(stock => stock.variant_id)])];
    await db.metadata.put(metadata);
    return true;
  });
}

export async function clearLocalStockChanges(config: DeviceConfig, refreshed: string[]): Promise<void> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  await db.transaction('rw', db.metadata, async () => {
    const metadata = await db.metadata.get(scope);
    if (!metadata?.catalogue) return;
    const ids = new Set(refreshed);
    metadata.catalogue.dirtyStockIds = metadata.catalogue.dirtyStockIds?.filter(id => !ids.has(id));
    await db.metadata.put(metadata);
  });
}

export async function scheduleCatalogueRebuild(config: DeviceConfig, opening = true): Promise<number | undefined> {
  const db = getDatabase();
  const scope = productCacheScope(config);
  return db.transaction('rw', db.metadata, async () => {
    const metadata = await db.metadata.get(scope);
    if (!metadata?.catalogue?.epoch || metadata.catalogue.nextFullAt === undefined) return undefined;
    const now = Date.now() + metadata.catalogue.serverOffset;
    const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: metadata.catalogue.timeZone });
    if (opening && metadata.catalogue.openingDate !== day) {
      metadata.catalogue.openingDate = day;
      metadata.catalogue.openedAt = now;
      await db.metadata.put(metadata);
    }
    if (metadata.catalogue.openingDate !== day && metadata.catalogue.rebuildAt === undefined) return undefined;
    const target = rebuildTarget({ now, openedAt: metadata.catalogue.openedAt, eligibleAt: metadata.catalogue.nextFullAt, pendingAt: metadata.catalogue.rebuildAt, random: Math.random() });
    if (target !== metadata.catalogue.rebuildAt) {
      metadata.catalogue.rebuildAt = target;
      await db.metadata.put(metadata);
    }
    return target === undefined ? undefined : Math.max(0, target - now);
  });
}

export async function requestPersistentPosStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist().catch(() => false);
}

export async function resetProductDatabaseForTests(): Promise<void> {
  if (database) {
    database.close();
    database = null;
  }
  await Dexie.delete('solvantis-pos-products');
}