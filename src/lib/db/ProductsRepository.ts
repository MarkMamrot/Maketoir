import { query, execute, getPool } from '@/services/MySQLService';

export interface ProductRow {
  business_id:        string;
  cin7_id:            string;
  option_id:          string;
  code:               string | null;
  style_code:         string | null;
  barcode:            string | null;
  name:               string | null;
  brand:              string | null;
  supplier_id:        string | null;
  option_label:       string | null;
  online:             number | null;
  pack_size:          number | null;
  cost:               number | null;
  retail_price:       number | null;
  volume:             number | null;
  created_date:       string | null;
  last_synced_at:     string | null;
  global_soh:         number;
  global_available:   number;
  global_incoming:    number;
  sales_qty_7d:       number;
  sales_qty_90d:      number;
  sales_qty_180d:     number;
  sales_qty_12m:      number;
  sales_revenue_7d:   number;
  sales_revenue_90d:  number;
  sales_revenue_180d: number;
  sales_revenue_12m:  number;
}

export interface StockRow {
  business_id:        string;
  product_option_id:  string;
  branch_id:          string | null;
  branch_name:        string | null;
  code:               string | null;
  name:               string | null;
  soh:                number;
  available:          number;
  incoming:           number;
  reorder_point:      number | null;
  reorder_qty:        number | null;
  last_synced_at:     string | null;
}

export const ProductsRepository = {
  async list(businessId: string): Promise<ProductRow[]> {
    return query<ProductRow>(
      'SELECT * FROM products WHERE business_id = ?',
      [businessId],
    );
  },

  async updateVolume(businessId: string, optionId: string, volumeRating: number): Promise<void> {
    await execute(
      'UPDATE products SET volume = ? WHERE business_id = ? AND option_id = ?',
      [Math.min(10, Math.max(1, Math.round(volumeRating))), businessId, optionId],
    );
  },

  async upsertBatch(businessId: string, rows: Omit<ProductRow, 'business_id'>[]): Promise<void> {
    if (rows.length === 0) return;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (const r of rows) {
        await conn.execute(
          `INSERT INTO products
             (business_id, cin7_id, option_id, code, style_code, barcode, name, brand,
              supplier_id, option_label, online, pack_size, cost, retail_price, volume,
              created_date, last_synced_at, global_soh, global_available, global_incoming,
              sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m,
              sales_revenue_7d, sales_revenue_90d, sales_revenue_180d, sales_revenue_12m)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             cin7_id=VALUES(cin7_id), code=VALUES(code), style_code=VALUES(style_code),
             barcode=VALUES(barcode), name=VALUES(name), brand=VALUES(brand),
             supplier_id=VALUES(supplier_id), option_label=VALUES(option_label),
             online=VALUES(online), pack_size=VALUES(pack_size), cost=VALUES(cost),
             retail_price=VALUES(retail_price), volume=VALUES(volume),
             created_date=VALUES(created_date), last_synced_at=VALUES(last_synced_at),
             global_soh=VALUES(global_soh), global_available=VALUES(global_available),
             global_incoming=VALUES(global_incoming),
             sales_qty_7d=VALUES(sales_qty_7d), sales_qty_90d=VALUES(sales_qty_90d),
             sales_qty_180d=VALUES(sales_qty_180d), sales_qty_12m=VALUES(sales_qty_12m),
             sales_revenue_7d=VALUES(sales_revenue_7d), sales_revenue_90d=VALUES(sales_revenue_90d),
             sales_revenue_180d=VALUES(sales_revenue_180d), sales_revenue_12m=VALUES(sales_revenue_12m)`,
          [businessId, r.cin7_id, r.option_id, r.code ?? null, r.style_code ?? null,
           r.barcode ?? null, r.name ?? null, r.brand ?? null, r.supplier_id ?? null,
           r.option_label ?? null, r.online ?? null, r.pack_size ?? null,
           r.cost ?? null, r.retail_price ?? null, r.volume ?? null,
           r.created_date ?? null, r.last_synced_at ?? null,
           r.global_soh, r.global_available, r.global_incoming,
           r.sales_qty_7d, r.sales_qty_90d, r.sales_qty_180d, r.sales_qty_12m,
           r.sales_revenue_7d, r.sales_revenue_90d, r.sales_revenue_180d, r.sales_revenue_12m],
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

export const StockRepository = {
  async list(businessId: string): Promise<StockRow[]> {
    return query<StockRow>(
      'SELECT * FROM stock WHERE business_id = ?',
      [businessId],
    );
  },

  async bulkReplace(businessId: string, rows: Omit<StockRow, 'business_id'>[]): Promise<void> {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM stock WHERE business_id = ?', [businessId]);
      for (const r of rows) {
        await conn.execute(
          `INSERT INTO stock
             (business_id, product_option_id, branch_id, branch_name, code, name,
              soh, available, incoming, reorder_point, reorder_qty, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             branch_name=VALUES(branch_name), code=VALUES(code), name=VALUES(name),
             soh=VALUES(soh), available=VALUES(available), incoming=VALUES(incoming),
             reorder_point=VALUES(reorder_point), reorder_qty=VALUES(reorder_qty),
             last_synced_at=VALUES(last_synced_at)`,
          [businessId, r.product_option_id, r.branch_id ?? null, r.branch_name ?? null,
           r.code ?? null, r.name ?? null, r.soh, r.available, r.incoming,
           r.reorder_point ?? null, r.reorder_qty ?? null, r.last_synced_at ?? null],
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
