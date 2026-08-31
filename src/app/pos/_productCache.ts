import type { CachedProduct, DeviceConfig } from './_types';
import {
  clearLegacyProductsCache,
  loadProductsCache as loadLegacyProductsCache,
  readProductsEnvelope,
  saveProductsCache as saveLegacyProductsCache,
} from './_store';
import {
  loadPersistentProductsCache,
  loadProductSyncMetadata,
  requestPersistentPosStorage,
  savePersistentProductsCache,
  type ProductCacheSnapshot,
} from './_productDatabase';

export const PRODUCTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const FULL_RESYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function migrateLegacyCache(config: DeviceConfig): Promise<ProductCacheSnapshot | null> {
  const legacy = readProductsEnvelope();
  if (!legacy?.products.length) return null;
  await savePersistentProductsCache({
    config,
    products: legacy.products,
    migratedMetadata: {
      cached_at: legacy.cached_at,
      last_synced_at: legacy.last_synced_at,
      last_full_sync_at: legacy.last_full_sync_at,
    },
  });
  const migrated = await loadPersistentProductsCache(config);
  if (migrated?.products.length === legacy.products.length) clearLegacyProductsCache();
  return migrated;
}

export async function loadProductsCache(config: DeviceConfig): Promise<CachedProduct[]> {
  try {
    const persistent = await loadPersistentProductsCache(config);
    if (persistent) return persistent.products;
    return (await migrateLegacyCache(config))?.products ?? [];
  } catch {
    return loadLegacyProductsCache();
  }
}

export async function saveProductsCache(input: {
  config: DeviceConfig;
  products: CachedProduct[];
  serverTime?: number;
  isFullSync?: boolean;
}): Promise<boolean> {
  try {
    await savePersistentProductsCache(input);
    clearLegacyProductsCache();
    return true;
  } catch {
    return saveLegacyProductsCache(input.products);
  }
}

export async function getProductsSyncWatermark(config: DeviceConfig): Promise<number | null> {
  try {
    return (await loadProductSyncMetadata(config))?.last_synced_at ?? null;
  } catch {
    return readProductsEnvelope()?.last_synced_at ?? null;
  }
}

export async function needsFullProductsResync(config: DeviceConfig): Promise<boolean> {
  try {
    const lastFull = (await loadProductSyncMetadata(config))?.last_full_sync_at;
    return !lastFull || Date.now() - lastFull > FULL_RESYNC_INTERVAL_MS;
  } catch {
    const lastFull = readProductsEnvelope()?.last_full_sync_at;
    return !lastFull || Date.now() - lastFull > FULL_RESYNC_INTERVAL_MS;
  }
}

export async function isProductsCacheStale(config: DeviceConfig): Promise<boolean> {
  try {
    const cachedAt = (await loadProductSyncMetadata(config))?.cached_at;
    return !cachedAt || Date.now() - cachedAt > PRODUCTS_CACHE_TTL_MS;
  } catch {
    const cachedAt = readProductsEnvelope()?.cached_at;
    return !cachedAt || Date.now() - cachedAt > PRODUCTS_CACHE_TTL_MS;
  }
}

export function requestProductCachePersistence(): void {
  void requestPersistentPosStorage();
}