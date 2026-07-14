import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';

/** Current datetime formatted as MySQL DATETIME in the business's local timezone. */
function localNow(): string {
  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).replace('T', ' ');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PosSaleRow {
  id:                number;
  local_id:          string | null;
  location_id:       number;
  cashier_id:        number;
  cashier_name:      string | null;
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
  register_session_id?: number | null;
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
  // Card terminal
  card_terminal_provider: string | null;
  zeller_site_id:         string | null;
  zeller_terminal_id:     string | null;
  zeller_api_key:         string | null;
  card_terminal_methods:  string | null;  // JSON array e.g. '["Card","EFTPOS"]'
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
    register_session_id?: number | null;
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
    cash_rounding?:    number;
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
  }): Promise<{ saleId: number; stockError: string | undefined }> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const now = localNow();
      const completedAt = ['completed', 'layby_complete', 'voided'].includes(data.status) ? now : null;

      // 1. Insert sale
      const [saleResult]: any = await conn.execute(
        `INSERT INTO pos_sales
           (local_id, register_id, register_session_id, location_id, cashier_id, cashier_name, sale_type, status,
            customer_name, customer_phone, subtotal, discount_total,
            tax_total, total, cash_rounding, notes, parked_label, return_of_sale_id, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.local_id ?? null,
          data.register_id ?? null,
          data.register_session_id ?? null,
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
          data.cash_rounding ?? 0,
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

      await conn.commit();

      // 4. Deduct IMS stock AFTER the sale transaction has committed.
      //    Separated so a stock failure (e.g. unsynced variant FK error) never
      //    causes the sale itself to roll back and re-queue.
      //    Returns stockError string if deduction failed — API returns success
      //    anyway so the client clears the queue, but logs the issue.
      let stockError: string | undefined;
      if (data.status === 'completed' || data.status === 'layby_complete') {
        const pool = getIMSPool();
        const stockConn = await pool.getConnection();
        try {
          await stockConn.beginTransaction();
          for (const item of data.items) {
            if (!item.variant_id) continue;
            const qtyChange = data.sale_type === 'return' ? item.qty : -item.qty;
            const [stockRows]: any = await stockConn.execute(
              `SELECT qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ? LIMIT 1`,
              [item.variant_id, data.location_id],
            );
            const currentSoh = stockRows[0] ? Number(stockRows[0].qty_on_hand) : 0;
            const newSoh = currentSoh + qtyChange;

            if (stockRows[0]) {
              await stockConn.execute(
                `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?`,
                [newSoh, item.variant_id, data.location_id],
              );
            } else {
              await stockConn.execute(
                `INSERT INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, ?)`,
                [item.variant_id, data.location_id, newSoh],
              );
            }

            await stockConn.execute(
              `INSERT INTO ims_stock_movements
                 (variant_id, location_id, movement_type, channel, reference_type, reference_id,
                  qty_change, qty_after_soh)
               VALUES (?, ?, ?, 'pos', ?, ?, ?, ?)`,
              [item.variant_id, data.location_id, 'pos_sale', 'pos_sale', saleId, qtyChange, newSoh],
            );
          }
          await stockConn.commit();
        } catch (stockErr: any) {
          await stockConn.rollback();
          stockError = stockErr?.message || String(stockErr);
          console.error(`[POS] Sale ${saleId} saved but stock deduction failed:`, stockErr);
        } finally {
          stockConn.release();
        }
      }

      return { saleId, stockError };
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

  async updatePaymentSplit(
    saleId: number,
    payments: { payment_method: string; amount: number }[],
  ): Promise<void> {
    // Server-side guard: new amounts must sum to the original sale total (within 1 cent)
    const saleRows = await imsQuery<any>('SELECT total FROM pos_sales WHERE id = ? LIMIT 1', [saleId]);
    if (!saleRows[0]) throw new Error('Sale not found.');
    const originalTotal = toNum(saleRows[0].total);
    const newTotal = payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(newTotal - originalTotal) > 0.01) {
      throw new Error(`Payment total $${newTotal.toFixed(2)} does not match sale total $${originalTotal.toFixed(2)}.`);
    }
    if (payments.some(p => p.amount < 0)) throw new Error('Payment amounts cannot be negative.');
    // Replace all payments in a transaction
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM pos_payments WHERE sale_id = ?', [saleId]);
      for (const p of payments) {
        await conn.execute(
          'INSERT INTO pos_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)',
          [saleId, p.payment_method, p.amount],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
    return rows.map(this._mapRow);
  },

  /**
   * Load saved reconciliation rows scoped to a single register SESSION.
   *
   * The `uq_eod` unique key is (location_id, register_id, recon_date,
   * payment_method) — it does NOT include register_session_id — so a fresh
   * session opened on the same register/date would otherwise inherit the
   * PREVIOUS session's saved counted amounts. This returns only:
   *   • rows already stamped with THIS session's id, and
   *   • the as-yet-unclaimed opening-float row (register_session_id IS NULL)
   *     for this register/date, written when the register was opened.
   * A new session therefore starts with empty counted fields until it saves.
   */
  async getBySession(
    registerSessionId: number,
    fallback: { locationId: number; date: string; registerId: number | null },
  ): Promise<PosEodRow[]> {
    // register_id may legitimately be null in the DB (pre-register-id era rows);
    // using `= null` in a prepared statement never matches — we must use IS NULL.
    const hasReg = fallback.registerId != null;
    const rows = await imsQuery<any>(
      hasReg
        ? `SELECT * FROM pos_eod_reconciliations
            WHERE register_session_id = ?
               OR (register_session_id IS NULL AND counted_amount IS NULL
                   AND location_id = ? AND register_id = ? AND recon_date = ?)
            ORDER BY payment_method`
        : `SELECT * FROM pos_eod_reconciliations
            WHERE register_session_id = ?
               OR (register_session_id IS NULL AND counted_amount IS NULL
                   AND location_id = ? AND register_id IS NULL AND recon_date = ?)
            ORDER BY payment_method`,
      hasReg
        ? [registerSessionId, fallback.locationId, fallback.registerId, fallback.date]
        : [registerSessionId, fallback.locationId, fallback.date],
    );
    return rows.map(this._mapRow);
  },

  _mapRow(r: any): PosEodRow {
    return {
      ...r,
      expected_amount: r.expected_amount != null ? toNum(r.expected_amount) : null,
      counted_amount:  r.counted_amount  != null ? toNum(r.counted_amount)  : null,
      opening_float:   r.opening_float   != null ? toNum(r.opening_float)   : null,
      denomination_data: r.denomination_data
        ? (typeof r.denomination_data === 'string' ? JSON.parse(r.denomination_data) : r.denomination_data)
        : null,
    };
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

  /**
   * Build a WHERE condition matching every sale that belongs to one register
   * session. When a fallback (register/location) is supplied it ALSO catches
   * sales whose register_session_id was never stored — e.g. an offline-first
   * sale that synced after the session was closed — by matching the session's
   * actual opened_at → closed_at (or NOW(), if still open) time window rather
   * than a single calendar date. The `register_session_id IS NULL` guard means
   * sales already attributed to a different session are never double-counted.
   *
   * @param prefix column alias prefix for the query ('s.' or '').
   */
  async _sessionMatchClause(
    registerSessionId: number,
    prefix: string,
    fallback?: { locationId: number; date: string; registerId: number | null },
  ): Promise<{ clause: string; params: any[] }> {
    if (fallback?.registerId == null) {
      return { clause: `${prefix}register_session_id = ?`, params: [registerSessionId] };
    }
    const sess = await imsQuery<any>(
      'SELECT opened_at, closed_at FROM pos_register_sessions WHERE id = ? LIMIT 1',
      [registerSessionId],
    );
    const openedAt = sess[0]?.opened_at ?? null;
    const closedAt = sess[0]?.closed_at ?? null;
    if (openedAt) {
      // Time-window fallback: opened_at → closed_at.
      // For open sessions (closed_at IS NULL) we intentionally omit the upper
      // bound — using COALESCE(closed_at, NOW()) fails because the DB server
      // clock can lag behind the application server, causing completed_at values
      // to appear "in the future" relative to DB NOW().
      // register_id is intentionally omitted — sales in this codebase currently
      // have register_id = null, so filtering by it would exclude every row.
      if (closedAt) {
        return {
          clause:
            `(${prefix}register_session_id = ? ` +
            `OR (${prefix}register_session_id IS NULL AND ${prefix}location_id = ? ` +
            `AND ${prefix}completed_at >= ? AND ${prefix}completed_at <= ?))`,
          params: [registerSessionId, fallback.locationId, openedAt, closedAt],
        };
      }
      return {
        clause:
          `(${prefix}register_session_id = ? ` +
          `OR (${prefix}register_session_id IS NULL AND ${prefix}location_id = ? ` +
          `AND ${prefix}completed_at >= ?))`,
        params: [registerSessionId, fallback.locationId, openedAt],
      };
    }
    // No session row found — fall back to the single-date match (legacy behaviour).
    return {
      clause:
        `(${prefix}register_session_id = ? ` +
        `OR (${prefix}register_session_id IS NULL AND ${prefix}location_id = ? ` +
        `AND DATE(${prefix}completed_at) = ?))`,
      params: [registerSessionId, fallback.locationId, fallback.date],
    };
  },

  /**
   * Expected takings for a single register SESSION (open → close window),
   * keyed by payment method. Correctly handles shifts that cross midnight or
   * registers left open across days. See _sessionMatchClause for the fallback.
   */
  async getExpectedBySession(
    registerSessionId: number,
    fallback?: { locationId: number; date: string; registerId: number | null },
  ): Promise<Record<string, number>> {
    const { clause, params } = await this._sessionMatchClause(registerSessionId, 's.', fallback);
    const rows = await imsQuery<any>(
      `SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total
         FROM pos_payments p
         JOIN pos_sales s ON s.id = p.sale_id
        WHERE s.status IN ('completed','layby_complete')
          AND ${clause}
        GROUP BY p.payment_method`,
      params,
    );
    const result: Record<string, number> = {};
    for (const row of rows) result[row.payment_method] = toNum(row.total);
    return result;
  },

  /** Sales totals (incl/excl tax, count) for a single register session. Accepts same fallback as getExpectedBySession. */
  async getDayTotalsBySession(
    registerSessionId: number,
    fallback?: { locationId: number; date: string; registerId: number | null },
  ): Promise<{ total_inc_tax: number; tax_total: number; total_exc_tax: number; sale_count: number }> {
    const { clause, params } = await this._sessionMatchClause(registerSessionId, '', fallback);
    const rows = await imsQuery<any>(
      `SELECT COALESCE(SUM(total), 0) AS total_inc_tax,
              COALESCE(SUM(tax_total), 0) AS tax_total,
              COALESCE(SUM(total - tax_total), 0) AS total_exc_tax,
              COUNT(*) AS sale_count
         FROM pos_sales
        WHERE status IN ('completed','layby_complete')
          AND ${clause}`,
      params,
    );
    const r = rows[0] ?? {};
    return {
      total_inc_tax: toNum(r.total_inc_tax),
      tax_total:     toNum(r.tax_total),
      total_exc_tax: toNum(r.total_exc_tax),
      sale_count:    Number(r.sale_count) || 0,
    };
  },

  async save(data: {
    location_id:      number;
    register_id:      number | null;
    register_session_id?: number | null;
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
         (location_id, register_id, register_session_id, cashier_id, cashier_name, recon_date, payment_method,
          expected_amount, counted_amount, opening_float, denomination_data, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         xero_invoice_id   = IF(register_session_id <=> VALUES(register_session_id), xero_invoice_id, NULL),
         xero_synced_at    = IF(register_session_id <=> VALUES(register_session_id), xero_synced_at,  NULL),
         register_session_id = VALUES(register_session_id),
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
        data.register_session_id ?? null,
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
  return {
    ...r,
    default_float:           toNum(r.default_float),
    card_terminal_provider:  r.card_terminal_provider  ?? null,
    zeller_site_id:          r.zeller_site_id          ?? null,
    zeller_terminal_id:      r.zeller_terminal_id      ?? null,
    zeller_api_key:          r.zeller_api_key          ?? null,
    card_terminal_methods:   r.card_terminal_methods   ?? null,
  };
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

  async update(id: number, data: {
    name?:                   string;
    default_float?:          number;
    is_active?:              number;
    card_terminal_provider?: string | null;
    zeller_site_id?:         string | null;
    zeller_terminal_id?:     string | null;
    zeller_api_key?:         string | null;
    card_terminal_methods?:  string | null;
  }): Promise<void> {
    const fields: string[] = [];
    const vals:   any[]    = [];
    if (data.name                   !== undefined) { fields.push('name = ?');                   vals.push(data.name.trim()); }
    if (data.default_float          !== undefined) { fields.push('default_float = ?');          vals.push(data.default_float); }
    if (data.is_active              !== undefined) { fields.push('is_active = ?');              vals.push(data.is_active); }
    if (data.card_terminal_provider !== undefined) { fields.push('card_terminal_provider = ?'); vals.push(data.card_terminal_provider); }
    if (data.zeller_site_id         !== undefined) { fields.push('zeller_site_id = ?');         vals.push(data.zeller_site_id); }
    if (data.zeller_terminal_id     !== undefined) { fields.push('zeller_terminal_id = ?');     vals.push(data.zeller_terminal_id); }
    if (data.zeller_api_key         !== undefined) { fields.push('zeller_api_key = ?');         vals.push(data.zeller_api_key); }
    if (data.card_terminal_methods  !== undefined) { fields.push('card_terminal_methods = ?');  vals.push(data.card_terminal_methods); }
    if (!fields.length) return;
    vals.push(id);
    await imsExecute(`UPDATE pos_registers SET ${fields.join(', ')} WHERE id = ?`, vals);
  },

  async listAll(businessId: string): Promise<(PosRegisterRow & { location_name: string })[]> {
    const rows = await imsQuery<any>(
      `SELECT r.*, l.name AS location_name
       FROM pos_registers r
       JOIN ims_locations l ON l.id = r.location_id AND l.business_id = ?
       ORDER BY l.name, r.name`,
      [businessId],
    );
    return rows.map(r => ({ ...parseRegister(r), location_name: r.location_name ?? '' }));
  },
};

// ─── POS Register Session Repository ─────────────────────────────────────────

function parseSession(r: any): PosRegisterSessionRow {
  // Normalize session_date to 'YYYY-MM-DD' string — mysql2 may return DATE
  // columns as JS Date objects which serialize to ISO timestamps in JSON,
  // causing downstream date comparisons and Xero invoice dates to be wrong.
  const rawDate = r.session_date;
  const sessionDate: string | null =
    rawDate instanceof Date    ? rawDate.toISOString().slice(0, 10)
    : typeof rawDate === 'string' ? rawDate.slice(0, 10)
    : rawDate ?? null;
  return {
    ...r,
    session_date: sessionDate,
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

  /** Most recent session for a register regardless of status (used by EOD). */
  async getLatest(registerId: number): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_register_sessions WHERE register_id = ? ORDER BY opened_at DESC LIMIT 1',
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

  /** Get a session by its id (any status, null if not found). */
  async getById(sessionId: number): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_register_sessions WHERE id = ? LIMIT 1',
      [sessionId],
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

  /**
   * Atomically open a register session, guarding against a race where two
   * devices open the same register simultaneously. Locks existing open rows
   * for the register inside a transaction; if one already exists, returns it
   * instead of inserting a duplicate.
   */
  async openAtomic(data: {
    register_id:      number;
    location_id:      number;
    session_date:     string;
    opened_at:        string;
    opened_by:        string | null;
    opening_float:    number | null;
    denomination_data?: Record<string, number> | null;
  }): Promise<{ created: boolean; session_id: number; existing?: PosRegisterSessionRow }> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [openRows]: any = await conn.execute(
        "SELECT * FROM pos_register_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE",
        [data.register_id],
      );
      if (openRows[0]) {
        await conn.commit();
        return { created: false, session_id: openRows[0].id, existing: parseSession(openRows[0]) };
      }
      const [ins]: any = await conn.execute(
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
      await conn.commit();
      return { created: true, session_id: ins.insertId };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
      `SELECT s.*
       FROM pos_sales s
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
