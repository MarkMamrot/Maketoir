import { imsQuery } from '@/services/IMSMySQLService';
import { roundCurrency } from './cogsPeriods';

export type CogsSourceStatus = 'eligible' | 'historical_import' | 'orphaned' | 'non_stock';
export type CogsCostStatus = 'ok' | 'missing' | 'zero';

export interface CogsCalculationRow {
  location_id: number;
  channel: string;
  source_status: CogsSourceStatus;
  cost_status: CogsCostStatus;
  movement_count: number | string;
  quantity: number | string;
  cogs: number | string;
}

export interface CogsBreakdown {
  locationId: number;
  channel: string;
  totalCOGS: number;
  movementCount: number;
  quantity: number;
}

export interface CogsCalculation {
  startDate: string;
  endDateExclusive: string;
  totalCOGS: number;
  includedMovementCount: number;
  includedQuantity: number;
  missingCostMovementCount: number;
  missingCostQuantity: number;
  zeroCostMovementCount: number;
  zeroCostQuantity: number;
  excludedHistoricalMovementCount: number;
  excludedHistoricalQuantity: number;
  orphanedMovementCount: number;
  orphanedQuantity: number;
  excludedNonStockMovementCount: number;
  excludedNonStockQuantity: number;
  blocked: boolean;
  breakdown: CogsBreakdown[];
}

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function validateCogsDateRange(startDate: string, endDateExclusive: string): void {
  if (!DATE_FORMAT.test(startDate) || !DATE_FORMAT.test(endDateExclusive)) {
    throw new Error('COGS dates must use YYYY-MM-DD format.');
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDateExclusive}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new Error('COGS period end must be after its start.');
  }
}

export function summariseCogsRows(
  rows: CogsCalculationRow[],
  startDate: string,
  endDateExclusive: string,
): CogsCalculation {
  const breakdownByLocationChannel = new Map<string, CogsBreakdown>();
  const result: CogsCalculation = {
    startDate,
    endDateExclusive,
    totalCOGS: 0,
    includedMovementCount: 0,
    includedQuantity: 0,
    missingCostMovementCount: 0,
    missingCostQuantity: 0,
    zeroCostMovementCount: 0,
    zeroCostQuantity: 0,
    excludedHistoricalMovementCount: 0,
    excludedHistoricalQuantity: 0,
    orphanedMovementCount: 0,
    orphanedQuantity: 0,
    excludedNonStockMovementCount: 0,
    excludedNonStockQuantity: 0,
    blocked: false,
    breakdown: [],
  };

  for (const row of rows) {
    const movementCount = Number(row.movement_count) || 0;
    const quantity = Number(row.quantity) || 0;
    const cogs = Number(row.cogs) || 0;

    if (row.source_status === 'historical_import') {
      result.excludedHistoricalMovementCount += movementCount;
      result.excludedHistoricalQuantity += quantity;
      continue;
    }
    if (row.source_status === 'orphaned') {
      result.orphanedMovementCount += movementCount;
      result.orphanedQuantity += quantity;
      continue;
    }
    if (row.source_status === 'non_stock') {
      result.excludedNonStockMovementCount += movementCount;
      result.excludedNonStockQuantity += quantity;
      continue;
    }

    result.includedMovementCount += movementCount;
    result.includedQuantity += quantity;
    if (row.cost_status === 'missing') {
      result.missingCostMovementCount += movementCount;
      result.missingCostQuantity += quantity;
    } else if (row.cost_status === 'zero') {
      result.zeroCostMovementCount += movementCount;
      result.zeroCostQuantity += quantity;
    }

    result.totalCOGS += cogs;
    const locationId = Number(row.location_id);
    const breakdownKey = `${locationId}:${row.channel}`;
    const breakdown = breakdownByLocationChannel.get(breakdownKey) ?? {
      locationId,
      channel: row.channel,
      totalCOGS: 0,
      movementCount: 0,
      quantity: 0,
    };
    breakdown.totalCOGS += cogs;
    breakdown.movementCount += movementCount;
    breakdown.quantity += quantity;
    breakdownByLocationChannel.set(breakdownKey, breakdown);
  }

  result.totalCOGS = roundCurrency(result.totalCOGS);
  result.breakdown = Array.from(breakdownByLocationChannel.values());
  result.blocked = result.missingCostMovementCount > 0 || result.zeroCostMovementCount > 0;
  return result;
}

export async function calculateCogsForPeriod(input: {
  businessId: string;
  startDate: string;
  endDateExclusive: string;
}): Promise<CogsCalculation> {
  validateCogsDateRange(input.startDate, input.endDateExclusive);

  const rows = await imsQuery<CogsCalculationRow>(
    `SELECT classified.location_id,
            classified.channel,
            classified.source_status,
            classified.cost_status,
            COUNT(*) AS movement_count,
            SUM(ABS(classified.qty_change)) AS quantity,
            SUM(CASE
                  WHEN classified.unit_cost IS NULL OR classified.unit_cost <= 0 THEN 0
                  ELSE -classified.qty_change * classified.unit_cost
                END) AS cogs
       FROM (
         SELECT sm.location_id,
                sm.qty_change,
                sm.unit_cost,
            CASE
              WHEN sm.movement_type = 'pos_sale' THEN 'pos'
              WHEN so.so_type = 'online' THEN 'online'
              ELSE 'wholesale'
            END AS channel,
            CASE
              WHEN sm.movement_type = 'pos_sale' AND ps.id IS NULL THEN 'orphaned'
              WHEN sm.movement_type = 'so_fulfilled' AND so.id IS NULL THEN 'orphaned'
              WHEN sm.movement_type = 'pos_sale' AND COALESCE(ps.is_historical, 0) <> 0 THEN 'historical_import'
              WHEN sm.movement_type = 'so_fulfilled'
                   AND (COALESCE(so.is_historical, 0) <> 0 OR so.cin7_order_id IS NOT NULL)
                THEN 'historical_import'
              WHEN COALESCE(p.is_stock_item, 1) = 0 THEN 'non_stock'
              ELSE 'eligible'
            END AS source_status,
            CASE
              WHEN sm.unit_cost IS NULL THEN 'missing'
              WHEN sm.unit_cost <= 0 THEN 'zero'
              ELSE 'ok'
            END AS cost_status
           FROM ims_stock_movements sm
           LEFT JOIN pos_sales ps
             ON sm.movement_type = 'pos_sale'
            AND sm.reference_type = 'pos_sale'
            AND ps.id = sm.reference_id
           LEFT JOIN ims_sales_orders so
             ON sm.movement_type = 'so_fulfilled'
            AND sm.reference_type = 'sales_order'
            AND so.id = sm.reference_id
           LEFT JOIN ims_product_variants pv ON pv.variant_id = sm.variant_id
           LEFT JOIN ims_products p ON p.product_id = pv.product_id
          WHERE sm.movement_type IN ('pos_sale', 'so_fulfilled')
            AND sm.created_at >= ?
            AND sm.created_at < ?
       ) classified
      GROUP BY classified.location_id, classified.channel,
               classified.source_status, classified.cost_status
      ORDER BY classified.location_id, classified.channel,
               classified.source_status, classified.cost_status`,
    [input.startDate, input.endDateExclusive],
  );

  return summariseCogsRows(rows, input.startDate, input.endDateExclusive);
}