import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';

import { createImsDatabase, validateImsSchema } from '../provisionBusiness';

const runIntegration = process.env.RUN_IMS_SCHEMA_INTEGRATION === '1';

describe.runIf(runIntegration)('fresh IMS schema integration', () => {
  it('executes the complete DDL and validates the resulting schema', async () => {
    const dbName = `marketoir_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const serverConfig = {
      host: process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
    };

    try {
      await createImsDatabase(dbName);
      await validateImsSchema(dbName);

      const connection = await mysql.createConnection(serverConfig);
      try {
        const [tables] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS count
             FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = ?`,
          [dbName],
        );
        expect(Number(tables[0]?.count)).toBeGreaterThan(50);
      } finally {
        await connection.end();
      }
    } finally {
      const connection = await mysql.createConnection(serverConfig);
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      } finally {
        await connection.end();
      }
    }
  }, 30_000);
});