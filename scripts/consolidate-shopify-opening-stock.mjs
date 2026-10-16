import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const businessName = option('business-name');
const runId = option('run-id');
const expectedDocuments = Number(option('expected-documents'));
const apply = process.argv.includes('--apply');
const backupPath = option('backup');
if (!businessName || !/^[a-zA-Z0-9-]{8,64}$/.test(runId ?? '') || !Number.isSafeInteger(expectedDocuments) || expectedDocuments < 2) {
  throw new Error('Provide --business-name, --run-id and --expected-documents (at least 2).');
}
if (apply && (!backupPath || !path.isAbsolute(backupPath))) throw new Error('--apply requires an absolute --backup path.');
const config = {
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, dateStrings: true,
};
const main = await mysql.createConnection({ ...config, database: process.env.MYSQL_DATABASE });
let tenant;
const hash = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const without = (rows, key) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key)));
try {
  const [businesses] = await main.execute(
    'SELECT business_id, name, ims_db_name FROM businesses WHERE name = ? AND deleted_at IS NULL', [businessName],
  );
  if (businesses.length !== 1 || !businesses[0].ims_db_name) throw new Error('Exactly one explicitly mapped tenant is required.');
  const business = businesses[0];
  tenant = await mysql.createConnection({ ...config, host: process.env.IMS_MYSQL_HOST || config.host, database: business.ims_db_name });
  if (apply) await tenant.beginTransaction();
  const [headers] = await tenant.execute(
    `SELECT * FROM ims_stocktakes WHERE business_id = ? AND reference LIKE ? ORDER BY id${apply ? ' FOR UPDATE' : ''}`,
    [business.business_id, `SHOPIFY-OPEN-${runId}-%`],
  );
  if (headers.length !== expectedDocuments) throw new Error(`Expected exactly ${expectedDocuments} stocktakes; found ${headers.length}. No changes made.`);
  if (headers.some(row => row.status !== 'completed' || row.xero_journal_id || row.xero_sync_status
    || row.reverted_at || row.xero_reversal_journal_id || row.xero_reversal_sync_status)) {
    throw new Error('Only completed, unreverted stocktakes without Xero posting or queued accounting can be consolidated.');
  }
  if (apply) {
    await tenant.execute('SELECT business_id FROM ims_inventory_cost_state WHERE business_id = ? FOR UPDATE', [business.business_id]);
  }
  const ids = headers.map(row => Number(row.id));
  const marks = ids.map(() => '?').join(',');
  const [items] = await tenant.execute(`SELECT * FROM ims_stocktake_items WHERE stocktake_id IN (${marks}) ORDER BY id`, ids);
  const headerById = new Map(headers.map(row => [Number(row.id), row]));
  const lineKeys = items.map(item => `${headerById.get(Number(item.stocktake_id)).location_id}:${item.variant_id}`);
  if (new Set(lineKeys).size !== lineKeys.length || items.some(item => item.soh_at_apply == null || item.applied_delta == null)) {
    throw new Error('Duplicate variants or missing apply snapshots prevent a safe consolidation.');
  }
  const [movements] = await tenant.execute(
    `SELECT * FROM ims_stock_movements WHERE business_id = ? AND reference_type = 'stocktake'
      AND reference_id IN (${marks}) ORDER BY id`, [business.business_id, ...ids],
  );
  const itemById = new Map(items.map(item => [Number(item.id), item]));
  if (movements.length !== items.filter(item => Math.abs(Number(item.applied_delta)) > 0.0001).length
    || movements.some(movement => {
      const item = itemById.get(Number(movement.source_line_id));
      return !item || Number(item.stocktake_id) !== Number(movement.reference_id)
        || Number(item.applied_delta) !== Number(movement.qty_change) || movement.movement_type !== 'stocktake';
    })) throw new Error('Stock movement evidence does not match the original apply snapshots.');
  const [layers] = await tenant.execute(
    `SELECT * FROM ims_fifo_cost_layers WHERE business_id = ? AND source_reference_type = 'stocktake'
      AND source_reference_id IN (${marks}) ORDER BY id`, [business.business_id, ...ids],
  );
  const [operations] = await tenant.execute(
    `SELECT * FROM ims_inventory_document_operations WHERE business_id = ? AND document_kind = 'stocktake'
      AND document_id IN (${marks}) ORDER BY id`, [business.business_id, ...ids],
  );
  if (operations.some(row => row.state !== 'complete')) throw new Error('A stocktake operation is still processing.');
  const [logs] = await tenant.execute(
    `SELECT * FROM ims_shopify_sync_log WHERE business_id = ?
      AND JSON_UNQUOTE(JSON_EXTRACT(detail, '$.runId')) = ? ORDER BY id`, [business.business_id, runId],
  );
  const stockSql = `SELECT stock.id, stock.business_id, stock.variant_id, stock.location_id,
    stock.qty_on_hand, stock.qty_incoming, stock.qty_committed, stock.min_qty, stock.reorder_qty,
    stock.zone, stock.bin, stock.updated_at FROM ims_stock stock
    JOIN ims_stocktake_items item ON BINARY item.variant_id = BINARY stock.variant_id
    JOIN ims_stocktakes document ON document.id = item.stocktake_id AND document.location_id = stock.location_id
      AND BINARY document.business_id = BINARY stock.business_id
    WHERE document.business_id = ? AND document.id IN (${marks}) ORDER BY stock.location_id, stock.variant_id`;
  const [stock] = await tenant.execute(stockSql, [business.business_id, ...ids]);
  const groups = [...new Set(headers.map(row => Number(row.location_id)))].map(locationId => {
    const documents = headers.filter(row => Number(row.location_id) === locationId);
    return { locationId, survivor: Number(documents[0].id), originalIds: documents.map(row => Number(row.id)) };
  });
  console.log(JSON.stringify({
    business: business.name, documents: headers.length, resultingDocuments: groups.length,
    itemCount: items.length, movements: movements.length, fifoLayers: layers.length,
    targetUnits: items.reduce((total, item) => total + Number(item.counted_qty), 0),
    currentUnits: stock.reduce((total, row) => total + Number(row.qty_on_hand), 0), groups,
  }));
  if (!apply) {
    console.log('Dry run only. Stock quantities, cost values and audit records have not been changed.');
  } else {
    await fs.writeFile(backupPath, JSON.stringify({
      backedUpAt: new Date().toISOString(), businessId: business.business_id, tenantSchema: business.ims_db_name,
      runId, groups, headers, items, movements, layers, operations, logs, stock,
    }, null, 2), { flag: 'wx' });
    const replacement = new Map();
    for (const group of groups) {
      const groupMarks = group.originalIds.map(() => '?').join(',');
      for (const id of group.originalIds) replacement.set(id, group.survivor);
      await tenant.execute(`UPDATE ims_stocktake_items SET stocktake_id = ? WHERE stocktake_id IN (${groupMarks})`, [group.survivor, ...group.originalIds]);
      await tenant.execute(
        `UPDATE ims_stock_movements SET reference_id = ? WHERE business_id = ? AND reference_type = 'stocktake'
          AND reference_id IN (${groupMarks})`, [group.survivor, business.business_id, ...group.originalIds],
      );
      await tenant.execute(
        `UPDATE ims_fifo_cost_layers SET source_reference_id = ? WHERE business_id = ? AND source_reference_type = 'stocktake'
          AND source_reference_id IN (${groupMarks})`, [group.survivor, business.business_id, ...group.originalIds],
      );
      await tenant.execute(
        `UPDATE ims_inventory_document_operations
          SET after_metadata_json = JSON_SET(COALESCE(after_metadata_json, JSON_OBJECT()),
                '$.consolidationOriginalStocktakeId', document_id, '$.consolidatedStocktakeId', ?),
              response_json = CASE WHEN response_json IS NULL THEN NULL ELSE JSON_SET(response_json, '$.id', ?) END,
              document_id = ?
          WHERE business_id = ? AND document_kind = 'stocktake' AND document_id IN (${groupMarks})`,
        [group.survivor, group.survivor, group.survivor, business.business_id, ...group.originalIds],
      );
      const completedAt = headers.filter(row => group.originalIds.includes(Number(row.id)))
        .map(row => row.completed_at).sort().at(-1);
      await tenant.execute(
        `UPDATE ims_stocktakes SET reference = ?, notes = ?, completed_at = ?, updated_at = NOW()
          WHERE business_id = ? AND id = ?`,
        [`SHOPIFY-OPEN-${runId}-location-${group.locationId}`,
          `Consolidated Shopify opening stock. Original completed stocktakes: ${group.originalIds.join(', ')}. Stock, movement IDs, line IDs and applied costs were preserved.`,
          completedAt, business.business_id, group.survivor],
      );
      const removedIds = group.originalIds.filter(id => id !== group.survivor);
      if (removedIds.length) {
        await tenant.execute(
          `DELETE FROM ims_stocktakes WHERE business_id = ? AND id IN (${removedIds.map(() => '?').join(',')})`,
          [business.business_id, ...removedIds],
        );
      }
    }
    for (const log of logs) {
      const detail = typeof log.detail === 'string' ? JSON.parse(log.detail) : log.detail;
      if (detail.stocktakes) {
        detail.stocktakes = detail.stocktakes.map(document => ({
          ...document, originalStocktakeId: document.id, id: replacement.get(Number(document.id)) ?? document.id,
        }));
        detail.consolidatedToOneStocktakePerLocation = true;
        await tenant.execute('UPDATE ims_shopify_sync_log SET detail = ? WHERE id = ? AND business_id = ?',
          [JSON.stringify(detail), log.id, business.business_id]);
      }
    }
    const remainingIds = groups.map(group => group.survivor);
    const remainingMarks = remainingIds.map(() => '?').join(',');
    const [afterItems] = await tenant.execute(`SELECT * FROM ims_stocktake_items WHERE stocktake_id IN (${remainingMarks}) ORDER BY id`, remainingIds);
    const [afterStock] = await tenant.execute(stockSql, [business.business_id, ...ids]);
    const [afterMovements] = await tenant.execute(
      `SELECT * FROM ims_stock_movements WHERE business_id = ? AND reference_type = 'stocktake'
        AND reference_id IN (${remainingMarks}) ORDER BY id`, [business.business_id, ...remainingIds],
    );
    const [afterLayers] = await tenant.execute(
      `SELECT * FROM ims_fifo_cost_layers WHERE business_id = ? AND source_reference_type = 'stocktake'
        AND source_reference_id IN (${remainingMarks}) ORDER BY id`, [business.business_id, ...remainingIds],
    );
    if (hash(stock) !== hash(afterStock) || hash(without(items, 'stocktake_id')) !== hash(without(afterItems, 'stocktake_id'))
      || hash(without(movements, 'reference_id')) !== hash(without(afterMovements, 'reference_id'))
      || hash(without(layers, 'source_reference_id')) !== hash(without(afterLayers, 'source_reference_id'))) {
      throw new Error('A quantity, costing snapshot or non-reference field changed. Rolling back.');
    }
    const [afterHeaders] = await tenant.execute(
      'SELECT id, location_id, status FROM ims_stocktakes WHERE business_id = ? AND reference LIKE ? ORDER BY id',
      [business.business_id, `SHOPIFY-OPEN-${runId}-%`],
    );
    if (afterHeaders.length !== groups.length || afterHeaders.some(row => row.status !== 'completed')) throw new Error('Consolidated document count or status is incorrect.');
    await tenant.commit();
    console.log(`Committed: ${headers.length} stocktakes consolidated into ${groups.length}. Stock, applied quantities, movement IDs and cost snapshots are unchanged. Backup: ${backupPath}`);
  }
} catch (error) {
  if (tenant && apply) await tenant.rollback();
  throw error;
} finally {
  if (tenant) await tenant.end();
  await main.end();
}
