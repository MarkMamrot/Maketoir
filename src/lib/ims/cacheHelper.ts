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
  const salesFilter  = hasFilter ? ` AND variant_id IN (${placeholders})`   : '';
  const stockFilter  = hasFilter ? ` WHERE s.variant_id IN (${placeholders})` : '';
  if (hasFilter) {
    salesParams.push(...variantIds!);
    stockParams.push(...variantIds!);
  }

  // Canonical sales source: POS (pos_sale_items) + Sales Orders (ims_sales_order_items),
  // covering retail, wholesale/B2B and online in one place. `ims_sales_history` is deliberately
  // NOT read here: every Cin7-synced order is also written to pos_sales / ims_sales_orders, so
  // combining the two would double-count. All three item tables key on the IMS variant_id (VARCHAR),
  // but historical lines can have a NULL variant_id when the SKU didn't resolve at sync time — so we
  // fall back to matching on the line's SKU (`code`) to avoid dropping those sales.
  const salesQuery = `
      SELECT
        variant_id,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 7   DAY) THEN qty ELSE 0 END) AS sales_qty_7d,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 90  DAY) THEN qty ELSE 0 END) AS sales_qty_90d,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) THEN qty ELSE 0 END) AS sales_qty_180d,
        SUM(qty) AS sales_qty_12m
       FROM (
         -- Sales Orders: wholesale/B2B + online. Count every order that isn't a draft or cancelled,
         -- using the ordered quantity (the customer's purchase) so confirmed/unfulfilled and
         -- historical orders with qty_fulfilled = 0 are still counted.
         SELECT COALESCE(soi.variant_id, vsku.variant_id) AS variant_id,
                so.order_date AS sale_date,
                soi.qty_ordered AS qty
         FROM   ims_sales_order_items soi
         JOIN   ims_sales_orders      so ON so.id = soi.so_id
         LEFT JOIN ims_product_variants vsku
                ON soi.variant_id IS NULL AND vsku.sku = soi.code
         WHERE  so.status NOT IN ('draft', 'cancelled')
           AND  so.order_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)

         UNION ALL

         -- POS retail sales (live + historical). variant_id is the IMS variant_id; fall back to SKU.
         SELECT COALESCE(psi.variant_id, vsku.variant_id) AS variant_id,
                DATE(ps.completed_at) AS sale_date,
                psi.qty AS qty
         FROM   pos_sale_items psi
         JOIN   pos_sales      ps ON ps.id = psi.sale_id
         LEFT JOIN ims_product_variants vsku
                ON psi.variant_id IS NULL AND vsku.sku = psi.code
         WHERE  ps.status    = 'completed'
           AND  ps.sale_type = 'sale'
           AND  ps.completed_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
       ) all_sales
       WHERE variant_id IS NOT NULL${salesFilter}
       GROUP BY variant_id`;

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
