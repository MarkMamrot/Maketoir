// localStorage helpers for the POS system
import type { DeviceConfig, CachedProduct, CartItem, ParkedSale, CompletedSale } from './_types';

const KEYS = {
  deviceConfig:  'pos_device_config',
  products:      'pos_products_cache',
  productImages: 'pos_product_images',
  offlineQueue:  'pos_offline_queue',
  failedQueue:   'pos_failed_queue',
  parkedSales:   'pos_parked_sales',
  currentCart:   'pos_current_cart',
  sessionLocal:  'pos_session_local',
  lastReceipt:   'pos_last_receipt',
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

function tenantStorageKey(key: string): string {
  const businessId = loadDeviceConfig()?.business_id;
  return businessId ? `${key}:${businessId}` : key;
}

function getTenantItem(key: string): string | null {
  const scopedKey = tenantStorageKey(key);
  const scoped = localStorage.getItem(scopedKey);
  if (scoped != null || scopedKey === key) return scoped;
  const legacy = localStorage.getItem(key);
  if (legacy != null) {
    try {
      localStorage.setItem(scopedKey, legacy);
      localStorage.removeItem(key);
    } catch {
      return legacy;
    }
  }
  return legacy;
}

function setTenantItem(key: string, value: string): void {
  localStorage.setItem(tenantStorageKey(key), value);
}

function trySetTenantItem(key: string, value: string): boolean {
  try {
    setTenantItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeTenantItem(key: string): void {
  localStorage.removeItem(tenantStorageKey(key));
}

// ── Local Session Cache (offline startup recovery) ─────────────────────────────

export function saveLocalSession(session: unknown): boolean {
  return trySetTenantItem(KEYS.sessionLocal, JSON.stringify(session));
}

export function loadLocalSession(): unknown | null {
  try {
    const raw = getTenantItem(KEYS.sessionLocal);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearLocalSession(): void {
  removeTenantItem(KEYS.sessionLocal);
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

export interface ProductsCacheEnvelope {
  cached_at:          number;
  last_synced_at?:    number; // server_time watermark from the last sync (full OR incremental) — used as the next `since=` param
  last_full_sync_at?: number; // server_time watermark from the last FULL sync — drives the 12h safety-net check
  products:           CachedProduct[];
}

export function readProductsEnvelope(): ProductsCacheEnvelope | null {
  try {
    const raw = getTenantItem(KEYS.products);
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

export function clearLegacyProductsCache(): void {
  removeTenantItem(KEYS.products);
  localStorage.removeItem(KEYS.products);
}

/** Replace the cached product list, preserving any existing sync watermarks. */
export function saveProductsCache(products: CachedProduct[]): boolean {
  const existing = readProductsEnvelope();
  const envelope: ProductsCacheEnvelope = {
    cached_at:          Date.now(),
    last_synced_at:     existing?.last_synced_at,
    last_full_sync_at:  existing?.last_full_sync_at,
    products,
  };
  return trySetTenantItem(KEYS.products, JSON.stringify(envelope));
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
export function markProductsSynced(serverTime: number, isFullSync: boolean): boolean {
  const existing = readProductsEnvelope();
  const envelope: ProductsCacheEnvelope = {
    cached_at:          Date.now(),
    last_synced_at:     serverTime,
    last_full_sync_at:  isFullSync ? serverTime : existing?.last_full_sync_at,
    products:           existing?.products ?? [],
  };
  return trySetTenantItem(KEYS.products, JSON.stringify(envelope));
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
    const raw = getTenantItem(KEYS.productImages);
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
    setTenantItem(KEYS.productImages, JSON.stringify({
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
    const raw = getTenantItem(KEYS.currentCart);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveCurrentCart(items: CartItem[]): void {
  setTenantItem(KEYS.currentCart, JSON.stringify(items));
}

// ── Parked Sales ─────────────────────────────────────────────

export function loadParkedSales(): ParkedSale[] {
  try {
    const raw = getTenantItem(KEYS.parkedSales);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveParkedSales(sales: ParkedSale[]): void {
  setTenantItem(KEYS.parkedSales, JSON.stringify(sales));
}

// ── Offline Queue ─────────────────────────────────────────────

export interface OfflineQueueEntry {
  payload:     unknown;
  queued_at:   string;
  attempts:    number;
  last_error?: string;
  receipt?:    CompletedSale;
  next_attempt_at?: string;
}

type StoredSale = OfflineQueueEntry & { state: 'pending' | 'failed' };
export const POS_OUTBOX_CHANGED = 'pos-sale-outbox-change';
const volatileSales = new Map<string, StoredSale>();
const drains = new Map<string, Promise<void>>();
const SALE_UPLOAD_TIMEOUT_MS = 15_000;

function saleLocalId(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'local_id' in payload
    && typeof payload.local_id === 'string' && payload.local_id.trim()) return payload.local_id;
  throw new Error('A queued sale must have a stable local ID.');
}

function outboxPrefix(): string {
  const businessId = loadDeviceConfig()?.business_id;
  if (!businessId) throw new Error('Configure the POS business before storing sales.');
  return `pos_sale_outbox:${encodeURIComponent(businessId)}:`;
}

function saleKey(prefix: string, payload: unknown): string {
  return `${prefix}${encodeURIComponent(saleLocalId(payload))}`;
}

function notifyOutboxChanged(sync = false) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(POS_OUTBOX_CHANGED, { detail: { sync } }));
}

export function reportPosSaleBrowserIssue(
  operation: 'pos_sale_local_storage' | 'pos_sale_sync' | 'pos_catalogue_refresh',
  localId?: string,
  businessId = loadDeviceConfig()?.business_id,
): void {
  console.error(`[POS] ${operation}`, localId ?? '');
  void fetch('/api/runtime-issues/client', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({
      name: 'PosSaleRecoveryError', operation,
      message: operation === 'pos_catalogue_refresh'
        ? 'POS stock catalogue could not be refreshed after a saved layby. Use Sync before relying on local stock counts.'
        : operation === 'pos_sale_local_storage'
        ? 'POS sale storage requires recovery. Keep the device open and do not recharge the customer.'
        : 'A paid POS sale needs sync review. Its device record has been retained.',
      businessId,
      localId, pathname: typeof window === 'undefined' ? '/pos' : window.location.pathname,
    }),
  }).then(response => {
    if (!response.ok) throw new Error(`Recovery issue reporting returned HTTP ${response.status}.`);
  }).catch(error => { console.error('[POS] Could not report sale recovery issue', error); });
}

function writeSale(key: string, entry: StoredSale) {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
    volatileSales.delete(key);
  } catch (error) {
    // An approved payment must remain recoverable in this tab even when storage is full.
    volatileSales.set(key, entry);
    reportPosSaleBrowserIssue('pos_sale_local_storage', saleLocalId(entry.payload), decodeURIComponent(key.split(':')[1]));
    throw error;
  } finally { notifyOutboxChanged(); }
}

function migrateLegacyQueue(prefix: string, key: string, state: StoredSale['state']) {
  const raw = getTenantItem(key);
  if (raw == null) return;
  const entries: OfflineQueueEntry[] = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error('The saved POS queue is invalid. Keep device storage intact.');
  for (const entry of entries) {
    const destination = saleKey(prefix, entry.payload);
    if (localStorage.getItem(destination) == null) writeSale(destination, volatileSales.get(destination) ?? { ...entry, state });
  }
  removeTenantItem(key);
}

function readSales(prefix: string): StoredSale[] {
  const entries = new Map<string, StoredSale>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = localStorage.getItem(key);
    if (raw != null) entries.set(key, JSON.parse(raw));
  }
  for (const [key, entry] of volatileSales) if (key.startsWith(prefix)) entries.set(key, entry);
  return [...entries.values()].sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

function currentSales(): StoredSale[] {
  if (!loadDeviceConfig()?.business_id) return [];
  const prefix = outboxPrefix();
  migrateLegacyQueue(prefix, KEYS.offlineQueue, 'pending');
  migrateLegacyQueue(prefix, KEYS.failedQueue, 'failed');
  return readSales(prefix);
}

export function loadOfflineQueue(): OfflineQueueEntry[] {
  return currentSales().filter(entry => entry.state === 'pending');
}

export function loadFailedQueue(): OfflineQueueEntry[] {
  return currentSales().filter(entry => entry.state === 'failed');
}

export function addToOfflineQueue(payload: unknown, receipt?: CompletedSale): OfflineQueueEntry {
  const prefix = outboxPrefix();
  const key = saleKey(prefix, payload);
  const existing = readSales(prefix).find(entry => saleLocalId(entry.payload) === saleLocalId(payload));
  if (existing) return existing;
  const entry: StoredSale = { payload, receipt, queued_at: new Date().toISOString(), attempts: 0, state: 'pending' };
  try {
    writeSale(key, entry);
  } finally { notifyOutboxChanged(true); }
  return entry;
}

function removeQueuedSale(localId: string) {
  const key = `${outboxPrefix()}${encodeURIComponent(localId)}`;
  localStorage.removeItem(key);
  volatileSales.delete(key);
  notifyOutboxChanged();
}

export function removeFromOfflineQueue(localId: string): void { removeQueuedSale(localId); }
export function removeFromFailedQueue(localId: string): void { removeQueuedSale(localId); }

export function retryFailedQueue(): void {
  const prefix = outboxPrefix();
  for (const entry of currentSales().filter(sale => sale.state === 'failed')) {
    writeSale(saleKey(prefix, entry.payload), { ...entry, attempts: 0, state: 'pending', next_attempt_at: undefined });
  }
}

export function loadLastCompletedSale(): CompletedSale | null {
  const raw = getTenantItem(KEYS.lastReceipt);
  const archived: CompletedSale | null = raw ? JSON.parse(raw) : null;
  const receipts: CompletedSale[] = currentSales().flatMap(entry => entry.receipt ? [{
    ...entry.receipt,
    sync_status: volatileSales.has(saleKey(outboxPrefix(), entry.payload))
      ? 'storage_failed' as const : entry.state === 'failed' ? 'needs_review' as const : 'pending' as const,
  }] : []);
  if (archived) receipts.push(archived);
  return receipts.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

// ── UUID generator ────────────────────────────────────────────

export function newLocalId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Drain offline queue ───────────────────────────────────────
// Retry outages without discarding paid sales. Domain rejections stay visible
// in Failed sales for review, rather than being silently treated as uploaded.

export function drainOfflineQueue(options: { force?: boolean } = {}): Promise<void> {
  const config = loadDeviceConfig();
  if (!config?.business_id || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
  const prefix = outboxPrefix();
  const active = drains.get(prefix);
  if (active) return active;
  const run = () => drainSales(prefix, config, options.force === true);
  const promise = (typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request<void>(prefix, run) : run())
    .finally(() => { drains.delete(prefix); });
  drains.set(prefix, promise);
  return promise;
}

async function drainSales(prefix: string, config: DeviceConfig, force: boolean): Promise<void> {
  const queue = loadOfflineQueue();
  for (const original of queue) {
    if (!force && original.next_attempt_at && Date.parse(original.next_attempt_at) > Date.now()) break;
    const currentConfig = loadDeviceConfig();
    if (currentConfig?.business_id !== config.business_id || currentConfig.location_id !== config.location_id
      || currentConfig.register_id !== config.register_id) break;
    const key = saleKey(prefix, original.payload);
    const entry = readSales(prefix).find(sale => saleKey(prefix, sale.payload) === key && sale.state === 'pending');
    if (!entry) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SALE_UPLOAD_TIMEOUT_MS);
    try {
      const res = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(entry.payload && typeof entry.payload === 'object' ? entry.payload : {}),
          business_id: config.business_id,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const result: {
          success?: boolean; id?: number; stockWarning?: string;
          stockWarnings?: Array<{ itemName?: string }>;
        } = await res.json();
        if (result.success !== true || !Number.isInteger(result.id) || Number(result.id) <= 0) {
          throw new Error('The server did not acknowledge the sale.');
        }
        if (entry.receipt) {
          const receiptKey = `${KEYS.lastReceipt}:${config.business_id}`;
          const raw = localStorage.getItem(receiptKey);
          const last: CompletedSale | null = raw ? JSON.parse(raw) : null;
          if (!last || last.created_at <= entry.receipt.created_at) {
            const stockWarning = result.stockWarning || (Array.isArray(result.stockWarnings) && result.stockWarnings.length > 0)
              ? 'Stock needs review for this sale. Check its stock warning in IMS before making a correction.' : undefined;
            localStorage.setItem(receiptKey, JSON.stringify({
              ...entry.receipt, id: result.id, sync_status: 'synced', stock_sync_warning: stockWarning,
            }));
          }
        }
        localStorage.removeItem(key);
        volatileSales.delete(key);
        notifyOutboxChanged();
        continue;
      }
      let errMsg = `HTTP ${res.status}`;
      const body: { error?: string } | null = await res.json().catch(() => null);
      if (typeof body?.error === 'string') errMsg = `${res.status}: ${body.error}`;
      if (!readSales(prefix).some(sale => saleKey(prefix, sale.payload) === key)) continue;
      const attempts = entry.attempts + 1;
      const state = res.status >= 500 || [401, 403, 408, 429].includes(res.status) ? 'pending' : 'failed';
      writeSale(key, { ...entry, attempts, last_error: errMsg, state,
        next_attempt_at: new Date(Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(attempts, 5))).toISOString() });
      if (state === 'failed') reportPosSaleBrowserIssue('pos_sale_sync', saleLocalId(entry.payload), config.business_id);
      if (state === 'pending') break;
    } catch (error) {
      if (readSales(prefix).some(sale => saleKey(prefix, sale.payload) === key)) {
        writeSale(key, { ...entry, attempts: entry.attempts + 1,
          last_error: error instanceof Error ? error.message : 'Sale upload could not be confirmed.',
          next_attempt_at: new Date(Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(entry.attempts + 1, 5))).toISOString() });
      }
      break;
    } finally { clearTimeout(timeout); }
  }
}
