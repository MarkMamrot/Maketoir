import { query, execute } from '@/services/MySQLService';

export interface BusinessInfoRow {
  business_id:      string;
  brand_name:       string | null;
  brand_url:        string | null;
  years_in_business: string | null;
  facebook_link:    string | null;
  instagram_link:   string | null;
  pinterest_link:   string | null;
  abn:              string | null;
  updated_at:       string;
}

type PartialInfo = Partial<Omit<BusinessInfoRow, 'business_id' | 'updated_at'>>;

export const BusinessInfoRepository = {
  async get(businessId: string): Promise<BusinessInfoRow | null> {
    const rows = await query<BusinessInfoRow>(
      'SELECT * FROM business_info WHERE business_id = ?',
      [businessId],
    );
    return rows[0] ?? null;
  },

  async upsert(businessId: string, data: PartialInfo): Promise<void> {
    const fields = Object.keys(data) as (keyof PartialInfo)[];
    if (fields.length === 0) return;
    const setClauses = fields.map(f => `${f} = VALUES(${f})`).join(', ');
    const values = fields.map(f => (data as any)[f] ?? null);
    await execute(
      `INSERT INTO business_info (business_id, ${fields.join(', ')})
       VALUES (?, ${fields.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setClauses}, updated_at = NOW()`,
      [businessId, ...values],
    );
  },
};
