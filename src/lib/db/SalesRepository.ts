import { query, execute, getPool } from '@/services/MySQLService';

export interface SaleRow {
  id?:               number;
  business_id:       string;
  order_id:          string;
  reference:         string | null;
  invoice_date:      string;           // YYYY-MM-DD
  branch_id:         string | null;    // Cin7 branchId
  member_id:         string | null;
  product_option_id: string;
  code:              string | null;
  name:              string | null;
  qty:               number;
  unit_price:        number;
  line_total:        number;
  source:            string | null;
  status:            string | null;
  stage:             string | null;  // joined fields (present when query includes joins)
  order_date?:       string;
  product_name?:     string | null;
  branch_name?:      string | null;
  customer_name?:    string | null;}

export const SalesRepository = {
  async query(
    businessId: string,
    opts: { from?: string; to?: string; branch?: string; limit?: number } = {},
  ): Promise<SaleRow[]> {
    const conditions: string[] = ['business_id = ?'];
    const params: any[] = [businessId];
    if (opts.from)   { conditions.push('invoice_date >= ?'); params.push(opts.from); }
    if (opts.to)     { conditions.push('invoice_date <= ?'); params.push(opts.to); }
    if (opts.branch) { conditions.push('branch_id = ?'); params.push(opts.branch); }
    const limitClause = opts.limit ? `LIMIT ${parseInt(String(opts.limit), 10)}` : '';
    return query<SaleRow>(
      `SELECT * FROM sales WHERE ${conditions.join(' AND ')} ORDER BY invoice_date DESC ${limitClause}`,
      params,
    );
  },

  async appendBatch(
    businessId: string,
    rows: Omit<SaleRow, 'id' | 'business_id'>[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (const r of rows) {
        await conn.execute(
          `INSERT INTO sales
             (business_id, order_id, reference, invoice_date, branch_id, member_id,
              product_option_id, code, name, qty, unit_price, line_total, source, status, stage)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             reference=VALUES(reference), invoice_date=VALUES(invoice_date),
             branch_id=VALUES(branch_id), member_id=VALUES(member_id),
             code=VALUES(code), name=VALUES(name), qty=VALUES(qty),
             unit_price=VALUES(unit_price), line_total=VALUES(line_total),
             source=VALUES(source), status=VALUES(status), stage=VALUES(stage)`,
          [businessId, r.order_id, r.reference ?? null, r.invoice_date,
           r.branch_id ?? null, r.member_id ?? null, r.product_option_id,
           r.code ?? null, r.name ?? null, r.qty, r.unit_price, r.line_total,
           r.source ?? null, r.status ?? null, r.stage ?? null],
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
