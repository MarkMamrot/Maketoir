/**
 * Resolves the IMS database (schema) name for a business.
 *
 * The mapping lives in the main DB `businesses.ims_db_name`. Results are cached
 * in-process (the mapping effectively never changes for a business). Falls back
 * to process.env.IMS_MYSQL_DATABASE so the existing single-tenant deployment
 * keeps working before any business has an explicit schema assigned.
 */
import { query } from '@/services/MySQLService';
import { enterImsContext, runWithImsContext } from '@/services/imsContext';

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

/**
 * STRICT schema lookup: returns the business's mapped IMS schema or undefined.
 * NEVER falls back to the env default — used by the tenant gatekeeper in
 * IMSMySQLService so an unmapped business fails closed instead of silently
 * reading another tenant's database.
 */
export async function getImsDbNameStrict(businessId: string): Promise<string | undefined> {
  if (!businessId) return undefined;
  const cached = cache.get(businessId);
  if (cached) return cached;
  try {
    const rows = await query<{ ims_db_name: string | null }>(
      'SELECT ims_db_name FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
      [businessId],
    );
    const dbName = rows[0]?.ims_db_name ?? undefined;
    if (dbName) { cache.set(businessId, dbName); return dbName; }
  } catch {
    // Main DB unreachable / column missing — treat as unmapped (fail closed).
  }
  return undefined;
}

/** Resolve (and cache) the IMS schema name for a business id. */
export async function getImsDbName(businessId: string): Promise<string> {
  const fallback = process.env.IMS_MYSQL_DATABASE ?? '';
  if (!businessId) return fallback;
  const strict = await getImsDbNameStrict(businessId);
  // NOTE: fallback result is NOT cached — otherwise an unmapped business would
  // poison the cache and defeat the strict resolver above.
  return strict ?? fallback;
}

/** Forget a cached mapping (call after provisioning / renaming a business). */
export function invalidateImsDbCache(businessId?: string): void {
  if (businessId) cache.delete(businessId);
  else { cache.clear(); primed = false; }
}

/**
 * ⚠️ DEPRECATED for tenant safety — AsyncLocalStorage.enterWith() called inside
 * an awaited function does NOT propagate back to the awaiting caller, so this
 * binding is lost the moment this function returns. It is kept only because it
 * warms the schema cache. Use runImsForBusiness() (callback form, guaranteed
 * propagation) or rely on the per-call tenant resolution inside
 * imsQuery/imsExecute/getIMSPool, which reads the session cookie itself.
 */
export async function enterImsForBusiness(businessId: string): Promise<string> {
  const dbName = await getImsDbName(businessId);
  if (dbName) enterImsContext(dbName, businessId);
  return dbName;
}

/**
 * Run `fn` with the business's IMS schema bound to the async context.
 * This is the ONLY reliable way to bind a tenant for flows that have no
 * session cookie (cron jobs, webhooks, login). Fails closed: throws if the
 * business has no ims_db_name mapping.
 */
export async function runImsForBusiness<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  const dbName = await getImsDbNameStrict(businessId);
  if (!dbName) {
    throw new Error(`No IMS database mapping for business ${businessId} — refusing to run against the default schema.`);
  }
  return runWithImsContext(dbName, fn, businessId);
}
