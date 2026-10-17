import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

/** Keep local helper reads and writes on the caller's tenant transaction. */
export function localTransactionQueries(connection?: PoolConnection) {
  return {
    query: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      if (!connection) return imsQuery<T>(sql, params);
      const [rows] = await connection.execute(sql, params as Parameters<PoolConnection['execute']>[1]);
      return rows as T[];
    },
    execute: async (sql: string, params: unknown[] = []): Promise<ResultSetHeader> => {
      if (!connection) return imsExecute(sql, params);
      const [result] = await connection.execute<ResultSetHeader>(sql, params as Parameters<PoolConnection['execute']>[1]);
      return result;
    },
  };
}
