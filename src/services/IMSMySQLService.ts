import mysql from 'mysql2/promise';
import { cookies } from 'next/headers';
import { getCurrentImsDb } from '@/services/imsContext';
import { getImsDbNameSync } from '@/lib/db/BusinessRegistry';

/**
 * Automatic per-request schema resolution: when no schema was set explicitly or
 * via request context, derive it from the logged-in business in the session
 * cookie. This makes every authenticated route route to the correct tenant
 * schema WITHOUT each route having to bind context manually. Returns undefined
 * outside a request scope (cron/scripts) or when the mapping isn't cached yet,
 * so the caller falls back to the env default.
 */
function resolveImsDbFromCookie(): string | undefined {
  try {
    const raw = cookies().get('marketoir_session')?.value;
    if (!raw) return undefined;
    const businessId = JSON.parse(raw)?.businessId as string | undefined;
    return businessId ? getImsDbNameSync(businessId) : undefined;
  } catch {
    return undefined; // not in a request scope
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __imsPools: Map<string, mysql.Pool> | undefined;
  // eslint-disable-next-line no-var
  var __imsPoolLastUsed: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __imsPoolSweeper: ReturnType<typeof setInterval> | undefined;
}

// Store on globalThis so the pool survives Next.js HMR reloads in dev mode.
// Without this, every hot reload creates a new Map and new pools, exhausting
// the server's max_connections limit.
const pools: Map<string, mysql.Pool> =
  globalThis.__imsPools ?? (globalThis.__imsPools = new Map<string, mysql.Pool>());

// Track last-use time per schema so idle tenant pools can be closed, keeping
// total open connections bounded when many businesses share one MySQL server.
const lastUsed: Map<string, number> =
  globalThis.__imsPoolLastUsed ?? (globalThis.__imsPoolLastUsed = new Map<string, number>());

// How long a non-default schema pool may sit idle before it is closed.
const POOL_IDLE_MS = parseInt(process.env.IMS_POOL_IDLE_MS ?? '600000', 10); // 10 min
const POOL_SWEEP_MS = 120000; // check every 2 min

/** Close pools for tenant schemas that have been idle beyond POOL_IDLE_MS. */
async function sweepIdlePools(): Promise<void> {
  const now = Date.now();
  const defaultDb = process.env.IMS_MYSQL_DATABASE ?? '';
  for (const [name, pool] of pools) {
    if (name === defaultDb) continue; // never evict the primary/default schema
    const idle = now - (lastUsed.get(name) ?? 0);
    if (idle < POOL_IDLE_MS) continue;
    pools.delete(name);
    lastUsed.delete(name);
    try { await pool.end(); } catch { /* ignore — best effort */ }
  }
}

// Start a single background sweeper (guarded so HMR doesn't stack timers).
if (!globalThis.__imsPoolSweeper) {
  globalThis.__imsPoolSweeper = setInterval(() => { void sweepIdlePools(); }, POOL_SWEEP_MS);
  // Don't keep the process alive just for the sweeper.
  (globalThis.__imsPoolSweeper as any)?.unref?.();
}

const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableDbError(err: any): boolean {
  const code = String(err?.code ?? '');
  return RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Get (or lazily create) a connection pool for an IMS schema.
 * Schema precedence: explicit dbName arg → current request context
 * (getCurrentImsDb) → session-cookie business → IMS_MYSQL_DATABASE env default.
 */
export function getIMSPool(dbName?: string): mysql.Pool {
  const name = dbName ?? getCurrentImsDb() ?? resolveImsDbFromCookie() ?? process.env.IMS_MYSQL_DATABASE ?? '';
  if (!name) {
    throw new Error(
      'IMS database name not configured. Add IMS_MYSQL_DATABASE to .env.local and run scripts/setup-ims-database.mjs'
    );
  }
  lastUsed.set(name, Date.now());
  if (!pools.has(name)) {
    pools.set(
      name,
      mysql.createPool({
        host:               process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST ?? '127.0.0.1',
        port:               parseInt(process.env.MYSQL_PORT ?? '3306', 10),
        database:           name,
        user:               process.env.MYSQL_USER     ?? '',
        password:           process.env.MYSQL_PASSWORD ?? '',
        waitForConnections: true,
        connectionLimit:    parseInt(process.env.IMS_POOL_CONNECTION_LIMIT ?? '5', 10),
        queueLimit:         0,
        connectTimeout:     parseInt(process.env.IMS_MYSQL_CONNECT_TIMEOUT_MS ?? '20000', 10),
        enableKeepAlive:    true,
        keepAliveInitialDelay: 0,
        timezone:           'Z',
        charset:            'utf8mb4',
        dateStrings:        true,  // Return DATETIME as strings (not Date objects) — preserves local time stored by localNow()
      })
    );
  }
  return pools.get(name)!;
}

export async function imsQuery<T = any>(
  sql: string,
  params?: any[],
  db?: string,
): Promise<T[]> {
  const pool = getIMSPool(db);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const [rows] = await pool.execute(sql, params);
      return rows as T[];
    } catch (err: any) {
      if (!isRetryableDbError(err) || attempt === 1) throw err;
      await sleep(250);
    }
  }
  return [];
}

export async function imsExecute(
  sql: string,
  params?: any[],
  db?: string,
): Promise<mysql.ResultSetHeader> {
  const pool = getIMSPool(db);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const [result] = await pool.execute(sql, params);
      return result as mysql.ResultSetHeader;
    } catch (err: any) {
      if (!isRetryableDbError(err) || attempt === 1) throw err;
      await sleep(250);
    }
  }
  throw new Error('IMS execute failed');
}
