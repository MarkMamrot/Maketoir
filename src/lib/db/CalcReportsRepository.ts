import { query, execute } from '@/services/MySQLService';

export type ReportType =
  | 'brand-summary'
  | 'reports'
  | 'revenue-per-branch'
  | 'top-sellers'
  | 'yearly-revenue'
  | string;  // allow future types

export interface CalcReportRow {
  id?:          number;
  business_id:  string;
  report_type:  ReportType;
  data:         any;           // deserialized JSON
  generated_at: string;
}

export interface YearlyRevenueRow {
  id?:         number;
  business_id: string;
  year:        number;
  revenue:     number;
  extra_json:  Record<string, any> | null;
}

export const CalcReportsRepository = {
  async getReport(businessId: string, reportType: ReportType): Promise<any | null> {
    const rows = await query<{ data: any }>(
      'SELECT data FROM calc_reports WHERE business_id = ? AND report_type = ?',
      [businessId, reportType],
    );
    if (!rows[0]) return null;
    try {
      return typeof rows[0].data === 'string'
        ? JSON.parse(rows[0].data)
        : rows[0].data;
    } catch { return null; }
  },

  async replaceReport(businessId: string, reportType: ReportType, data: any): Promise<void> {
    await execute(
      `INSERT INTO calc_reports (business_id, report_type, data, generated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE data = VALUES(data), generated_at = NOW()`,
      [businessId, reportType, JSON.stringify(data)],
    );
  },
};

export const YearlyRevenueRepository = {
  async list(businessId: string): Promise<YearlyRevenueRow[]> {
    const rows = await query<YearlyRevenueRow>(
      'SELECT * FROM yearly_revenue WHERE business_id = ? ORDER BY year',
      [businessId],
    );
    return rows.map(r => ({
      ...r,
      extra_json: typeof r.extra_json === 'string'
        ? (() => { try { return JSON.parse(r.extra_json as any); } catch { return null; } })()
        : r.extra_json,
    }));
  },

  async bulkReplace(businessId: string, rows: Omit<YearlyRevenueRow, 'id' | 'business_id'>[]): Promise<void> {
    await execute('DELETE FROM yearly_revenue WHERE business_id = ?', [businessId]);
    for (const r of rows) {
      await execute(
        'INSERT INTO yearly_revenue (business_id, year, revenue, extra_json) VALUES (?, ?, ?, ?)',
        [businessId, r.year, r.revenue,
         r.extra_json ? JSON.stringify(r.extra_json) : null],
      );
    }
  },
};
