import type { PoolConnection } from 'mysql2/promise';
import { getIMSPool } from '@/services/IMSMySQLService';
import { buildDemandReadiness, type DemandReadiness } from './domain';

type Executor = Pick<PoolConnection, 'execute'>;

export type SalesOrderLineReadiness = DemandReadiness & {
  variantId: string;
  locationId: number;
  quantityOnHand: number;
};

export class ProtectedStockConflict extends Error {
  readonly code = 'PROTECTED_STOCK_CONFLICT';
  readonly status = 409;

  constructor(readonly lines: SalesOrderLineReadiness[]) {
    super('This shipment would use stock protected for another Sales Order. Fulfil the protected order or release/reassign its allocation first.');
    this.name = 'ProtectedStockConflict';
  }
}

export class SalesOrderPriorityConflict extends Error {
  readonly code = 'SALES_ORDER_PRIORITY_CONFLICT';
  readonly status = 409;

  constructor(readonly lines: SalesOrderLineReadiness[]) {
    super('This shipment would use stock currently assigned to a higher-priority Sales Order. Review the waiting-order priority before continuing.');
    this.name = 'SalesOrderPriorityConflict';
  }
}

export async function loadSalesOrderReadiness(
  executor: Executor,
  input: { businessId: string; soId: number; lock?: boolean },
): Promise<SalesOrderLineReadiness[]> {
  const lock = input.lock ? ' FOR UPDATE' : '';
  const [[target]] = await executor.execute<any[]>(
    `SELECT location_id, so_type
       FROM ims_sales_orders
      WHERE business_id = ? AND id = ?${lock}`,
    [input.businessId, input.soId],
  );
  if (!target || String(target.so_type) === 'online') return [];

  const [targetLines] = await executor.execute<any[]>(
    `SELECT id, variant_id
       FROM ims_sales_order_items
      WHERE business_id = ? AND so_id = ?
      ORDER BY id${lock}`,
    [input.businessId, input.soId],
  );
  const variantIds = [...new Set(targetLines.map(line => String(line.variant_id ?? '')).filter(Boolean))].sort();
  if (variantIds.length === 0) return [];
  const placeholders = variantIds.map(() => '?').join(',');

  const [demandRows] = await executor.execute<any[]>(
    `SELECT so.id AS so_id, soi.id AS so_item_id, soi.variant_id, so.location_id,
            so.expected_date, so.created_at, soi.qty_ordered, soi.qty_fulfilled
       FROM ims_sales_order_items soi
       JOIN ims_sales_orders so ON so.id = soi.so_id AND so.business_id = soi.business_id
      WHERE soi.business_id = ? AND so.location_id = ?
        AND soi.variant_id IN (${placeholders})
        AND so.status IN ('confirmed','partially_fulfilled','backordered')
        AND COALESCE(so.so_type, '') <> 'online' AND so.is_historical = 0
        AND soi.qty_ordered > soi.qty_fulfilled
      ORDER BY so.id, soi.id${lock}`,
    [input.businessId, Number(target.location_id), ...variantIds],
  );
  if (demandRows.length === 0) return [];
  const demandIds = demandRows.map(row => Number(row.so_item_id));
  const demandPlaceholders = demandIds.map(() => '?').join(',');
  const [allocationRows] = await executor.execute<any[]>(
    `SELECT so_item_id, qty_allocated, qty_received_assigned, qty_fulfilled
       FROM ims_stock_allocations
      WHERE business_id = ? AND state = 'active' AND so_item_id IN (${demandPlaceholders})
      ORDER BY so_item_id, priority, created_at, id${lock}`,
    [input.businessId, ...demandIds],
  );
  const [stockRows] = await executor.execute<any[]>(
    `SELECT variant_id, location_id, qty_on_hand
       FROM ims_stock
      WHERE business_id = ? AND location_id = ? AND variant_id IN (${placeholders})
      ORDER BY variant_id${lock}`,
    [input.businessId, Number(target.location_id), ...variantIds],
  );

  const allocations = new Map<number, { allocated: number; received: number; fulfilled: number }>();
  for (const row of allocationRows) {
    const itemId = Number(row.so_item_id);
    const current = allocations.get(itemId) ?? { allocated: 0, received: 0, fulfilled: 0 };
    current.allocated += Number(row.qty_allocated ?? 0);
    current.received += Number(row.qty_received_assigned ?? 0);
    current.fulfilled += Number(row.qty_fulfilled ?? 0);
    allocations.set(itemId, current);
  }
  const stockByVariant = new Map(stockRows.map(row => [String(row.variant_id), Number(row.qty_on_hand ?? 0)]));
  const readiness = buildDemandReadiness(demandRows.map(row => {
    const allocation = allocations.get(Number(row.so_item_id));
    return {
      soId: Number(row.so_id),
      soItemId: Number(row.so_item_id),
      variantId: String(row.variant_id),
      locationId: Number(row.location_id),
      requiredDate: row.expected_date == null ? null : String(row.expected_date).slice(0, 10),
      createdAt: new Date(row.created_at).toISOString(),
      outstandingQuantity: Number(row.qty_ordered ?? 0) - Number(row.qty_fulfilled ?? 0),
      activeAllocatedQuantity: allocation?.allocated ?? 0,
      receivedAssignedQuantity: allocation?.received ?? 0,
      allocationFulfilledQuantity: allocation?.fulfilled ?? 0,
    };
  }), stockRows.map(row => ({
    variantId: String(row.variant_id),
    locationId: Number(row.location_id),
    quantityOnHand: Number(row.qty_on_hand ?? 0),
  })));

  const demandById = new Map(demandRows.map(row => [Number(row.so_item_id), row]));
  return readiness
    .filter(row => row.soId === input.soId)
    .map(row => {
      const demand = demandById.get(row.soItemId)!;
      return {
        ...row,
        variantId: String(demand.variant_id),
        locationId: Number(demand.location_id),
        quantityOnHand: stockByVariant.get(String(demand.variant_id)) ?? 0,
      };
    });
}

export async function getSalesOrderReadiness(input: { businessId: string; soId: number }): Promise<SalesOrderLineReadiness[]> {
  return loadSalesOrderReadiness(getIMSPool(), input);
}