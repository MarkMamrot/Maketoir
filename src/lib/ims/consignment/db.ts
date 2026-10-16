import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getIMSPool } from '@/services/IMSMySQLService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';

export async function query<T>(db: PoolConnection, sql: string, values: any[] = []): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, values);
  return rows as T[];
}
export async function execute(db: PoolConnection, sql: string, values: any[] = []) {
  const [result] = await db.execute<ResultSetHeader>(sql, values);
  return result;
}
export async function transaction<T>(businessId: string, operation: (db: PoolConnection) => Promise<T>): Promise<T> {
  return runImsForBusiness(businessId, async () => {
    const db = await getIMSPool().getConnection();
    try {
      await db.beginTransaction();
      const result = await operation(db);
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback();
      throw error;
    } finally { db.release(); }
  });
}
