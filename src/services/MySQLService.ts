import mysql from 'mysql2/promise';

declare global {
  // eslint-disable-next-line no-var
  var __mysqlPool: mysql.Pool | undefined;
}

export function getPool(): mysql.Pool {
  if (!globalThis.__mysqlPool) {
    globalThis.__mysqlPool = mysql.createPool({
      host:               process.env.MYSQL_HOST     ?? 'localhost',
      port:               parseInt(process.env.MYSQL_PORT ?? '3306', 10),
      database:           process.env.MYSQL_DATABASE ?? '',
      user:               process.env.MYSQL_USER     ?? '',
      password:           process.env.MYSQL_PASSWORD ?? '',
      waitForConnections: true,
      connectionLimit:    5,          // conservative for shared hosting
      queueLimit:         0,
      timezone:           'Z',        // store/retrieve all datetimes as UTC
      charset:            'utf8mb4',
    });
    // `timezone: 'Z'` only controls mysql2's own JS Date <-> string
    // serialisation — it doesn't change the MySQL session's `time_zone`,
    // which is what NOW()/CURRENT_TIMESTAMP() use server-side. Pin every
    // pooled connection's session tz to UTC explicitly so DB-computed
    // timestamps can't silently drift from the UTC basis the app assumes.
    globalThis.__mysqlPool.on('connection', (conn) => {
      conn.query("SET time_zone = '+00:00'", (err) => {
        if (err) console.error('Failed to set session time_zone on main pool:', err.message);
      });
    });
  }
  return globalThis.__mysqlPool;
}

/** Execute a query and return rows + fields. */
export async function query<T = any>(
  sql: string,
  params?: any[],
): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T[];
}

/** Execute an INSERT/UPDATE/DELETE and return the result metadata. */
export async function execute(
  sql: string,
  params?: any[],
): Promise<mysql.ResultSetHeader> {
  const [result] = await getPool().execute(sql, params);
  return result as mysql.ResultSetHeader;
}
