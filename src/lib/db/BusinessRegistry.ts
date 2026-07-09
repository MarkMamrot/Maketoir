/**
 * Resolves the IMS database (schema) name for a business.
 *
 * The mapping lives in the main DB `businesses.ims_db_name`. Results are cached
 * in-process (the mapping effectively never changes for a business). Falls back
 * to process.env.IMS_MYSQL_DATABASE so the existing single-tenant deployment
 * keeps working before any business has an explicit schema assigned.
 */
import { query } from '@/services/MySQLService';
import { enterImsContext } from '@/services/imsContext';

const cache = new Map<string, string>();
let primed = false;
let priming: Promise<void> | null = null;

/**
 * Load every business → IMS schema mapping into the in-process cache. Enables
 * the synchronous resolver used by getIMSPool for automatic per-request routing.
 * Safe to call repeatedly; only the first load hits the DB.
 */
export async function primeImsDbMap(): Promise<void> {
  if (priming) return priming;
  priming = (async () => {
    try {
      const rows = await query<{ business_id: string; ims_db_name: string | null }>(
        'SELECT business_id, ims_db_name FROM businesses WHERE deleted_at IS NULL',
      );
      for (const r of rows) if (r.ims_db_name) cache.set(r.business_id, r.ims_db_name);
      primed = true;
    } catch {
      // businesses.ims_db_name may not exist yet — leave cache empty (env fallback).
    } finally {
      priming = null;
    }
  })();
  return priming;
}

/**
 * Synchronous schema lookup for a business, or undefined if not cached yet.
 * On a cold miss it warms the cache in the background (returning undefined for
 * this call so the caller falls back to the env default).
 */
export function getImsDbNameSync(businessId: string): string | undefined {
  if (!businessId) return undefined;
  const hit = cache.get(businessId);
  if (hit) return hit;
  if (!primed) void primeImsDbMap();
  return undefined;
}

/** Resolve (and cache) the IMS schema name for a business id. */
export async function getImsDbName(businessId: string): Promise<string> {
  const fallback = process.env.IMS_MYSQL_DATABASE ?? '';
  if (!businessId) return fallback;

  const cached = cache.get(businessId);
  if (cached) return cached;

  let dbName = fallback;
  try {
    const rows = await query<{ ims_db_name: string | null }>(
      'SELECT ims_db_name FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
      [businessId],
    );
    if (rows[0]?.ims_db_name) dbName = rows[0].ims_db_name;
  } catch {
    // Column may not exist yet (pre-migration) — fall back to env default.
  }

  if (dbName) cache.set(businessId, dbName);
  return dbName;
}

/** Forget a cached mapping (call after provisioning / renaming a business). */
export function invalidateImsDbCache(businessId?: string): void {
  if (businessId) cache.delete(businessId);
  else { cache.clear(); primed = false; }
}

/**
 * Resolve the business's IMS schema and bind it to the current request context
 * for the rest of this handler. Call once near the top of an IMS route after
 * you have the businessId from the session. No-op-safe: on failure the env
 * default remains in effect.
 */
export async function enterImsForBusiness(businessId: string): Promise<string> {
  const dbName = await getImsDbName(businessId);
  if (dbName) enterImsContext(dbName, businessId);
  return dbName;
}
