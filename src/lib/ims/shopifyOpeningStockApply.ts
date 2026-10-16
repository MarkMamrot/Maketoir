import { createHash } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';
import { hashInventoryDocumentRequest } from './inventoryDocumentLifecycle';
import { claimInventoryDocumentOperation, completeInventoryDocumentOperation } from './inventoryDocumentOperations';
import { ShopifyOpeningStockValidationError } from './shopifyOpeningStock';
import type { OpeningStockSnapshot, OpeningStockSnapshotLine } from './shopifyOpeningStockSnapshot';
import { applyStocktakeInTransaction } from './stocktakes/stocktakeOperations';

interface ImportContext {
  businessId: string;
  channelInstanceId: string;
  runId: string;
  actorId?: number;
  actorName?: string | null;
}
interface StocktakeRow extends RowDataPacket {
  id: number;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled' | 'reverted';
}
interface PreparedStocktake {
  id: number;
  location: string;
  status: StocktakeRow['status'];
}

export function openingStocktakeReference(channelInstanceId: string, runId: string, locationId: number) {
  const identity = createHash('sha256').update(`${channelInstanceId}\0${runId}`).digest('hex').slice(0, 40);
  return `SHOPIFY-OPEN-${identity}-${locationId}`;
}

function snapshotLines(snapshots: OpeningStockSnapshot[]): OpeningStockSnapshotLine[] {
  if (!snapshots.length || snapshots.length > 2000) {
    throw new ShopifyOpeningStockValidationError('Prepare between 1 and 2,000 preview batches.');
  }
  if (new Set(snapshots.map(snapshot => snapshot.offset)).size !== snapshots.length) {
    throw new ShopifyOpeningStockValidationError('The preview contains duplicate batches. Preview again.');
  }
  const lines = snapshots.flatMap(snapshot => snapshot.lines);
  if (lines.length > 50_000 || new Set(lines.map(line => `${line.solvantisLocationId}:${line.variantId}`)).size !== lines.length) {
    throw new ShopifyOpeningStockValidationError('The preview has duplicate lines or exceeds 50,000 location/variant balances.');
  }
  return lines;
}

async function validateLinks(context: ImportContext, lines: OpeningStockSnapshotLine[]) {
  const variantIds = [...new Set(lines.map(line => line.variantId))];
  const variants = await imsQuery<{ variant_id: string; external_inventory_id: string }>(
    `SELECT v.variant_id, mapping.external_inventory_id FROM ims_product_variants v
      JOIN ims_products p ON BINARY p.product_id = BINARY v.product_id AND BINARY p.business_id = BINARY v.business_id
      JOIN ims_sales_channel_product_mappings mapping ON BINARY mapping.variant_id = BINARY v.variant_id
        AND BINARY mapping.business_id = BINARY v.business_id
      WHERE v.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
        AND v.is_active = 1 AND p.is_active = 1 AND COALESCE(p.is_stock_item, 1) = 1
        AND v.variant_id IN (${variantIds.map(() => '?').join(',')})`,
    [context.businessId, context.channelInstanceId, ...variantIds],
  );
  const byId = new Map(variants.map(variant => [variant.variant_id, String(variant.external_inventory_id)]));
  if (variants.length !== variantIds.length || lines.some(line => byId.get(line.variantId) !== line.inventoryItemId)) {
    throw new ShopifyOpeningStockValidationError('One or more variants are no longer linked to Shopify. Preview again.');
  }
}

export async function prepareOpeningStocktakes(context: ImportContext, snapshots: OpeningStockSnapshot[]) {
  const lines = snapshotLines(snapshots);
  await validateLinks(context, lines);
  const locationIds = [...new Set(lines.map(line => line.solvantisLocationId))].sort((a, b) => a - b);
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [locations] = await connection.execute<(RowDataPacket & { id: number; name: string; is_active: number })[]>(
      `SELECT id, name, is_active FROM ims_locations WHERE business_id = ?
        AND id IN (${locationIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
      [context.businessId, ...locationIds],
    );
    if (lines.some(line => !locations.some(location =>
      Number(location.id) === line.solvantisLocationId && location.name === line.locationName && Number(location.is_active) !== 0))) {
      throw new ShopifyOpeningStockValidationError('An opening stock location changed after preview. Preview again.');
    }
    const stocktakes: PreparedStocktake[] = [];
    for (const locationId of locationIds) {
      const locationLines = lines.filter(line => line.solvantisLocationId === locationId)
        .sort((a, b) => a.variantId.localeCompare(b.variantId));
      const locationName = locationLines[0].locationName;
      const reference = openingStocktakeReference(context.channelInstanceId, context.runId, locationId);
      const [existing] = await connection.execute<StocktakeRow[]>(
        'SELECT id, status FROM ims_stocktakes WHERE business_id = ? AND location_id = ? AND reference = ? FOR UPDATE',
        [context.businessId, locationId, reference],
      );
      if (existing.length > 1) throw new Error('Multiple opening stocktakes share the same run and location.');
      let stocktake: Pick<StocktakeRow, 'id' | 'status'> | undefined = existing[0];
      if (stocktake && (stocktake.status === 'cancelled' || stocktake.status === 'reverted')) {
        throw new ShopifyOpeningStockValidationError('This opening-stock import was cancelled or reversed. Create a new preview.');
      }
      if (!stocktake) {
        const [created] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_stocktakes (business_id, reference, location_id, status, notes)
            VALUES (?, ?, ?, 'draft', ?)`,
          [context.businessId, reference, locationId, `Shopify opening stock for ${locationName}. One stocktake for the complete import. Run ${context.runId}.`],
        );
        stocktake = { id: Number(created.insertId), status: 'draft' };
      }
      const operation = await claimInventoryDocumentOperation(connection, {
        operationKey: `shopify-opening-prepare-${context.runId}-${locationId}`,
        requestHash: await hashInventoryDocumentRequest({ channelInstanceId: context.channelInstanceId, lines: locationLines }),
        actorId: context.actorId, actorName: context.actorName,
      }, {
        businessId: context.businessId, documentKind: 'stocktake', documentId: stocktake.id,
        action: 'start', documentStatus: stocktake.status,
        beforeMetadata: { status: stocktake.status, locationId, plannedLines: locationLines.length },
      });
      if (!operation.replayed) {
        if (stocktake.status !== 'draft') throw new ShopifyOpeningStockValidationError('This import is already prepared with different changes. Preview again.');
        for (let offset = 0; offset < locationLines.length; offset += 250) {
          const batch = locationLines.slice(offset, offset + 250);
          await connection.execute(
            `INSERT INTO ims_stocktake_items (business_id, stocktake_id, variant_id, expected_qty, counted_qty, notes)
             SELECT ?, ?, targets.variant_id, COALESCE(stock.qty_on_hand, 0), targets.quantity, targets.notes
               FROM (${batch.map(() => 'SELECT ? AS variant_id, ? AS quantity, ? AS notes').join(' UNION ALL ')}) targets
               LEFT JOIN ims_stock stock ON stock.business_id = ? AND stock.location_id = ?
                 AND BINARY stock.variant_id = BINARY targets.variant_id`,
            [context.businessId, stocktake.id,
              ...batch.flatMap(line => [line.variantId, line.quantity, line.wasNegative ? 'Negative Shopify quantity clamped to zero.' : null]),
              context.businessId, locationId],
          );
        }
        await connection.execute("UPDATE ims_stocktakes SET status = 'in_progress' WHERE id = ? AND business_id = ?", [stocktake.id, context.businessId]);
        await completeInventoryDocumentOperation(connection, context.businessId, operation.operationId, 'in_progress',
          { id: stocktake.id, status: 'in_progress', replayed: false },
          { status: 'in_progress', plannedLineCount: locationLines.length });
        stocktake.status = 'in_progress';
      }
      stocktakes.push({ id: stocktake.id, location: locationName, status: stocktake.status });
    }
    await connection.commit();
    return stocktakes;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function applyOpeningStockBatch(context: ImportContext, snapshot: OpeningStockSnapshot) {
  await validateLinks(context, snapshot.lines);
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const stocktakes = [];
    const locationIds = [...new Set(snapshot.lines.map(line => line.solvantisLocationId))].sort((a, b) => a - b);
    const [locations] = await connection.execute<(RowDataPacket & { id: number; name: string; is_active: number })[]>(
      `SELECT id, name, is_active FROM ims_locations WHERE business_id = ?
        AND id IN (${locationIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
      [context.businessId, ...locationIds],
    );
    if (snapshot.lines.some(line => !locations.some(location =>
      Number(location.id) === line.solvantisLocationId && location.name === line.locationName && Number(location.is_active) !== 0))) {
      throw new ShopifyOpeningStockValidationError('An opening stock location changed after preparation. Review the location before retrying.');
    }
    for (const locationId of locationIds) {
      const lines = snapshot.lines.filter(line => line.solvantisLocationId === locationId);
      const [headers] = await connection.execute<StocktakeRow[]>(
        'SELECT id, status FROM ims_stocktakes WHERE business_id = ? AND location_id = ? AND reference = ? FOR UPDATE',
        [context.businessId, locationId, openingStocktakeReference(context.channelInstanceId, context.runId, locationId)],
      );
      if (headers.length !== 1) throw new ShopifyOpeningStockValidationError('Prepare the full opening-stock import before applying batches. Reload and preview again.');
      const [items] = await connection.execute<(RowDataPacket & { variant_id: string; counted_qty: number })[]>(
        `SELECT variant_id, counted_qty FROM ims_stocktake_items WHERE stocktake_id = ?
          AND variant_id IN (${lines.map(() => '?').join(',')}) FOR UPDATE`,
        [headers[0].id, ...lines.map(line => line.variantId)],
      );
      if (items.length !== lines.length || lines.some(line => !items.some(item =>
        item.variant_id === line.variantId && Number(item.counted_qty) === line.quantity))) {
        throw new ShopifyOpeningStockValidationError('The batch quantities do not match the prepared stocktake. Preview again.');
      }
      const result = await applyStocktakeInTransaction(connection, {
        businessId: context.businessId, stocktakeId: headers[0].id,
        context: {
          operationKey: `shopify-opening-${context.runId}-${snapshot.offset}-${locationId}`,
          requestHash: await hashInventoryDocumentRequest({ channelInstanceId: context.channelInstanceId, lines }),
          actorId: context.actorId, actorName: context.actorName,
        },
      }, lines.map(line => line.variantId));
      stocktakes.push({ ...result, location: lines[0].locationName });
    }
    await connection.commit();
    return stocktakes;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
