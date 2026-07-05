import { query, execute } from '@/services/MySQLService';

export interface BrandProfileRow {
  business_id:        string;
  mission:            string | null;
  uvp:                string | null;
  tone:               string | null;
  demographics:       string | null;
  geo:                string | null;
  hero_products:      string | null;
  price_positioning:  string | null;
  praises:            string | null;
  objections:         string | null;
  competitors:        string | null;
  market_gap:         string | null;
  logo_url:           string | null;
  brand_colours:      string | null;
  shipping_policy:    string | null;
  connected_software: string | null;
  operations_summary: string | null;
  returns_policy:     string | null;
  brand_history:      string | null;
  detailed_brand_aesthetic: string | null;
  physical_branches:  string | null;  // JSON string
  loyalty_program:    string | null;
  updated_at:         string;
}

type PartialProfile = Partial<Omit<BrandProfileRow, 'business_id' | 'updated_at'>>;

export const BrandProfileRepository = {
  async get(businessId: string): Promise<BrandProfileRow | null> {
    const rows = await query<BrandProfileRow>(
      'SELECT * FROM brand_profile WHERE business_id = ?',
      [businessId],
    );
    return rows[0] ?? null;
  },

  async upsert(businessId: string, data: PartialProfile): Promise<void> {
    const toStore = { ...data } as any;
    // physical_branches may arrive as array/object — serialize it
    if (toStore.physical_branches != null && typeof toStore.physical_branches !== 'string') {
      toStore.physical_branches = JSON.stringify(toStore.physical_branches);
    }
    const fields = Object.keys(toStore) as (keyof PartialProfile)[];
    if (fields.length === 0) return;
    const setClauses = fields.map(f => `${f} = VALUES(${f})`).join(', ');
    const values = fields.map(f => toStore[f] ?? null);
    await execute(
      `INSERT INTO brand_profile (business_id, ${fields.join(', ')})
       VALUES (?, ${fields.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setClauses}, updated_at = NOW()`,
      [businessId, ...values],
    );
  },
};
