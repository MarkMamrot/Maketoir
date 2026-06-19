import mysql from 'mysql2/promise';

declare global {
  // eslint-disable-next-line no-var
  var __imsPools: Map<string, mysql.Pool> | undefined;
}

// Store on globalThis so the pool survives Next.js HMR reloads in dev mode.
// Without this, every hot reload creates a new Map and new pools, exhausting
// the server's max_connections limit.
const pools: Map<string, mysql.Pool> =
  globalThis.__imsPools ?? (globalThis.__imsPools = new Map<string, mysql.Pool>());

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

export function getIMSPool(dbName?: string): mysql.Pool {
  const name = dbName ?? process.env.IMS_MYSQL_DATABASE ?? '';
  if (!name) {
    throw new Error(
      'IMS database name not configured. Add IMS_MYSQL_DATABASE to .env.local and run scripts/setup-ims-database.mjs'
    );
  }
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
        connectionLimit:    5,
        queueLimit:         0,
        connectTimeout:     parseInt(process.env.IMS_MYSQL_CONNECT_TIMEOUT_MS ?? '20000', 10),
        enableKeepAlive:    true,
        keepAliveInitialDelay: 0,
        timezone:           'Z',
        charset:            'utf8mb4',
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
