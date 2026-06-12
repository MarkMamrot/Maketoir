import { query, execute, getPool } from '@/services/MySQLService';

export interface MarketingDataRow {
  id?:          number;
  business_id:  string;
  platform:     string;   // 'google_ads' | 'meta_ads' | 'shopify' | etc.
  account_id:   string;
  date_start:   string;   // YYYY-MM-DD
  date_end:     string;   // YYYY-MM-DD
  dimension_key: string;  // e.g. campaign name, product id
  metrics:      Record<string, any>;
  updated_at?:  string;
}

export const MarketingDataRepository = {
  async list(
    businessId: string,
    opts: { platform?: string; accountId?: string; from?: string; to?: string } = {},
  ): Promise<MarketingDataRow[]> {
    const conditions: string[] = ['business_id = ?'];
    const params: any[] = [businessId];
    if (opts.platform)  { conditions.push('platform = ?');    params.push(opts.platform); }
    if (opts.accountId) { conditions.push('account_id = ?');  params.push(opts.accountId); }
    if (opts.from)      { conditions.push('date_start >= ?'); params.push(opts.from); }
    if (opts.to)        { conditions.push('date_end <= ?');   params.push(opts.to); }
    const rows = await query<MarketingDataRow>(
      `SELECT * FROM marketing_data WHERE ${conditions.join(' AND ')} ORDER BY date_start DESC`,
      params,
    );
    return rows.map(r => ({
      ...r,
      metrics: typeof r.metrics === 'string'
        ? (() => { try { return JSON.parse(r.metrics as any); } catch { return {}; } })()
        : r.metrics,
    }));
  },

  async bulkReplace(
    businessId: string,
    platform: string,
    accountId: string,
    rows: Omit<MarketingDataRow, 'id' | 'business_id' | 'updated_at'>[],
  ): Promise<void> {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'DELETE FROM marketing_data WHERE business_id = ? AND platform = ? AND account_id = ?',
        [businessId, platform, accountId],
      );
      for (const r of rows) {
        await conn.execute(
          `INSERT INTO marketing_data
             (business_id, platform, account_id, date_start, date_end, dimension_key, metrics)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [businessId, platform, accountId,
           r.date_start, r.date_end, r.dimension_key,
           typeof r.metrics === 'string' ? r.metrics : JSON.stringify(r.metrics)],
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },
};
