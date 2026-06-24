// localStorage helpers for the POS system
import type { DeviceConfig, CachedProduct, CartItem, ParkedSale } from './_types';

const KEYS = {
  deviceConfig:  'pos_device_config',
  products:      'pos_products_cache',
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

interface ProductsCacheEnvelope {
  cached_at: number;
  products:  CachedProduct[];
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

export function saveProductsCache(products: CachedProduct[]): void {
  const envelope: ProductsCacheEnvelope = { cached_at: Date.now(), products };
  localStorage.setItem(KEYS.products, JSON.stringify(envelope));
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

      entry.attempts++;
      entry.last_error = `HTTP ${res.status}`;
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
