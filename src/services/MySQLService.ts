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
