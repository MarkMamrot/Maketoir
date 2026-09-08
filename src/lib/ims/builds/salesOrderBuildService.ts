import type { PoolConnection } from 'mysql2/promise';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';
import { refreshVariantCache } from '../cacheHelper';
import {
  fulfilSalesOrderPartialInTransaction,
  type CustomerFulfilmentResult,
} from '../orderResolution/customerFulfilment';
import { isBuildFromSaleEnabled, planBuildFromSaleShortfalls } from './buildFromSalePolicy';
import { completeProductBuildInTransaction, ProductBuildConflictError } from './buildService';
import { recomputeBuildRequirementsSafely } from './buildRequirementService';

type ConsentedBuild = { outputVariantId: string; recipeRevision: number };

async function refreshSalesOrderBuildCache(
  businessId: string,
  soId: number,
  operation: 'build_and_confirm' | 'build_and_fulfil',
  variantIds: string[],
) {
  try {
    await refreshVariantCache(variantIds);
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_sales_orders',
      operation: `${operation}_cache_refresh`,
      title: 'Sales order build stock cache refresh failed',
      error,
      context: { soId, variantIds },
      reference: { type: 'sales_order', id: soId },
    }).catch(() => {});
  }
}

async function assertPolicy(connection: PoolConnection, businessId: string, locationId: number) {
  const locationKey = `build_from_sale_location:${locationId}`;
  const [rows] = await connection.execute<any[]>(
    'SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?)',
    [businessId, 'build_from_sale_enabled', locationKey],
  );
  const settings = new Map(rows.map(row => [String(row.key), String(row.value ?? '')]));
  if (!isBuildFromSaleEnabled(settings.get('build_from_sale_enabled'), settings.get(locationKey))) {
    throw new ProductBuildConflictError('Build from sale is not enabled at this location.', 'sales_order_build_policy_disabled');
  }
}

function matchConsent(
  planned: Array<{ outputVariantId: string; shortfall: number; sourceLineIds: string[] }>,
  consented: ConsentedBuild[],
) {
  const consentByVariant = new Map(consented.map(item => [String(item.outputVariantId), item]));
  if (consentByVariant.size !== consented.length || planned.length !== consented.length) {
    throw new ProductBuildConflictError('The build preview is stale. Refresh and try again.', 'sales_order_build_preview_stale');
  }
  return planned.map(item => {
    const consent = consentByVariant.get(item.outputVariantId);
    if (!consent || !Number.isInteger(Number(consent.recipeRevision)) || Number(consent.recipeRevision) <= 0) {
      throw new ProductBuildConflictError('The build preview is stale. Refresh and try again.', 'sales_order_build_preview_stale');
    }
    return {
      outputVariantId: item.outputVariantId,
      quantity: item.shortfall,
      recipeRevision: Number(consent.recipeRevision),
      sourceLineId: item.sourceLineIds.join(',').slice(0, 100) || null,
    };
  });
}

async function loadOrderForBuild(connection: PoolConnection, businessId: string, soId: number) {
  const [[order]] = await connection.execute<any[]>(
    `SELECT id, business_id, status, so_type, sales_channel, location_id, is_historical
       FROM ims_sales_orders WHERE id = ? AND business_id = ? FOR UPDATE`,
    [soId, businessId],
  );
  if (!order) throw new ProductBuildConflictError('Sales order not found.', 'sales_order_not_found');
  if (order.is_historical) throw new ProductBuildConflictError('Historical sales orders cannot build stock.', 'sales_order_historical');
  const [items] = await connection.execute<any[]>(
    `SELECT soi.id, soi.variant_id, soi.qty_ordered, soi.qty_fulfilled,
            COALESCE(product.is_stock_item, 1) AS is_stock_item
       FROM ims_sales_order_items soi
       LEFT JOIN ims_product_variants variant ON variant.variant_id = soi.variant_id
       LEFT JOIN ims_products product ON product.product_id = variant.product_id
      WHERE soi.business_id = ? AND soi.so_id = ? ORDER BY soi.id FOR UPDATE`,
    [businessId, soId],
  );
  return { order, items };
}

async function loadOutputStock(
  connection: PoolConnection,
  businessId: string,
  locationId: number,
  variantIds: string[],
) {
  const ids = [...new Set(variantIds)].sort();
  if (!ids.length) return new Map<string, { onHand: number; committed: number }>();
  const [rows] = await connection.execute<any[]>(
    `SELECT variant_id, qty_on_hand, qty_committed FROM ims_stock
      WHERE business_id = ? AND location_id = ? AND variant_id IN (${ids.map(() => '?').join(',')})
      ORDER BY variant_id FOR UPDATE`,
    [businessId, locationId, ...ids],
  );
  return new Map(rows.map(row => [String(row.variant_id), {
    onHand: Number(row.qty_on_hand), committed: Number(row.qty_committed),
  }]));
}

export async function buildAndConfirmSalesOrder(input: {
  businessId: string; soId: number; operationKey: string; builds: ConsentedBuild[];
  actorId?: number | null; actorName?: string | null;
}) {
  if (!input.operationKey.trim() || input.operationKey.length > 180) {
    throw new ProductBuildConflictError('A valid operation key is required.', 'sales_order_build_operation_key_invalid');
  }
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const { order, items } = await loadOrderForBuild(connection, input.businessId, input.soId);
    const [existingBuilds] = await connection.execute<any[]>(
      'SELECT id, build_number FROM ims_product_build_batches WHERE business_id = ? AND operation_key = ? LIMIT 1 FOR UPDATE',
      [input.businessId, `${input.operationKey}:build`],
    );
    if (order.status === 'confirmed' && existingBuilds[0]) {
      await connection.commit();
      return { soId: input.soId, status: 'confirmed' as const, batchId: Number(existingBuilds[0].id), buildNumber: String(existingBuilds[0].build_number), replayed: true };
    }
    if (order.status !== 'draft') throw new ProductBuildConflictError('Only draft sales orders can use Build & Confirm.', 'sales_order_not_draft');
    await assertPolicy(connection, input.businessId, Number(order.location_id));
    const stockItems = items.filter(item => Number(item.is_stock_item) !== 0 && item.variant_id);
    const stock = await loadOutputStock(connection, input.businessId, Number(order.location_id), stockItems.map(item => String(item.variant_id)));
    const planned = planBuildFromSaleShortfalls(
      stockItems.map(item => ({ variantId: String(item.variant_id), quantity: Number(item.qty_ordered), sourceLineId: String(item.id) })),
      new Map([...stock].map(([id, value]) => [id, Math.max(0, value.onHand - value.committed)])),
    );
    const builds = matchConsent(planned, input.builds);
    const buildResult = await completeProductBuildInTransaction(connection, {
      businessId: input.businessId,
      locationId: Number(order.location_id),
      operationKey: `${input.operationKey}:build`,
      builds,
      sourceType: 'sales_order',
      sourceId: String(input.soId),
      sourceChannel: String(order.sales_channel ?? (order.so_type === 'online' ? 'online' : 'wholesale')),
      actorId: input.actorId,
      actorName: input.actorName,
    });
    for (const item of stockItems) {
      await connection.execute(
        `INSERT INTO ims_stock (variant_id, location_id, business_id, qty_committed)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
        [item.variant_id, order.location_id, input.businessId, item.qty_ordered],
      );
      const [[stockAfter]] = await connection.execute<any[]>(
        'SELECT qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ?',
        [item.variant_id, order.location_id],
      );
      await connection.execute(
        `INSERT INTO ims_stock_movements
           (business_id, variant_id, location_id, movement_type, channel, reference_type, reference_id, qty_change, qty_after_soh)
         VALUES (?, ?, ?, 'so_confirmed', ?, 'sales_order', ?, ?, ?)`,
        [input.businessId, item.variant_id, order.location_id,
          order.so_type === 'online' ? 'online' : 'wholesale', input.soId, item.qty_ordered, Number(stockAfter?.qty_on_hand ?? 0)],
      );
    }
    await connection.execute(
      "UPDATE ims_sales_orders SET status = 'confirmed' WHERE id = ? AND business_id = ?",
      [input.soId, input.businessId],
    );
    await connection.commit();
    await refreshSalesOrderBuildCache(
      input.businessId,
      input.soId,
      'build_and_confirm',
      [...new Set([...buildResult.touchedVariantIds, ...stockItems.map(item => String(item.variant_id))])],
    );
    await recomputeBuildRequirementsSafely({ businessId: input.businessId, salesOrderId: input.soId });
    return { soId: input.soId, status: 'confirmed' as const, ...buildResult };
  } catch (error) {
    await connection.rollback();
    if (!(error instanceof ProductBuildConflictError)) {
      await reportRuntimeIssue({
        businessId: input.businessId, source: 'ims_sales_orders', operation: 'build_and_confirm',
        title: 'Build & Confirm failed', error, context: { soId: input.soId, operationKey: input.operationKey },
        reference: { type: 'sales_order', id: input.soId },
      }).catch(() => {});
    }
    throw error;
  } finally { connection.release(); }
}

export async function buildAndFulfilSalesOrder(input: {
  businessId: string; soId: number; operationKey: string;
  shipmentQuantities: Array<{ itemId: number; quantity: number }>;
  builds: ConsentedBuild[]; actorId?: number | null; actorName?: string | null;
}): Promise<{ build: Awaited<ReturnType<typeof completeProductBuildInTransaction>>; fulfilment: CustomerFulfilmentResult }> {
  if (!input.operationKey.trim() || input.operationKey.length > 180) {
    throw new ProductBuildConflictError('A valid operation key is required.', 'sales_order_build_operation_key_invalid');
  }
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [completedOperations] = await connection.execute<any[]>(
      `SELECT response_json FROM ims_so_fulfilment_operations
        WHERE business_id = ? AND operation_key = ? AND status = 'complete' LIMIT 1 FOR UPDATE`,
      [input.businessId, `${input.operationKey}:fulfil`],
    );
    if (completedOperations[0]?.response_json) {
      const [buildRows] = await connection.execute<any[]>(
        'SELECT id, build_number FROM ims_product_build_batches WHERE business_id = ? AND operation_key = ? LIMIT 1',
        [input.businessId, `${input.operationKey}:build`],
      );
      const fulfilment = typeof completedOperations[0].response_json === 'string'
        ? JSON.parse(completedOperations[0].response_json) : completedOperations[0].response_json;
      await connection.commit();
      return { build: { batchId: Number(buildRows[0]?.id), buildNumber: String(buildRows[0]?.build_number), itemIds: [], touchedVariantIds: [], replayed: true, shopifyQueued: true }, fulfilment };
    }
    const { order, items } = await loadOrderForBuild(connection, input.businessId, input.soId);
    if (!['confirmed', 'partially_fulfilled'].includes(String(order.status))) {
      throw new ProductBuildConflictError('Only confirmed sales orders can use Build & Fulfil.', 'sales_order_not_confirmed');
    }
    await assertPolicy(connection, input.businessId, Number(order.location_id));
    const itemById = new Map(items.map(item => [Number(item.id), item]));
    const requestedLines = input.shipmentQuantities.map(shipment => {
      const item = itemById.get(Number(shipment.itemId));
      if (!item) throw new ProductBuildConflictError(`Sales order item ${shipment.itemId} was not found.`, 'sales_order_item_not_found');
      return { variantId: String(item.variant_id), quantity: Number(shipment.quantity), sourceLineId: String(item.id) };
    });
    const stock = await loadOutputStock(connection, input.businessId, Number(order.location_id), requestedLines.map(line => line.variantId));
    const planned = planBuildFromSaleShortfalls(requestedLines, new Map([...stock].map(([id, value]) => [id, value.onHand])));
    const builds = matchConsent(planned, input.builds);
    const build = await completeProductBuildInTransaction(connection, {
      businessId: input.businessId, locationId: Number(order.location_id), operationKey: `${input.operationKey}:build`, builds,
      sourceType: 'sales_order', sourceId: String(input.soId),
      sourceChannel: String(order.sales_channel ?? (order.so_type === 'online' ? 'online' : 'wholesale')),
      actorId: input.actorId, actorName: input.actorName,
    });
    const fulfilment = await fulfilSalesOrderPartialInTransaction(connection, {
      businessId: input.businessId, soId: input.soId, operationKey: `${input.operationKey}:fulfil`,
      shipmentQuantities: input.shipmentQuantities, finalizeWhenComplete: true,
    });
    await connection.commit();
    await refreshSalesOrderBuildCache(
      input.businessId,
      input.soId,
      'build_and_fulfil',
      [...new Set([...build.touchedVariantIds, ...fulfilment.fulfilledVariantIds])],
    );
    await recomputeBuildRequirementsSafely({ businessId: input.businessId, salesOrderId: input.soId });
    return { build, fulfilment };
  } catch (error) {
    await connection.rollback();
    if (!(error instanceof ProductBuildConflictError)) {
      await reportRuntimeIssue({
        businessId: input.businessId, source: 'ims_sales_orders', operation: 'build_and_fulfil',
        title: 'Build & Fulfil failed', error, context: { soId: input.soId, operationKey: input.operationKey },
        reference: { type: 'sales_order', id: input.soId },
      }).catch(() => {});
    }
    throw error;
  } finally { connection.release(); }
}