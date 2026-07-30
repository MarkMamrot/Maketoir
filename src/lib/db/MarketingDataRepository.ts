import { getPool, execute, query } from '@/services/MySQLService';
import { createHash } from 'node:crypto';

export interface MarketingDataRow {
  business_id:    string;
  platform:       string;
  account_id:     string;
  record_date:    string;
  entity_type:    string;
  entity_id:      string;
  entity_name:    string | null;
  metrics:        any;
  last_synced_at: string;
}

const GA4_METRIC_HEADERS = new Set([
  'sessions', 'activeUsers', 'newUsers', 'engagementRate', 'bounceRate',
  'averageSessionDuration', 'conversions', 'totalRevenue', 'itemRevenue',
  'itemsPurchased', 'itemsViewed', 'itemsAddedToCart', 'purchaseToViewRate',
]);

export function normalizeMarketingRecordDate(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{6}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-01`;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? fallback;
}

export function marketingEntityIdentity(headers: string[], row: string[]): { id: string; name: string } {
  const firstMetric = headers.findIndex((header) => GA4_METRIC_HEADERS.has(header));
  if (firstMetric <= 0) {
    return { id: String(row[0] ?? '').slice(0, 100), name: String(row[1] ?? '').slice(0, 499) };
  }
  const dimensions = headers.slice(0, firstMetric).map((header, index) => [header, row[index] ?? '']);
  const canonical = JSON.stringify(dimensions);
  const nameIndex = headers.slice(0, firstMetric).findIndex((header) => !/^(date|yearMonth)$/i.test(header));
  return {
    id: createHash('sha256').update(canonical).digest('hex'),
    name: String(nameIndex >= 0 ? row[nameIndex] ?? '' : row[0] ?? '').slice(0, 499),
  };
}

export const MarketingDataRepository = {
  /**
   * Replace all rows for a (businessId, platform, entityType) combination with fresh data.
   * `rows` is a 2D string array: rows[0] = column headers, rows[1..] = data.
   */
  async replaceTab(
    businessId: string,
    platform: string,
    accountId: string,
    entityType: string,
    rows: string[][],
  ): Promise<void> {
    await execute(
      'DELETE FROM marketing_data WHERE business_id = ? AND platform = ? AND entity_type = ?',
      [businessId, platform, entityType],
    );
    if (rows.length < 2) return;

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const syncDate = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Detect a date column to use as record_date
    const dateColIdx = headers.findIndex(h =>
      /^date$/i.test(h) || h === 'date_start' || h === 'record_date' || h === 'yearMonth',
    );

    const pool = getPool();
    const chunkSize = 200;
    for (let i = 0; i < dataRows.length; i += chunkSize) {
      const chunk = dataRows.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      const vals: any[] = [];
      chunk.forEach((row, idx) => {
        const metrics = Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? '']));
        const identity = marketingEntityIdentity(headers, row);
        const entityId = identity.id || String(i + idx);
        const entityName = identity.name;
        const recordDate = dateColIdx >= 0
          ? normalizeMarketingRecordDate(row[dateColIdx], syncDate)
          : syncDate;
        vals.push(
          businessId, platform, accountId, recordDate,
          entityType, entityId, entityName,
          JSON.stringify(metrics), now,
        );
      });
      await pool.query(
        `INSERT INTO marketing_data
           (business_id, platform, account_id, record_date, entity_type, entity_id, entity_name, metrics, last_synced_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE metrics = VALUES(metrics), last_synced_at = VALUES(last_synced_at)`,
        vals,
      );
    }
  },

  async getTab(
    businessId: string,
    platform: string,
    entityType: string,
  ): Promise<MarketingDataRow[]> {
    return query<MarketingDataRow>(
      'SELECT * FROM marketing_data WHERE business_id = ? AND platform = ? AND entity_type = ? ORDER BY record_date, entity_id',
      [businessId, platform, entityType],
    );
  },

  async getPlatformSummary(businessId: string): Promise<{ platform: string; entity_type: string; rows: number; last_synced_at: string }[]> {
    return query(
      `SELECT platform, entity_type, COUNT(*) AS rows, MAX(last_synced_at) AS last_synced_at
       FROM marketing_data WHERE business_id = ? GROUP BY platform, entity_type ORDER BY platform, entity_type`,
      [businessId],
    );
  },
};
