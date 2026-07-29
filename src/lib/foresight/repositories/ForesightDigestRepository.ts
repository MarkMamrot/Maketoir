import { execute, query } from '@/services/MySQLService';
import type { DailyDigestSnapshot } from '../dailyDigest';

export interface ForesightDigestRow {
  id: number;
  business_id: string;
  digest_type: 'daily_operations';
  digest_date: string;
  snapshot_json: DailyDigestSnapshot;
  generated_at: string;
}

function parseJson<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

export const ForesightDigestRepository = {
  async upsertDaily(
    businessId: string,
    digestDate: string,
    snapshot: DailyDigestSnapshot,
  ): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_digest_runs
         (business_id, digest_type, digest_date, snapshot_json)
       VALUES (?, 'daily_operations', ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id), snapshot_json = VALUES(snapshot_json), generated_at = CURRENT_TIMESTAMP`,
      [businessId, digestDate, JSON.stringify(snapshot)],
    );
    return result.insertId;
  },

  async listRecent(businessId: string, limit = 7): Promise<ForesightDigestRow[]> {
    const safeLimit = Math.max(1, Math.min(31, Math.trunc(limit)));
    const rows = await query<ForesightDigestRow>(
      `SELECT * FROM foresight_digest_runs
       WHERE business_id = ? AND digest_type = 'daily_operations'
       ORDER BY digest_date DESC LIMIT ${safeLimit}`,
      [businessId],
    );
    return rows.map((row) => ({ ...row, snapshot_json: parseJson(row.snapshot_json) }));
  },
};