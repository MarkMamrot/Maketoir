import type { CachedProduct } from '@/app/pos/_types';

export const CATALOGUE_PROTOCOL = 2;
export const REBUILD_JITTER_MS = 2 * 60 * 60 * 1000;

export interface CatalogueAcknowledgement {
  acknowledged: true;
  completedFullAt: number;
  nextFullAt: number;
}

export interface CatalogueDelivery {
  protocol: 2;
  mode: 'full' | 'delta';
  businessId: string;
  locationId: number;
  consumerId: string;
  epoch: string;
  receipt: string;
  serverTime: number;
  timeZone: string;
  nextFullAt: number;
  products: CachedProduct[];
  removed: string[];
  more: boolean;
}

export type CatalogueResponse = CatalogueDelivery | {
  protocol: 2;
  mode: 'disabled' | 'deferred';
  retryAfterMs: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCatalogueProduct(value: unknown): value is CachedProduct {
  if (!record(value)) return false;
  return ['variant_id', 'product_id', 'name'].every(key => typeof value[key] === 'string')
    && ['code', 'barcode', 'brand', 'image_url'].every(key => value[key] === null || typeof value[key] === 'string')
    && ['price', 'soh', 'soh_all', 'available', 'available_all'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && ['cost', 'original_price'].every(key => value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key])))
    && ['buildable_quantity'].every(key => value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key])))
    && ['has_build_recipe', 'build_from_sale_enabled'].every(key => value[key] === undefined || typeof value[key] === 'boolean');
}

export function parseCatalogueResponse(value: unknown): CatalogueResponse {
  if (!record(value) || value.protocol !== 2) throw new Error('Invalid catalogue protocol.');
  if ((value.mode === 'disabled' || value.mode === 'deferred') && typeof value.retryAfterMs === 'number' && Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0) {
    return { protocol: 2, mode: value.mode, retryAfterMs: value.retryAfterMs };
  }
  if (!isDelivery(value)) throw new Error('Invalid catalogue delivery.');
  const ids = value.products.map(product => product.variant_id);
  if (new Set(ids).size !== ids.length || value.removed.some(id => ids.includes(id))) throw new Error('Conflicting catalogue delivery.');
  return value;
}

function isDelivery(value: Record<string, unknown>): value is Record<string, unknown> & CatalogueDelivery {
  return !((value.mode !== 'full' && value.mode !== 'delta')
    || !['businessId', 'consumerId', 'epoch', 'receipt', 'timeZone'].every(key => typeof value[key] === 'string' && value[key] !== '')
    || !['serverTime', 'nextFullAt', 'locationId'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    || typeof value.more !== 'boolean'
    || !Array.isArray(value.products) || !value.products.every(isCatalogueProduct)
    || !Array.isArray(value.removed) || !value.removed.every(id => typeof id === 'string'));
}

export function nextCalendarMonth(instant: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = (time: number) => Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, Number(part.value)]));
  const current = parts(instant);
  const month = current.month === 12 ? 1 : current.month + 1;
  const year = current.year + (current.month === 12 ? 1 : 0);
  const day = Math.min(current.day, new Date(Date.UTC(year, month, 0)).getUTCDate());
  const wall = Date.UTC(year, month - 1, day, current.hour, current.minute, current.second);
  let result = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const local = parts(result);
    const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - result;
    const adjusted = wall - offset;
    if (adjusted === result) break;
    result = adjusted;
  }
  return result + instant % 1000;
}

export function rebuildTarget(input: { now: number; eligibleAt: number; openedAt?: number; pendingAt?: number; random: number }): number | undefined {
  if (input.pendingAt !== undefined) return input.pendingAt;
  const anchor = input.openedAt ?? input.now;
  if (input.openedAt === undefined && input.now < input.eligibleAt) return undefined;
  if (input.eligibleAt > anchor + REBUILD_JITTER_MS) return undefined;
  if (!Number.isFinite(input.random) || input.random < 0 || input.random > 1) throw new Error('Invalid rebuild jitter.');
  return Math.max(input.eligibleAt, anchor + Math.floor(input.random * REBUILD_JITTER_MS));
}
