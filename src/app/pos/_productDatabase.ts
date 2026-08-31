import Dexie, { type EntityTable } from 'dexie';
import type { CachedProduct, DeviceConfig } from './_types';

interface StoredProduct extends CachedProduct {
  storage_key: string;
  scope: string;
}

interface ProductSyncMetadata {
  scope: string;
  cached_at: number;
  last_synced_at?: number;
  last_full_sync_at?: number;
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
    await db.products.where('scope').equals(scope).delete();
    await db.products.bulkPut(input.products.map(product => ({
      ...product,
      scope,
      storage_key: `${scope}:${product.variant_id}`,
    })));
    await db.metadata.put({
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