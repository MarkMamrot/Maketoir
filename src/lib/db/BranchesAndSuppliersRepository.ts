import { query, execute } from '@/services/MySQLService';

export interface BranchRow {
  business_id:    string;
  cin7_id:        string | null;
  name:           string;
  is_active:      boolean | number;
  last_synced_at: string | null;
}

export interface SupplierRow {
  business_id:    string;
  cin7_id:        string | null;
  name:           string;
  contact_name:   string | null;
  email:          string | null;
  phone:          string | null;
  country:        string | null;
  lead_time_days: number | null;
  last_synced_at: string | null;
}

export const BranchesRepository = {
  async list(businessId: string): Promise<BranchRow[]> {
    return query<BranchRow>(
      'SELECT * FROM branches WHERE business_id = ? ORDER BY name',
      [businessId],
    );
  },

  async bulkReplace(businessId: string, rows: Omit<BranchRow, 'business_id'>[]): Promise<void> {
    await execute('DELETE FROM branches WHERE business_id = ?', [businessId]);
    for (const r of rows) {
      await execute(
        'INSERT INTO branches (business_id, cin7_id, name, is_active, last_synced_at) VALUES (?, ?, ?, ?, ?)',
        [businessId, r.cin7_id ?? null, r.name, r.is_active ? 1 : 0,
         r.last_synced_at ? new Date(r.last_synced_at) : null],
      );
    }
  },
};

export const SuppliersRepository = {
  async list(businessId: string): Promise<SupplierRow[]> {
    return query<SupplierRow>(
      'SELECT * FROM suppliers WHERE business_id = ? ORDER BY name',
      [businessId],
    );
  },

  async bulkReplace(businessId: string, rows: Omit<SupplierRow, 'business_id'>[]): Promise<void> {
    await execute('DELETE FROM suppliers WHERE business_id = ?', [businessId]);
    for (const r of rows) {
      await execute(
        'INSERT INTO suppliers (business_id, cin7_id, name, contact_name, email, phone, country, lead_time_days, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [businessId, r.cin7_id ?? null, r.name, r.contact_name ?? null, r.email ?? null,
         r.phone ?? null, r.country ?? null, r.lead_time_days ?? null,
         r.last_synced_at ? new Date(r.last_synced_at) : null],
      );
    }
  },
};
