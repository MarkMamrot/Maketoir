// localStorage helpers for the POS system
import type { DeviceConfig, CachedProduct, CartItem, ParkedSale } from './_types';

const KEYS = {
  deviceConfig:  'pos_device_config',
  products:      'pos_products_cache',
  offlineQueue:  'pos_offline_queue',
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

export function loadProductsCache(): CachedProduct[] {
  try {
    const raw = localStorage.getItem(KEYS.products);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveProductsCache(products: CachedProduct[]): void {
  localStorage.setItem(KEYS.products, JSON.stringify(products));
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

// ── UUID generator ────────────────────────────────────────────

export function newLocalId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Drain offline queue ───────────────────────────────────────

export async function drainOfflineQueue(): Promise<void> {
  const queue = loadOfflineQueue();
  if (!queue.length) return;

  const remaining: OfflineQueueEntry[] = [];
  for (const entry of queue) {
    try {
      const res = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
      });
      if (!res.ok) {
        entry.attempts++;
        if (entry.attempts < 5) remaining.push(entry);
      }
    } catch {
      entry.attempts++;
      if (entry.attempts < 5) remaining.push(entry);
    }
  }
  saveOfflineQueue(remaining);
}
