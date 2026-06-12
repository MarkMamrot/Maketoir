import { query, execute } from '@/services/MySQLService';

export interface ConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

export const ConfigRepository = {
  async getAll(businessId: string): Promise<Record<string, string>> {
    const rows = await query<ConfigRow>(
      'SELECT `key`, value FROM config WHERE business_id = ?',
      [businessId],
    );
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  async get(businessId: string, key: string): Promise<string | null> {
    const rows = await query<ConfigRow>(
      'SELECT value FROM config WHERE business_id = ? AND `key` = ?',
      [businessId, key],
    );
    return rows[0]?.value ?? null;
  },

  async set(businessId: string, key: string, value: string): Promise<void> {
    await execute(
      'INSERT INTO config (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()',
      [businessId, key, value],
    );
  },

  async delete(businessId: string, key: string): Promise<void> {
    await execute(
      'DELETE FROM config WHERE business_id = ? AND `key` = ?',
      [businessId, key],
    );
  },
};
