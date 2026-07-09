/**
 * Request-scoped IMS database context.
 *
 * Multi-tenant IMS uses one MySQL server (Railway "MySQL-HVk4") with a SEPARATE
 * schema per business (e.g. readyedu_MonsterthreadsIMS). This AsyncLocalStorage
 * store carries the schema name for the CURRENT request so that getIMSPool()
 * routes every query to the logged-in business's database — without threading a
 * db name through every repository method.
 *
 * Backward compatible: if no context is set, getIMSPool() falls back to
 * process.env.IMS_MYSQL_DATABASE (the single-tenant default).
 */
import { AsyncLocalStorage } from 'async_hooks';

interface ImsContext {
  imsDb: string;
  businessId?: string;
}

// Persist across Next.js HMR reloads in dev so the store identity is stable.
declare global {
  // eslint-disable-next-line no-var
  var __imsAls: AsyncLocalStorage<ImsContext> | undefined;
}

const als: AsyncLocalStorage<ImsContext> =
  globalThis.__imsAls ?? (globalThis.__imsAls = new AsyncLocalStorage<ImsContext>());

/** The IMS schema for the current request, or undefined if none is set. */
export function getCurrentImsDb(): string | undefined {
  return als.getStore()?.imsDb;
}

/** The business id bound to the current request, if any. */
export function getCurrentBusinessId(): string | undefined {
  return als.getStore()?.businessId;
}

/**
 * Bind the IMS schema to the current async execution context for the rest of
 * this request. Uses enterWith so callers don't have to wrap a callback — call
 * it once near the top of a route handler after resolving the business.
 */
export function enterImsContext(imsDb: string, businessId?: string): void {
  als.enterWith({ imsDb, businessId });
}

/** Run `fn` with the given IMS schema bound (callback form, fully isolated). */
export function runWithImsContext<T>(imsDb: string, fn: () => T, businessId?: string): T {
  return als.run({ imsDb, businessId }, fn);
}
