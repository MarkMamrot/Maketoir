import { imsQuery, getIMSPool } from '@/services/IMSMySQLService';

/**
 * Recalculates and upserts data into `ims_sales_cache`.
 * @param variantIds Array of specific variant IDs to recalculate. If omitted, recalculates for all variants found in sales/stock.
 * @returns The number of variants updated.
 */
export async function refreshVariantCache(variantIds?: string[]): Promise<number> {
  const salesParams: any[] = [];
  const stockParams: any[] = [];
  const hasFilter    = !!(variantIds && variantIds.length > 0);
  const placeholders = hasFilter ? variantIds!.map(() => '?').join(',') : '';
  const salesFilter  = hasFilter ? ` AND s.variant_id IN (${placeholders})`  : '';
  const stockFilter  = hasFilter ? ` WHERE s.variant_id IN (${placeholders})` : '';
  if (hasFilter) {
    salesParams.push(...variantIds!);
    stockParams.push(...variantIds!);
  }

  // Canonical sales source, non-overlapping and complete:
  //   1. ims_sales_history — the full Cin7-synced record across ALL channels (POS, online, B2B).
  //      This is the authoritative history: Cin7 POS register sales are ONLY here (they are not
  //      reliably mirrored into pos_sale_items), so it must be read.
  //   2. Live POS created in-app (pos_sales.is_historical = 0) — not present in ims_sales_history.
  //   3. Live / in-app Sales Orders (ims_sales_orders.cin7_order_id IS NULL) — live Shopify
  //      webhooks and manual SOs, also not present in ims_sales_history.
  // Cin7-synced POS/SO rows carry is_historical = 1 / a cin7_order_id, so they are excluded from
  // (2) and (3) and counted once via history — no double counting.
  // variant_id is resolved via the row's own id, then SKU, then cin7_option_id. A final JOIN to
  // ims_product_variants guarantees only live variant_ids are cached (satisfies the FK).
  const salesQuery = `
      SELECT
        s.variant_id,
        SUM(CASE WHEN s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 7   DAY) THEN s.qty ELSE 0 END) AS sales_qty_7d,
        SUM(CASE WHEN s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 90  DAY) THEN s.qty ELSE 0 END) AS sales_qty_90d,
        SUM(CASE WHEN s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) THEN s.qty ELSE 0 END) AS sales_qty_180d,
        SUM(s.qty) AS sales_qty_12m
       FROM (
         -- 1. Complete Cin7 history (all channels). Resolve variant by id → SKU → cin7_option_id.
         SELECT COALESCE(h.variant_id, hsku.variant_id, hopt.variant_id) AS variant_id,
                h.invoice_date AS sale_date,
                h.qty AS qty
         FROM   ims_sales_history h
         LEFT JOIN ims_product_variants hsku
                ON h.variant_id IS NULL AND hsku.sku = h.sku
         LEFT JOIN ims_product_variants hopt
                ON h.variant_id IS NULL AND hsku.variant_id IS NULL AND hopt.cin7_option_id = h.cin7_option_id
         WHERE  h.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)

         UNION ALL

         -- 2. Live POS sales created in-app (not mirrored from Cin7).
         SELECT COALESCE(psi.variant_id, psku.variant_id) AS variant_id,
                DATE(ps.completed_at) AS sale_date,
                psi.qty AS qty
         FROM   pos_sale_items psi
         JOIN   pos_sales      ps ON ps.id = psi.sale_id
         LEFT JOIN ims_product_variants psku
                ON psi.variant_id IS NULL AND psku.sku = psi.code
         WHERE  ps.status    = 'completed'
           AND  ps.sale_type = 'sale'
           AND  ps.is_historical = 0
           AND  ps.completed_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)

         UNION ALL

         -- 3. Live / in-app Sales Orders (Shopify webhooks, manual SOs). Ordered qty = the sale.
         SELECT COALESCE(soi.variant_id, ssku.variant_id) AS variant_id,
                so.order_date AS sale_date,
                soi.qty_ordered AS qty
         FROM   ims_sales_order_items soi
         JOIN   ims_sales_orders      so ON so.id = soi.so_id
         LEFT JOIN ims_product_variants ssku
                ON soi.variant_id IS NULL AND ssku.sku = soi.code
         WHERE  so.status NOT IN ('draft', 'cancelled')
           AND  so.cin7_order_id IS NULL
           AND  so.order_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
       ) s
       JOIN ims_product_variants pv ON pv.variant_id = s.variant_id
       WHERE s.variant_id IS NOT NULL${salesFilter}
       GROUP BY s.variant_id`;

  const stockQuery = `
      SELECT
        s.variant_id,
        SUM(s.qty_on_hand)                   AS global_soh,
        SUM(s.qty_on_hand - s.qty_committed) AS global_available,
        SUM(s.qty_incoming)                  AS global_incoming
       FROM ims_stock s
       JOIN ims_product_variants vpv ON vpv.variant_id = s.variant_id${stockFilter}
       GROUP BY s.variant_id`;

  const salesRows = await imsQuery<{
    variant_id: string;
    sales_qty_7d: number;
    sales_qty_90d: number;
    sales_qty_180d: number;
    sales_qty_12m: number;
  }>(salesQuery, salesParams);

  const stockRows = await imsQuery<{
    variant_id: string;
    global_soh: number;
    global_available: number;
    global_incoming: number;
  }>(stockQuery, stockParams);

  const salesMap  = new Map(salesRows.map(r => [r.variant_id, r]));
  const stockMap  = new Map(stockRows.map(r => [r.variant_id, r]));
  
  // If variantIds is provided, we use it as the base set so we don't accidentally skip a variant that dropped to 0 sales and 0 stock.
  // Actually, if it dropped to 0 sales and 0 stock, we should zero it out.
  const rawTargetIds = variantIds && variantIds.length > 0
    ? new Set(variantIds)
    : new Set([...salesMap.keys(), ...stockMap.keys()]);
  // Guard: never insert a null variant_id — that violates the PK constraint
  const targetIds = new Set([...rawTargetIds].filter(id => id != null && id !== ''));

  if (targetIds.size === 0) {
    return 0;
  }

  const CHUNK = 1000;
  const rows = [...targetIds];
  const pool = getIMSPool();

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const vid of chunk) {
      const s  = salesMap.get(vid);
      const st = stockMap.get(vid);
      values.push(
        vid,
        s?.sales_qty_7d   ?? 0,
        s?.sales_qty_90d  ?? 0,
        s?.sales_qty_180d ?? 0,
        s?.sales_qty_12m  ?? 0,
        st?.global_soh       ?? 0,
        st?.global_available ?? 0,
        st?.global_incoming  ?? 0,
      );
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
    }

    await pool.query(
      `INSERT INTO ims_sales_cache
          (variant_id, sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m,
          global_soh, global_available, global_incoming)
        VALUES ${placeholders.join(', ')}
        ON DUPLICATE KEY UPDATE
          sales_qty_7d     = VALUES(sales_qty_7d),
          sales_qty_90d    = VALUES(sales_qty_90d),
          sales_qty_180d   = VALUES(sales_qty_180d),
          sales_qty_12m    = VALUES(sales_qty_12m),
          global_soh       = VALUES(global_soh),
          global_available = VALUES(global_available),
          global_incoming  = VALUES(global_incoming),
          updated_at       = NOW()`,
      values,
    );
  }

  return targetIds.size;
}
