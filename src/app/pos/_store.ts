// localStorage helpers for the POS system
import type { DeviceConfig, CachedProduct, CartItem, ParkedSale } from './_types';

const KEYS = {
  deviceConfig:  'pos_device_config',
  products:      'pos_products_cache',
  productImages: 'pos_product_images',
  offlineQueue:  'pos_offline_queue',
  failedQueue:   'pos_failed_queue',
  parkedSales:   'pos_parked_sales',
  currentCart:   'pos_current_cart',
  sessionLocal:  'pos_session_local',
};

// ── Device Config ────────────────────────────────────────────

export function loadDeviceConfig(): DeviceConfig | null {
  try {
    const raw = localStorage.getItem(KEYS.deviceConfig);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveDeviceConfig(config: DeviceConfig): void {
  localStorage.setItem(KEYS.deviceConfig, JSON.stringify(config));
}

export function clearDeviceConfig(): void {
  localStorage.removeItem(KEYS.deviceConfig);
}

// ── Local Session Cache (offline startup recovery) ─────────────────────────────

export function saveLocalSession(session: unknown): void {
  localStorage.setItem(KEYS.sessionLocal, JSON.stringify(session));
}

export function loadLocalSession(): unknown | null {
  try {
    const raw = localStorage.getItem(KEYS.sessionLocal);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearLocalSession(): void {
  localStorage.removeItem(KEYS.sessionLocal);
}

// ── Products Cache ───────────────────────────────────────────

// How long the cached product list is considered "fresh" (Time To Live).
// After this, the POS refreshes it in the background when online and warns
// when offline. 6 hours comfortably covers a normal trading day.
export const PRODUCTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Safety-net cadence for a FULL (non-incremental) product+stock resync, on
// top of the frequent incremental `since=` syncs. Login always does a full
// fetch too — this single shared watermark (last_full_sync_at) is checked
// both at login and by the periodic background timer, so the two can never
// both fire back-to-back (whichever runs first resets the other's clock).
export const FULL_RESYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

interface ProductsCacheEnvelope {
  cached_at:          number;
  last_synced_at?:    number; // server_time watermark from the last sync (full OR incremental) — used as the next `since=` param
  last_full_sync_at?: number; // server_time watermark from the last FULL sync — drives the 12h safety-net check
  products:           CachedProduct[];
}

function readProductsEnvelope(): ProductsCacheEnvelope | null {
  try {
    const raw = localStorage.getItem(KEYS.products);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Backward compatibility: older builds stored a bare array with no timestamp.
    if (Array.isArray(parsed)) return { cached_at: 0, products: parsed };
    if (parsed && Array.isArray(parsed.products)) return parsed as ProductsCacheEnvelope;
    return null;
  } catch { return null; }
}

export function loadProductsCache(): CachedProduct[] {
  return readProductsEnvelope()?.products ?? [];
}

/** Replace the cached product list, preserving any existing sync watermarks. */
export function saveProductsCache(products: CachedProduct[]): void {
  const existing = readProductsEnvelope();
  const envelope: ProductsCacheEnvelope = {
    cached_at:          Date.now(),
    last_synced_at:     existing?.last_synced_at,
    last_full_sync_at:  existing?.last_full_sync_at,
    products,
  };
  localStorage.setItem(KEYS.products, JSON.stringify(envelope));
}

/** Merge an incremental delta into an existing product list (upsert by variant_id, drop `removed`). */
export function mergeProductsDelta(
  existing: CachedProduct[],
  delta: CachedProduct[],
  removed: string[],
): CachedProduct[] {
  const removedSet = new Set(removed);
  const byId = new Map(existing.filter(p => !removedSet.has(p.variant_id)).map(p => [p.variant_id, p]));
  for (const p of delta) byId.set(p.variant_id, p);
  return Array.from(byId.values());
}

/** Record that a sync just completed at the server's clock time (avoids client clock skew). */
export function markProductsSynced(serverTime: number, isFullSync: boolean): void {
  const existing = readProductsEnvelope();
  const envelope: ProductsCacheEnvelope = {
    cached_at:          Date.now(),
    last_synced_at:     serverTime,
    last_full_sync_at:  isFullSync ? serverTime : existing?.last_full_sync_at,
    products:           existing?.products ?? [],
  };
  localStorage.setItem(KEYS.products, JSON.stringify(envelope));
}

/** The `since` watermark to pass to the next incremental products fetch, or null if a full fetch is needed. */
export function getProductsSyncWatermark(): number | null {
  return readProductsEnvelope()?.last_synced_at ?? null;
}

/** True when it's been more than FULL_RESYNC_INTERVAL_MS since the last full resync (or there's never been one). */
export function needsFullProductsResync(): boolean {
  const lastFull = readProductsEnvelope()?.last_full_sync_at;
  if (!lastFull) return true;
  return Date.now() - lastFull > FULL_RESYNC_INTERVAL_MS;
}

/** Milliseconds since the product cache was last written, or null if no cache. */
export function getProductsCacheAgeMs(): number | null {
  const env = readProductsEnvelope();
  if (!env) return null;
  if (!env.cached_at) return Infinity; // legacy cache with no timestamp → treat as stale
  return Date.now() - env.cached_at;
}

/** True when the product cache is older than the TTL (or has no timestamp). */
export function isProductsCacheStale(): boolean {
  const age = getProductsCacheAgeMs();
  return age != null && age > PRODUCTS_CACHE_TTL_MS;
}

// ── Product Image Cache ──────────────────────────────────────
// Images are large and change infrequently. Cache them separately with a 24-hour
// TTL so every 5-minute stock sync doesn't re-scan the full ims_product_images table.

export const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ImageCacheEnvelope {
  cached_at:       number;
  last_synced_at?: number; // server_time watermark — used as the next `since=` param
  images:          Record<string, string>; // product_id → primary image URL (thumbnail)
}

function readImageEnvelope(): ImageCacheEnvelope | null {
  try {
    const raw = localStorage.getItem(KEYS.productImages);
    if (!raw) return null;
    return JSON.parse(raw) as ImageCacheEnvelope;
  } catch { return null; }
}

export function loadImageCache(): Record<string, string> | null {
  return readImageEnvelope()?.images ?? null;
}

/** Replace the cached image map, recording the server's sync watermark. */
export function saveImageCache(images: Record<string, string>, serverTime?: number): void {
  try {
    const existing = readImageEnvelope();
    localStorage.setItem(KEYS.productImages, JSON.stringify({
      cached_at:      Date.now(),
      last_synced_at: serverTime ?? existing?.last_synced_at,
      images,
    }));
  } catch {}
}

/** Merge an incremental image delta into the existing map (upsert by product_id, drop `removed`). */
export function mergeImageDelta(
  existing: Record<string, string>,
  delta: Record<string, string>,
  removed: string[],
): Record<string, string> {
  const merged = { ...existing };
  for (const id of removed) delete merged[id];
  for (const [id, url] of Object.entries(delta)) merged[id] = url;
  return merged;
}

/** The `since` watermark to pass to the next incremental images fetch, or null if a full fetch is needed. */
export function getImageSyncWatermark(): number | null {
  return readImageEnvelope()?.last_synced_at ?? null;
}

export function isImageCacheStale(): boolean {
  const env = readImageEnvelope();
  return !env?.cached_at || Date.now() - env.cached_at > IMAGE_CACHE_TTL_MS;
}

/** Merge a products array with cached image URLs (keyed by product_id). */
export function mergeProductImages<T extends { product_id: string; image_url: string | null }>(
  products: T[],
  images: Record<string, string>,
): T[] {
  return products.map(p => ({ ...p, image_url: images[p.product_id] ?? null }));
}

// ── Current Cart ─────────────────────────────────────────────

export function loadCurrentCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEYS.currentCart);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveCurrentCart(items: CartItem[]): void {
  localStorage.setItem(KEYS.currentCart, JSON.stringify(items));
}

// ── Parked Sales ─────────────────────────────────────────────

export function loadParkedSales(): ParkedSale[] {
  try {
    const raw = localStorage.getItem(KEYS.parkedSales);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveParkedSales(sales: ParkedSale[]): void {
  localStorage.setItem(KEYS.parkedSales, JSON.stringify(sales));
}

// ── Offline Queue ─────────────────────────────────────────────

export interface OfflineQueueEntry {
  payload:     unknown;
  queued_at:   string;
  attempts:    number;
  last_error?: string;
}

export function loadOfflineQueue(): OfflineQueueEntry[] {
  try {
    const raw = localStorage.getItem(KEYS.offlineQueue);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function addToOfflineQueue(payload: unknown): void {
  const queue = loadOfflineQueue();
  queue.push({ payload, queued_at: new Date().toISOString(), attempts: 0 });
  localStorage.setItem(KEYS.offlineQueue, JSON.stringify(queue));
}

export function saveOfflineQueue(queue: OfflineQueueEntry[]): void {
  localStorage.setItem(KEYS.offlineQueue, JSON.stringify(queue));
}

/** Remove a single offline queue entry by its payload's local_id. */
export function removeFromOfflineQueue(localId: string): void {
  const queue = loadOfflineQueue().filter(e => (e.payload as any)?.local_id !== localId);
  saveOfflineQueue(queue);
}

// ── Failed (dead-letter) queue ────────────────────────────────
// Sales that repeatedly failed to sync are moved here so they are NEVER lost.
// They are surfaced to the operator for manual retry rather than silently dropped.

export function loadFailedQueue(): OfflineQueueEntry[] {
  try {
    const raw = localStorage.getItem(KEYS.failedQueue);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveFailedQueue(queue: OfflineQueueEntry[]): void {
  localStorage.setItem(KEYS.failedQueue, JSON.stringify(queue));
}

/** Remove a single failed queue entry by its payload's local_id. */
export function removeFromFailedQueue(localId: string): void {
  const queue = loadFailedQueue().filter(e => (e.payload as any)?.local_id !== localId);
  saveFailedQueue(queue);
}

/** Move every dead-lettered sale back into the live queue for another attempt. */
export function retryFailedQueue(): void {
  const failed = loadFailedQueue();
  if (!failed.length) return;
  const queue = loadOfflineQueue();
  for (const entry of failed) queue.push({ ...entry, attempts: 0 });
  saveOfflineQueue(queue);
  saveFailedQueue([]);
}

// ── UUID generator ────────────────────────────────────────────

export function newLocalId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Drain offline queue ───────────────────────────────────────
// Sends each queued sale to the server. Entries that keep failing are moved to a
// dead-letter queue (loadFailedQueue) after MAX_LIVE_ATTEMPTS — they are NEVER
// silently discarded, so no sale can disappear. A 4xx (other than network/5xx)
// for a malformed payload is also dead-lettered rather than retried forever.

const MAX_LIVE_ATTEMPTS = 5;

export async function drainOfflineQueue(): Promise<void> {
  const queue = loadOfflineQueue();
  if (!queue.length) return;

  const remaining: OfflineQueueEntry[] = [];
  const failed = loadFailedQueue();

  for (const entry of queue) {
    try {
      const res = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
      });
      if (res.ok) continue; // synced — drop from queue

      // Read the actual error body for a useful diagnostic message
      let errMsg = `HTTP ${res.status}`;
      try {
        const body = await res.clone().json();
        if (body?.error) errMsg = `${res.status}: ${body.error}`;
      } catch { /* ignore parse failures */ }

      entry.attempts++;
      entry.last_error = errMsg;
      if (entry.attempts < MAX_LIVE_ATTEMPTS) remaining.push(entry);
      else failed.push(entry); // dead-letter — kept for manual retry, never lost
    } catch (e: any) {
      entry.attempts++;
      entry.last_error = e?.message || 'Network error';
      // Network errors keep retrying in the live queue (don't dead-letter on offline)
      remaining.push(entry);
    }
  }

  saveOfflineQueue(remaining);
  saveFailedQueue(failed);
}
