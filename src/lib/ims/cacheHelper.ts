import { imsQuery, getIMSPool } from '@/services/IMSMySQLService';

/**
 * Recalculates and upserts data into `ims_sales_cache`.
 * @param variantIds Array of specific variant IDs to recalculate. If omitted, recalculates for all variants found in sales/stock.
 * @returns The number of variants updated.
 */
export async function refreshVariantCache(variantIds?: string[]): Promise<number> {
  let salesQuery = `
      SELECT
        variant_id,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 7   DAY) THEN qty ELSE 0 END) AS sales_qty_7d,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 90  DAY) THEN qty ELSE 0 END) AS sales_qty_90d,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) THEN qty ELSE 0 END) AS sales_qty_180d,
        SUM(qty) AS sales_qty_12m
       FROM (
         -- IMS wholesale/B2B sales orders
         SELECT soi.variant_id, so.order_date AS sale_date, soi.qty_fulfilled AS qty
         FROM   ims_sales_order_items soi
         JOIN   ims_sales_orders      so  ON so.id = soi.so_id
         WHERE  so.status = 'fulfilled'
           AND  so.order_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)

         UNION ALL

         -- POS retail sales
         SELECT psi.variant_id, DATE(ps.completed_at) AS sale_date, psi.qty AS qty
         FROM   pos_sale_items psi
         JOIN   pos_sales      ps  ON ps.id = psi.sale_id
         WHERE  ps.status    = 'completed'
           AND  ps.sale_type = 'sale'
           AND  ps.completed_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
           AND  psi.variant_id IS NOT NULL
       ) all_sales
  `;
  
  let stockQuery = `
      SELECT
        variant_id,
        SUM(qty_on_hand)                       AS global_soh,
        SUM(qty_on_hand - qty_committed)       AS global_available,
        SUM(qty_incoming)                      AS global_incoming
       FROM ims_stock
  `;

  let salesParams: any[] = [];
  let stockParams: any[] = [];

  if (variantIds && variantIds.length > 0) {
    const placeholders = variantIds.map(() => '?').join(',');
    salesQuery += ` WHERE variant_id IN (${placeholders}) `;
    salesParams.push(...variantIds);
    
    stockQuery += ` WHERE variant_id IN (${placeholders}) `;
    stockParams.push(...variantIds);
  }

  salesQuery += ` GROUP BY variant_id`;
  stockQuery += ` GROUP BY variant_id`;

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
  const targetIds = variantIds && variantIds.length > 0 
    ? new Set(variantIds) 
    : new Set([...salesMap.keys(), ...stockMap.keys()]);

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
