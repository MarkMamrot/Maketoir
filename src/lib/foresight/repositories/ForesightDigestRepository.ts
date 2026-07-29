import { execute, query } from '@/services/MySQLService';
import type { DailyDigestSnapshot } from '../dailyDigest';
import type { WeeklyDigestSnapshot } from '../weeklyDigest';

export type ForesightDigestType = 'daily_operations' | 'weekly_summary';

export interface ForesightDigestRow<TSnapshot = DailyDigestSnapshot | WeeklyDigestSnapshot> {
  id: number;
  business_id: string;
  digest_type: ForesightDigestType;
  digest_date: string;
  snapshot_json: TSnapshot;
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

  async upsertWeekly(
    businessId: string,
    digestDate: string,
    snapshot: WeeklyDigestSnapshot,
  ): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_digest_runs
         (business_id, digest_type, digest_date, snapshot_json)
       VALUES (?, 'weekly_summary', ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id), snapshot_json = VALUES(snapshot_json), generated_at = CURRENT_TIMESTAMP`,
      [businessId, digestDate, JSON.stringify(snapshot)],
    );
    return result.insertId;
  },

  async listRecent<TSnapshot = DailyDigestSnapshot>(
    businessId: string,
    limit = 7,
    digestType: ForesightDigestType = 'daily_operations',
  ): Promise<Array<ForesightDigestRow<TSnapshot>>> {
    const safeLimit = Math.max(1, Math.min(31, Math.trunc(limit)));
    const rows = await query<ForesightDigestRow<TSnapshot>>(
      `SELECT * FROM foresight_digest_runs
       WHERE business_id = ? AND digest_type = ?
       ORDER BY digest_date DESC LIMIT ${safeLimit}`,
      [businessId, digestType],
    );
    return rows.map((row) => ({ ...row, snapshot_json: parseJson(row.snapshot_json) }));
  },
};