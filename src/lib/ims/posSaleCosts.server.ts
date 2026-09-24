import 'server-only';

import { imsQuery } from '@/services/IMSMySQLService';
import { resolvePosItemUnitCost } from './posSaleCosts';

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function enrichPosSaleItemsWithCosts<T extends { sale_id?: number | string | null; variant_id?: string | null; unit_cost?: unknown; avg_cost?: unknown }>(items: T[]): Promise<Array<T & { avg_cost: number | null; cost_source: 'movement' | 'catalogue_fallback' | null }>> {
  const variantIds = Array.from(new Set(items.map((item) => item.variant_id).filter((value): value is string => Boolean(value))));
  if (variantIds.length === 0) {
    return items.map((item) => ({ ...item, avg_cost: toNullableNumber(item.avg_cost), cost_source: null }));
  }

  const placeholders = variantIds.map(() => '?').join(',');
  const rows = await imsQuery<any>(
    `SELECT variant_id, avg_cost, cost_aud
       FROM ims_product_variants
      WHERE variant_id IN (${placeholders})`,
    variantIds,
  );

  const costByVariant = new Map<string, number | null>();
  for (const row of rows) {
    const resolved = toNullableNumber(row.avg_cost) ?? toNullableNumber(row.cost_aud);
    costByVariant.set(String(row.variant_id), resolved);
  }

  const saleIds = Array.from(new Set(items.map((item) => Number(item.sale_id)).filter((value) => Number.isInteger(value) && value > 0)));
  const movementCostBySaleVariant = new Map<string, number | null>();
  if (saleIds.length > 0) {
    const movementRows = await imsQuery<any>(
      `SELECT reference_id AS sale_id, variant_id,
              CASE WHEN SUM(unit_cost IS NULL) > 0 THEN NULL
                   ELSE SUM(ABS(qty_change) * unit_cost) / NULLIF(SUM(ABS(qty_change)), 0) END AS unit_cost
         FROM ims_stock_movements
        WHERE movement_type = 'pos_sale' AND reference_type = 'pos_sale'
          AND reference_id IN (${saleIds.map(() => '?').join(',')})
        GROUP BY reference_id, variant_id`,
      saleIds,
    );
    for (const row of movementRows) {
      movementCostBySaleVariant.set(`${row.sale_id}:${row.variant_id}`, toNullableNumber(row.unit_cost));
    }
  }

  return items.map((item) => {
    const movementKey = item.sale_id && item.variant_id ? `${item.sale_id}:${item.variant_id}` : null;
    if (movementKey && movementCostBySaleVariant.has(movementKey)) {
      const movementCost = movementCostBySaleVariant.get(movementKey) ?? null;
      return { ...item, unit_cost: movementCost, avg_cost: movementCost, cost_source: 'movement' as const };
    }
    const fallbackCost = resolvePosItemUnitCost(item) ?? (item.variant_id ? (costByVariant.get(item.variant_id) ?? null) : null);
    return { ...item, avg_cost: fallbackCost, cost_source: fallbackCost == null ? null : 'catalogue_fallback' as const };
  });
}