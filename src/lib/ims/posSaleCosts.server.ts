import 'server-only';

import { imsQuery } from '@/services/IMSMySQLService';
import { resolvePosItemUnitCost } from './posSaleCosts';

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function enrichPosSaleItemsWithCosts<T extends { variant_id?: string | null; unit_cost?: unknown; avg_cost?: unknown }>(items: T[]): Promise<Array<T & { avg_cost: number | null }>> {
  const variantIds = Array.from(new Set(items.map((item) => item.variant_id).filter((value): value is string => Boolean(value))));
  if (variantIds.length === 0) {
    return items.map((item) => ({ ...item, avg_cost: toNullableNumber(item.avg_cost) }));
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

  return items.map((item) => ({
    ...item,
    avg_cost: resolvePosItemUnitCost(item) ?? (item.variant_id ? (costByVariant.get(item.variant_id) ?? null) : null),
  }));
}