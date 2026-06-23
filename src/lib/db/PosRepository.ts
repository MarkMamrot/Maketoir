import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import bcrypt from 'bcryptjs';

/** Current datetime formatted as MySQL DATETIME in the business's local timezone. */
function localNow(): string {
  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).replace('T', ' ');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PosUserRow {
  id:            number;
  username:      string;
  password_hash: string;
  full_name:     string | null;
  email:         string | null;
  phone:         string | null;
  branch_ids:    number[] | null; // parsed from JSON
  is_active:     number;
  created_at:    string;
  updated_at:    string;
}

export interface PosSaleRow {
  id:                number;
  local_id:          string | null;
  location_id:       number;
  cashier_id:        number;
  sale_type:         'sale' | 'return' | 'layby';
  status:            'open' | 'parked' | 'completed' | 'voided' | 'layby_active' | 'layby_complete';
  customer_name:     string | null;
  customer_phone:    string | null;
  subtotal:          number;
  discount_total:    number;
  tax_total:         number;
  total:             number;
  notes:             string | null;
  parked_label:      string | null;
  return_of_sale_id: number | null;
  created_at:        string;
  completed_at:      string | null;
}

export interface PosSaleItemRow {
  id:              number;
  sale_id:         number;
  variant_id:      string | null;
  code:            string | null;
  name:            string;
  qty:             number;
  unit_price:      number;
  original_price:  number | null;
  discount_type:   'none' | 'percent' | 'amount';
  discount_value:  number;
  discount_amount: number;
  tax_rate:        number;
  line_total:      number;
}

export interface PosPaymentRow {
  id:             number;
  sale_id:        number;
  payment_method: string;
  amount:         number;
  reference:      string | null;
  created_at:     string;
}

export interface PosEodRow {
  id:                number;
  location_id:       number;
  register_id:       number | null;
  cashier_id:        number;
  recon_date:        string;
  payment_method:    string;
  expected_amount:   number | null;
  counted_amount:    number | null;
  opening_float:     number | null;
  denomination_data: Record<string, number> | null;
  notes:             string | null;
  xero_invoice_id?:  string | null;
  xero_synced_at?:   string | null;
  created_at:        string;
}

export interface PosRegisterRow {
  id:            number;
  location_id:   number;
  name:          string;
  default_float: number;
  is_active:     number;
  created_at:    string;
}

export interface PosRegisterSessionRow {
  id:               number;
  register_id:      number;
  location_id:      number;
  session_date:     string;
  opened_at:        string;
  closed_at:        string | null;
  opened_by:        string | null;
  closed_by:        string | null;
  opening_float:    number | null;
  denomination_data: Record<string, number> | null;
  status:           'open' | 'closed';
}

// ─── Helper: coerce mysql2 decimals ──────────────────────────────────────────

function toNum(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function parseUser(row: any): PosUserRow {
  return {
    ...row,
    branch_ids: row.branch_ids
      ? (typeof row.branch_ids === 'string' ? JSON.parse(row.branch_ids) : row.branch_ids)
      : null,
  };
}

function parseSale(row: any): PosSaleRow {
  return {
    ...row,
    subtotal:       toNum(row.subtotal),
    discount_total: toNum(row.discount_total),
    tax_total:      toNum(row.tax_total),
    total:          toNum(row.total),
  };
}

function parseItem(row: any): PosSaleItemRow {
  return {
    ...row,
    qty:             toNum(row.qty),
    unit_price:      toNum(row.unit_price),
    original_price:  row.original_price != null ? toNum(row.original_price) : null,
    discount_value:  toNum(row.discount_value),
    discount_amount: toNum(row.discount_amount),
    tax_rate:        toNum(row.tax_rate),
    line_total:      toNum(row.line_total),
  };
}

function parsePayment(row: any): PosPaymentRow {
  return { ...row, amount: toNum(row.amount) };
}

// ─── POS Users Repository ─────────────────────────────────────────────────────

export const PosUsersRepo = {
  async list(): Promise<Omit<PosUserRow, 'password_hash'>[]> {
    const rows = await imsQuery<any>(
      'SELECT id, username, full_name, email, phone, branch_ids, is_active, created_at, updated_at FROM pos_users ORDER BY full_name',
    );
    return rows.map(parseUser);
  },

  async get(id: number): Promise<PosUserRow | null> {
    const rows = await imsQuery<any>('SELECT * FROM pos_users WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? parseUser(rows[0]) : null;
  },

  async findByUsername(username: string): Promise<PosUserRow | null> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_users WHERE username = ? LIMIT 1',
      [username.trim().toLowerCase()],
    );
    return rows[0] ? parseUser(rows[0]) : null;
  },

  async create(data: {
    username: string;
    password: string;
    full_name?: string;
    email?: string;
    phone?: string;
    branch_ids?: number[] | null;
  }): Promise<number> {
    const hash = await bcrypt.hash(data.password, 12);
    const result = await imsExecute(
      `INSERT INTO pos_users (username, password_hash, full_name, email, phone, branch_ids)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.username.trim().toLowerCase(),
        hash,
        data.full_name ?? null,
        data.email ?? null,
        data.phone ?? null,
        data.branch_ids ? JSON.stringify(data.branch_ids) : null,
      ],
    );
    return result.insertId;
  },

  async update(id: number, data: {
    full_name?: string;
    email?: string;
    phone?: string;
    branch_ids?: number[] | null;
    is_active?: number;
    password?: string;
  }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.full_name !== undefined) { sets.push('full_name = ?');  params.push(data.full_name); }
    if (data.email !== undefined)     { sets.push('email = ?');      params.push(data.email); }
    if (data.phone !== undefined)     { sets.push('phone = ?');      params.push(data.phone); }
    if (data.is_active !== undefined) { sets.push('is_active = ?');  params.push(data.is_active); }
    if (data.branch_ids !== undefined) {
      sets.push('branch_ids = ?');
      params.push(data.branch_ids ? JSON.stringify(data.branch_ids) : null);
    }
    if (data.password) {
      const hash = await bcrypt.hash(data.password, 12);
      sets.push('password_hash = ?');
      params.push(hash);
    }

    if (sets.length === 0) return;
    params.push(id);
    await imsExecute(`UPDATE pos_users SET ${sets.join(', ')} WHERE id = ?`, params);
  },

  async verifyPassword(user: PosUserRow, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  },
};

// ─── POS Sales Repository ─────────────────────────────────────────────────────

export const PosSalesRepo = {
  async get(id: number): Promise<{ sale: PosSaleRow; items: PosSaleItemRow[]; payments: PosPaymentRow[] } | null> {
    const sales = await imsQuery<any>('SELECT * FROM pos_sales WHERE id = ? LIMIT 1', [id]);
    if (!sales[0]) return null;
    const sale = parseSale(sales[0]);
    const items = (await imsQuery<any>('SELECT * FROM pos_sale_items WHERE sale_id = ?', [id])).map(parseItem);
    const payments = (await imsQuery<any>('SELECT * FROM pos_payments WHERE sale_id = ? ORDER BY created_at', [id])).map(parsePayment);
    return { sale, items, payments };
  },

  async findByLocalId(localId: string): Promise<PosSaleRow | null> {
    const rows = await imsQuery<any>('SELECT * FROM pos_sales WHERE local_id = ? LIMIT 1', [localId]);
    return rows[0] ? parseSale(rows[0]) : null;
  },

  async list(locationId: number, date: string): Promise<PosSaleRow[]> {
    // date: 'YYYY-MM-DD'
    const rows = await imsQuery<any>(
      `SELECT * FROM pos_sales
       WHERE location_id = ? AND DATE(created_at) = ?
       ORDER BY created_at DESC`,
      [locationId, date],
    );
    return rows.map(parseSale);
  },

  async listParked(locationId: number): Promise<PosSaleRow[]> {
    const rows = await imsQuery<any>(
      `SELECT * FROM pos_sales WHERE location_id = ? AND status IN ('parked','layby_active')
       ORDER BY created_at DESC`,
      [locationId],
    );
    return rows.map(parseSale);
  },

  /**
   * Complete a sale in a single transaction:
   * 1. INSERT pos_sales
   * 2. INSERT pos_sale_items
   * 3. INSERT pos_payments
   * 4. Deduct IMS stock for items that have a variant_id
   * Returns the new sale id.
   */
  async complete(data: {
    local_id:          string | null;
    register_id:       number | null;
    location_id:       number;
    cashier_id:        number | null;
    cashier_name:      string | null;
    sale_type:         'sale' | 'return' | 'layby';
    status:            'completed' | 'layby_active' | 'layby_complete' | 'parked' | 'voided';
    customer_name?:    string | null;
    customer_phone?:   string | null;
    subtotal:          number;
    discount_total:    number;
    tax_total:         number;
    total:             number;
    notes?:            string | null;
    parked_label?:     string | null;
    return_of_sale_id?: number | null;
    items: Array<{
      variant_id:      string | null;
      code:            string | null;
      name:            string;
      qty:             number;
      unit_price:      number;
      original_price?: number | null;
      discount_type:   'none' | 'percent' | 'amount';
      discount_value:  number;
      discount_amount: number;
      tax_rate:        number;
      line_total:      number;
    }>;
    payments: Array<{
      payment_method: string;
      amount:         number;
      reference?:     string | null;
    }>;
  }): Promise<number> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const now = localNow();
      const completedAt = ['completed', 'layby_complete', 'voided'].includes(data.status) ? now : null;

      // 1. Insert sale
      const [saleResult]: any = await conn.execute(
        `INSERT INTO pos_sales
           (local_id, register_id, location_id, cashier_id, cashier_name, sale_type, status,
            customer_name, customer_phone, subtotal, discount_total,
            tax_total, total, notes, parked_label, return_of_sale_id, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.local_id ?? null,
          data.register_id ?? null,
          data.location_id,
          data.cashier_id,
          data.cashier_name ?? null,
          data.sale_type,
          data.status,
          data.customer_name ?? null,
          data.customer_phone ?? null,
          data.subtotal,
          data.discount_total,
          data.tax_total,
          data.total,
          data.notes ?? null,
          data.parked_label ?? null,
          data.return_of_sale_id ?? null,
          completedAt,
          now,
        ],
      );
      const saleId: number = saleResult.insertId;

      // 2. Insert items
      for (const item of data.items) {
        await conn.execute(
          `INSERT INTO pos_sale_items
             (sale_id, variant_id, code, name, qty, unit_price, original_price,
              discount_type, discount_value, discount_amount, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleId,
            item.variant_id ?? null,
            item.code ?? null,
            item.name,
            item.qty,
            item.unit_price,
            item.original_price ?? null,
            item.discount_type,
            item.discount_value,
            item.discount_amount,
            item.tax_rate,
            item.line_total,
          ],
        );
      }

      // 3. Insert payments
      for (const pmt of data.payments) {
        await conn.execute(
          `INSERT INTO pos_payments (sale_id, payment_method, amount, reference)
           VALUES (?, ?, ?, ?)`,
          [saleId, pmt.payment_method, pmt.amount, pmt.reference ?? null],
        );
      }

      // 4. Deduct IMS stock for completed/layby_complete sales
      if (data.status === 'completed' || data.status === 'layby_complete') {
        for (const item of data.items) {
          if (!item.variant_id) continue;
          // For returns, qty is negative — this ADDS back to stock
          const qtyChange = data.sale_type === 'return' ? item.qty : -item.qty;
          try {
            const [stockRows]: any = await conn.execute(
              `SELECT qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ? LIMIT 1`,
              [item.variant_id, data.location_id],
            );
            const currentSoh = stockRows[0] ? Number(stockRows[0].qty_on_hand) : 0;
            const newSoh = currentSoh + qtyChange;

            if (stockRows[0]) {
              await conn.execute(
                `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?`,
                [newSoh, item.variant_id, data.location_id],
              );
            } else {
              await conn.execute(
                `INSERT INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, ?)`,
                [item.variant_id, data.location_id, newSoh],
              );
            }

            await conn.execute(
              `INSERT INTO ims_stock_movements
                 (variant_id, location_id, movement_type, reference_type, reference_id,
                  qty_change, qty_after_soh)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [item.variant_id, data.location_id, 'pos_sale', 'pos_sale', saleId, qtyChange, newSoh],
            );
          } catch {
            // Non-fatal — stock deduction failure doesn't block the sale
          }
        }
      }

      await conn.commit();
      return saleId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async updateStatus(id: number, status: PosSaleRow['status'], extra?: { parked_label?: string }): Promise<void> {
    const completedAt = ['completed', 'layby_complete', 'voided'].includes(status)
      ? localNow()
      : null;
    if (extra?.parked_label !== undefined) {
      await imsExecute(
        'UPDATE pos_sales SET status = ?, parked_label = ?, completed_at = ? WHERE id = ?',
        [status, extra.parked_label, completedAt, id],
      );
    } else {
      await imsExecute(
        'UPDATE pos_sales SET status = ?, completed_at = ? WHERE id = ?',
        [status, completedAt, id],
      );
    }
  },

  async addPaymentToSale(saleId: number, payment: { payment_method: string; amount: number; reference?: string | null }): Promise<void> {
    await imsExecute(
      'INSERT INTO pos_payments (sale_id, payment_method, amount, reference) VALUES (?, ?, ?, ?)',
      [saleId, payment.payment_method, payment.amount, payment.reference ?? null],
    );
  },
};

// ─── POS EOD Repository ───────────────────────────────────────────────────────

export const PosEodRepo = {
  async get(locationId: number, date: string, registerId?: number | null): Promise<PosEodRow[]> {
    const rows = await imsQuery<any>(
      registerId != null
        ? 'SELECT * FROM pos_eod_reconciliations WHERE location_id = ? AND recon_date = ? AND register_id = ? ORDER BY payment_method'
        : 'SELECT * FROM pos_eod_reconciliations WHERE location_id = ? AND recon_date = ? ORDER BY payment_method',
      registerId != null ? [locationId, date, registerId] : [locationId, date],
    );
    return rows.map((r: any) => ({
      ...r,
      expected_amount: r.expected_amount != null ? toNum(r.expected_amount) : null,
      counted_amount:  r.counted_amount  != null ? toNum(r.counted_amount)  : null,
      opening_float:   r.opening_float   != null ? toNum(r.opening_float)   : null,
      denomination_data: r.denomination_data
        ? (typeof r.denomination_data === 'string' ? JSON.parse(r.denomination_data) : r.denomination_data)
        : null,
    }));
  },

  async getExpected(locationId: number, date: string, registerId?: number | null): Promise<Record<string, number>> {
    const rows = await imsQuery<any>(
      registerId != null
        ? `SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total
           FROM pos_payments p
           JOIN pos_sales s ON s.id = p.sale_id
           WHERE s.location_id = ? AND s.register_id = ? AND DATE(s.completed_at) = ?
             AND s.status IN ('completed','layby_complete')
           GROUP BY p.payment_method`
        : `SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total
           FROM pos_payments p
           JOIN pos_sales s ON s.id = p.sale_id
           WHERE s.location_id = ? AND DATE(s.completed_at) = ?
             AND s.status IN ('completed','layby_complete')
           GROUP BY p.payment_method`,
      registerId != null ? [locationId, registerId, date] : [locationId, date],
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.payment_method] = toNum(row.total);
    }
    return result;
  },

  async save(data: {
    location_id:      number;
    register_id:      number | null;
    cashier_id:       number | null;
    cashier_name:     string | null;
    recon_date:       string;
    payment_method:   string;
    expected_amount:  number | null;
    counted_amount:   number | null;
    opening_float:    number | null;
    denomination_data?: Record<string, number> | null;
    notes?:           string | null;
  }): Promise<void> {
    await imsExecute(
      `INSERT INTO pos_eod_reconciliations
         (location_id, register_id, cashier_id, cashier_name, recon_date, payment_method,
          expected_amount, counted_amount, opening_float, denomination_data, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cashier_id        = VALUES(cashier_id),
         cashier_name      = VALUES(cashier_name),
         expected_amount   = VALUES(expected_amount),
         counted_amount    = VALUES(counted_amount),
         opening_float     = VALUES(opening_float),
         denomination_data = VALUES(denomination_data),
         notes             = VALUES(notes)`,
      [
        data.location_id,
        data.register_id ?? null,
        data.cashier_id ?? null,
        data.cashier_name ?? null,
        data.recon_date,
        data.payment_method,
        data.expected_amount ?? null,
        data.counted_amount ?? null,
        data.opening_float ?? null,
        data.denomination_data ? JSON.stringify(data.denomination_data) : null,
        data.notes ?? null,
      ],
    );
  },

  async setXeroInvoice(locationId: number, date: string, method: string, invoiceId: string, registerId?: number | null): Promise<void> {
    if (registerId != null) {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_invoice_id = ?, xero_synced_at = NOW()
           WHERE location_id = ? AND register_id = ? AND recon_date = ? AND payment_method = ?`,
        [invoiceId, locationId, registerId, date, method],
      );
    } else {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_invoice_id = ?, xero_synced_at = NOW()
           WHERE location_id = ? AND recon_date = ? AND payment_method = ?`,
        [invoiceId, locationId, date, method],
      );
    }
  },
};

// ─── POS Registers Repository ─────────────────────────────────────────────────

function parseRegister(r: any): PosRegisterRow {
  return { ...r, default_float: toNum(r.default_float) };
}

export const PosRegistersRepo = {
  async listForLocation(locationId: number): Promise<PosRegisterRow[]> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_registers WHERE location_id = ? ORDER BY id',
      [locationId],
    );
    return rows.map(parseRegister);
  },

  async get(id: number): Promise<PosRegisterRow | null> {
    const rows = await imsQuery<any>('SELECT * FROM pos_registers WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? parseRegister(rows[0]) : null;
  },

  async getDefaultForLocation(locationId: number): Promise<PosRegisterRow | null> {
    const rows = await imsQuery<any>(
      "SELECT * FROM pos_registers WHERE location_id = ? AND name = 'Default Register' LIMIT 1",
      [locationId],
    );
    return rows[0] ? parseRegister(rows[0]) : null;
  },

  async create(locationId: number, name: string, defaultFloat: number): Promise<number> {
    const result = await imsExecute(
      'INSERT INTO pos_registers (location_id, name, default_float) VALUES (?, ?, ?)',
      [locationId, name.trim(), defaultFloat],
    );
    return result.insertId;
  },

  async update(id: number, data: { name?: string; default_float?: number; is_active?: number }): Promise<void> {
    const fields: string[] = [];
    const vals:   any[]    = [];
    if (data.name          !== undefined) { fields.push('name = ?');          vals.push(data.name.trim()); }
    if (data.default_float !== undefined) { fields.push('default_float = ?'); vals.push(data.default_float); }
    if (data.is_active     !== undefined) { fields.push('is_active = ?');     vals.push(data.is_active); }
    if (!fields.length) return;
    vals.push(id);
    await imsExecute(`UPDATE pos_registers SET ${fields.join(', ')} WHERE id = ?`, vals);
  },
};

// ─── POS Register Session Repository ─────────────────────────────────────────

function parseSession(r: any): PosRegisterSessionRow {
  return {
    ...r,
    opening_float: r.opening_float != null ? toNum(r.opening_float) : null,
    denomination_data: r.denomination_data
      ? (typeof r.denomination_data === 'string' ? JSON.parse(r.denomination_data) : r.denomination_data)
      : null,
  };
}

export const PosRegisterSessionRepo = {
  /** Get the currently open session for a register (null if none). */
  async getCurrent(registerId: number): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      "SELECT * FROM pos_register_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
      [registerId],
    );
    return rows[0] ? parseSession(rows[0]) : null;
  },

  /** Get the session for a specific date (any status). */
  async getForDay(registerId: number, date: string): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_register_sessions WHERE register_id = ? AND session_date = ? ORDER BY opened_at DESC LIMIT 1',
      [registerId, date],
    );
    return rows[0] ? parseSession(rows[0]) : null;
  },

  async open(data: {
    register_id:      number;
    location_id:      number;
    session_date:     string;
    opened_at:        string;
    opened_by:        string | null;
    opening_float:    number | null;
    denomination_data?: Record<string, number> | null;
  }): Promise<number> {
    const result = await imsExecute(
      `INSERT INTO pos_register_sessions
         (register_id, location_id, session_date, opened_at, opened_by, opening_float, denomination_data, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        data.register_id,
        data.location_id,
        data.session_date,
        data.opened_at,
        data.opened_by ?? null,
        data.opening_float ?? null,
        data.denomination_data ? JSON.stringify(data.denomination_data) : null,
      ],
    );
    return result.insertId;
  },

  async close(sessionId: number, closedAt: string, closedBy: string | null): Promise<void> {
    await imsExecute(
      "UPDATE pos_register_sessions SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?",
      [closedAt, closedBy ?? null, sessionId],
    );
  },
};

// ─── POS Reports ──────────────────────────────────────────────────────────────

export const PosReportsRepo = {
  async dailyTransactions(locationId: number, date: string): Promise<{
    sale: PosSaleRow;
    items: PosSaleItemRow[];
    payments: PosPaymentRow[];
  }[]> {
    const sales = await imsQuery<any>(
      `SELECT s.*, COALESCE(s.cashier_name, u.full_name) AS cashier_name
       FROM pos_sales s
       LEFT JOIN pos_users u ON u.id = s.cashier_id
       WHERE s.location_id = ? AND DATE(s.created_at) = ?
         AND s.status IN ('completed','layby_complete')
       ORDER BY s.created_at`,
      [locationId, date],
    );
    if (!sales.length) return [];

    const ids = sales.map((s: any) => s.id);
    const placeholders = ids.map(() => '?').join(',');

    const allItems = (await imsQuery<any>(
      `SELECT * FROM pos_sale_items WHERE sale_id IN (${placeholders})`,
      ids,
    )).map(parseItem);

    const allPayments = (await imsQuery<any>(
      `SELECT * FROM pos_payments WHERE sale_id IN (${placeholders}) ORDER BY created_at`,
      ids,
    )).map(parsePayment);

    return sales.map((s: any) => ({
      sale:     parseSale(s),
      items:    allItems.filter((i) => i.sale_id === s.id),
      payments: allPayments.filter((p) => p.sale_id === s.id),
    }));
  },

  async graphData(locationId: number, days: number): Promise<{ date: string; total: number; count: number }[]> {
    const rows = await imsQuery<any>(
      `SELECT DATE(completed_at) AS date,
              COALESCE(SUM(total), 0) AS total,
              COUNT(*) AS count
       FROM pos_sales
       WHERE location_id = ?
         AND status IN ('completed','layby_complete')
         AND completed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(completed_at)
       ORDER BY date`,
      [locationId, days],
    );
    return rows.map((r: any) => ({
      date:  r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      total: toNum(r.total),
      count: Number(r.count),
    }));
  },
};
