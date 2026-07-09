import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIMSPool } from '@/services/IMSMySQLService';

// ── Sales Search (IMS report) ─────────────────────────────────────────────────
//
// Lists actual sales for any period, aggregated per product/variant, computed from the
// canonical sales sources (complete Cin7 history + live in-app POS + live in-app Sales Orders)
// — the same non-overlapping set the sales cache uses, so POS, online and wholesale are all
// included. Supports free-text word search across product name / SKU (partial, not exact).

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Canonical per-line sales source, resolving variant_id via id → SKU → cin7_option_id.
// Each `?` placeholder is a (from, to) date bound — 6 params total.
const SALES_CTE = `
  SELECT s.variant_id, s.sale_date, s.qty, s.revenue, s.channel FROM (
    -- 1. Complete Cin7 history (all channels)
    SELECT COALESCE(h.variant_id, hsku.variant_id, hopt.variant_id) AS variant_id,
           h.invoice_date AS sale_date, h.qty AS qty, h.line_total AS revenue, 'history' AS channel
    FROM   ims_sales_history h
    LEFT JOIN ims_product_variants hsku ON h.variant_id IS NULL AND hsku.sku = h.sku
    LEFT JOIN ims_product_variants hopt ON h.variant_id IS NULL AND hsku.variant_id IS NULL AND hopt.cin7_option_id = h.cin7_option_id
    WHERE  h.invoice_date BETWEEN ? AND ?

    UNION ALL

    -- 2. Live in-app POS sales
    SELECT COALESCE(psi.variant_id, psku.variant_id) AS variant_id,
           DATE(ps.completed_at) AS sale_date, psi.qty AS qty, psi.line_total AS revenue, 'pos' AS channel
    FROM   pos_sale_items psi
    JOIN   pos_sales ps ON ps.id = psi.sale_id
    LEFT JOIN ims_product_variants psku ON psi.variant_id IS NULL AND psku.sku = psi.code
    WHERE  ps.status = 'completed' AND ps.sale_type = 'sale' AND ps.is_historical = 0
      AND  DATE(ps.completed_at) BETWEEN ? AND ?

    UNION ALL

    -- 3. Live in-app Sales Orders (Shopify webhooks / manual)
    SELECT COALESCE(soi.variant_id, ssku.variant_id) AS variant_id,
           so.order_date AS sale_date, soi.qty_ordered AS qty, soi.line_total AS revenue,
           CASE WHEN so.so_type = 'online' THEN 'online' ELSE 'wholesale' END AS channel
    FROM   ims_sales_order_items soi
    JOIN   ims_sales_orders so ON so.id = soi.so_id
    LEFT JOIN ims_product_variants ssku ON soi.variant_id IS NULL AND ssku.sku = soi.code
    WHERE  so.status NOT IN ('draft', 'cancelled') AND so.cin7_order_id IS NULL
      AND  so.order_date BETWEEN ? AND ?
  ) s`;

export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q           = (searchParams.get('q') ?? '').trim();
  const brand       = searchParams.get('brand')       ?? '';
  const supplierId  = searchParams.get('supplierId')  ?? '';
  const productType = searchParams.get('productType') ?? '';
  const productId   = searchParams.get('productId')   ?? '';
  const days        = Math.min(3650, Math.max(1, parseInt(searchParams.get('days') ?? '90')));
  const fromParam   = searchParams.get('from') ?? '';
  const toParam     = searchParams.get('to')   ?? '';
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const pageSize    = Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize') ?? '50')));
  const offset      = (page - 1) * pageSize;

  // Resolve the date window: explicit from/to override the preset day count.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const toDate   = dateRe.test(toParam) ? toParam : isoDate(new Date());
  const fromDate = dateRe.test(fromParam)
    ? fromParam
    : isoDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  try {
    const pool = getIMSPool();

    // Date params repeat once per UNION branch (3×).
    const dateParams = [fromDate, toDate, fromDate, toDate, fromDate, toDate];

    // Product filter clause (applied after joining products/variants).
    const conds: string[] = [];
    const filterParams: any[] = [];
    if (productId)   { conds.push('pv.variant_id = ?');          filterParams.push(productId); }
    if (brand)       { conds.push('p.brand = ?');                filterParams.push(brand); }
    if (supplierId)  { conds.push('p.supplier_contact_id = ?');  filterParams.push(Number(supplierId)); }
    if (productType) { conds.push('p.product_type = ?');         filterParams.push(productType); }
    // Free-text: every whitespace-separated word must match the product name or SKU (partial).
    for (const word of q.split(/\s+/).filter(Boolean)) {
      conds.push('(p.name LIKE ? OR pv.sku LIKE ?)');
      filterParams.push(`%${word}%`, `%${word}%`);
    }
    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const groupedSelect = `
      SELECT
        pv.variant_id, pv.sku,
        p.name AS product_name, p.brand,
        TRIM(BOTH ' / ' FROM CONCAT_WS(' / ',
          NULLIF(TRIM(COALESCE(pv.option1_value,'')), ''),
          NULLIF(TRIM(COALESCE(pv.option2_value,'')), ''),
          NULLIF(TRIM(COALESCE(pv.option3_value,'')), '')
        )) AS option_label,
        con.name AS supplier_name,
        SUM(s.qty) AS qty,
        SUM(s.revenue) AS revenue,
        SUM(CASE WHEN s.channel = 'pos'       THEN s.qty ELSE 0 END) AS pos_qty,
        SUM(CASE WHEN s.channel = 'online'    THEN s.qty ELSE 0 END) AS online_qty,
        SUM(CASE WHEN s.channel = 'wholesale' THEN s.qty ELSE 0 END) AS wholesale_qty,
        SUM(CASE WHEN s.channel = 'history'   THEN s.qty ELSE 0 END) AS history_qty
      FROM ${SALES_CTE}
      JOIN ims_product_variants pv ON pv.variant_id = s.variant_id
      JOIN ims_products p ON p.product_id = pv.product_id
      LEFT JOIN ims_contacts con ON con.id = p.supplier_contact_id
      ${whereClause}
      GROUP BY pv.variant_id`;

    // 1. Page of rows (highest quantity first).
    const [rows] = await pool.query<any>(
      `${groupedSelect}
       ORDER BY qty DESC, revenue DESC, product_name
       LIMIT ? OFFSET ?`,
      [...dateParams, ...filterParams, pageSize, offset],
    ) as any;

    // 2. Totals + count across the whole matched set.
    const [[summary]] = await pool.query<any>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(g.qty), 0)     AS totalQty,
              COALESCE(SUM(g.revenue), 0) AS totalRevenue
       FROM (${groupedSelect}) g`,
      [...dateParams, ...filterParams],
    ) as any;

    return NextResponse.json({
      success: true,
      from: fromDate,
      to: toDate,
      total: Number(summary?.total ?? 0),
      totalQty: Number(summary?.totalQty ?? 0),
      totalRevenue: Number(summary?.totalRevenue ?? 0),
      rows: rows.map((r: any) => ({
        variant_id:    r.variant_id,
        sku:           r.sku,
        product_name:  r.product_name,
        option_label:  r.option_label,
        brand:         r.brand,
        supplier_name: r.supplier_name,
        qty:           Number(r.qty ?? 0),
        revenue:       Number(r.revenue ?? 0),
        pos_qty:       Number(r.pos_qty ?? 0),
        online_qty:    Number(r.online_qty ?? 0),
        wholesale_qty: Number(r.wholesale_qty ?? 0),
        history_qty:   Number(r.history_qty ?? 0),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message ?? 'Failed to load report' }, { status: 500 });
  }
}
