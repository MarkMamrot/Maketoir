/**
 * Repair Monsterthreads Shopify fulfillment failures audited on 2026-08-18.
 *
 * Dry run:
 *   node scripts/repair-monsterthreads-shopify-fulfilments-202608.mjs
 * Apply after deploying the webhook fix:
 *   node scripts/repair-monsterthreads-shopify-fulfilments-202608.mjs --apply
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import Shopify from 'shopify-api-node';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const BUSINESS_NAME = 'Monsterthreads';
const EXPECTED_SCHEMA = 'readyedu_MonsterthreadsIMS';
const FALLBACK_SKU = 'SHOPIFY-MISC';
const AUDITED_ORDERS = [
  [49630, '#47748'], [49620, '#47738'], [49628, '#47746'], [49629, '#47747'],
  [49614, '#47732'], [49608, '#47726'], [49603, '#47721'], [49607, '#47725'],
  [49606, '#47724'], [49576, '#47709'], [49573, '#47706'],
];
const REMAPS = [
  { soId: 49630, orderName: '#47748', lineItemId: 98101, sku: '1251801' },
  { soId: 49629, orderName: '#47747', lineItemId: 98097, sku: 'MT-RCKCapybara-6 to 9 years' },
];

function connectionConfig(database) {
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database,
    connectTimeout: 20_000,
  };
}

function decrypt(value) {
  if (!value) return '';
  const parts = String(value).split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return String(value);
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY is required to inspect Shopify order lines.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

async function expectedCommitted(connection, businessId, variantId, locationId) {
  const [[sales]] = await connection.execute(
    `SELECT COALESCE(SUM(GREATEST(0, soi.qty_ordered - soi.qty_fulfilled)), 0) AS quantity
       FROM ims_sales_order_items soi
       JOIN ims_sales_orders so ON so.id = soi.so_id
       JOIN ims_product_variants pv ON pv.variant_id = soi.variant_id
       JOIN ims_products p ON p.product_id = pv.product_id
      WHERE so.business_id = ? AND soi.variant_id = ? AND so.location_id = ?
        AND so.status IN ('confirmed', 'partially_fulfilled', 'backordered')
        AND COALESCE(p.is_stock_item, 1) = 1`,
    [businessId, variantId, locationId],
  );
  const [[transfers]] = await connection.execute(
    `SELECT COALESCE(SUM(bti.qty_sent), 0) AS quantity
       FROM ims_branch_transfer_items bti
       JOIN ims_branch_transfers bt ON bt.id = bti.transfer_id
      WHERE bti.variant_id = ? AND bt.from_location_id = ? AND bt.status = 'sent'`,
    [variantId, locationId],
  );
  return Number(sales.quantity) + Number(transfers.quantity);
}

async function main() {
  const mainDb = await mysql.createConnection(connectionConfig(process.env.MYSQL_DATABASE));
  let imsDb;
  try {
    const [businessRows] = await mainDb.execute(
      `SELECT business_id, name, ims_db_name
         FROM businesses
        WHERE LOWER(name) = LOWER(?) AND COALESCE(is_sandbox, 0) = 0`,
      [BUSINESS_NAME],
    );
    if (businessRows.length !== 1) throw new Error(`Expected one live ${BUSINESS_NAME} business, found ${businessRows.length}.`);
    const business = businessRows[0];
    if (business.ims_db_name !== EXPECTED_SCHEMA) {
      throw new Error(`Refusing unexpected IMS schema ${business.ims_db_name}.`);
    }
    imsDb = await mysql.createConnection(connectionConfig(business.ims_db_name));

    const [orders] = await imsDb.execute(
      `SELECT id, shopify_order_id, shopify_order_name, status, location_id
         FROM ims_sales_orders
        WHERE business_id = ? AND id IN (${AUDITED_ORDERS.map(() => '?').join(',')})
        ORDER BY id`,
      [business.business_id, ...AUDITED_ORDERS.map(([id]) => id)],
    );
    if (orders.length !== AUDITED_ORDERS.length) {
      throw new Error(`Expected ${AUDITED_ORDERS.length} audited orders, found ${orders.length}.`);
    }
    for (const [id, name] of AUDITED_ORDERS) {
      const order = orders.find(row => Number(row.id) === id);
      if (order?.shopify_order_name !== name) throw new Error(`Order ${id} is not ${name}.`);
    }

    const [fallbackRows] = await imsDb.execute(
      `SELECT pv.variant_id, pv.product_id, p.name, p.is_stock_item
         FROM ims_product_variants pv
         JOIN ims_products p ON p.product_id = pv.product_id
        WHERE p.business_id = ? AND UPPER(COALESCE(pv.sku, '')) = ?`,
      [business.business_id, FALLBACK_SKU],
    );
    if (fallbackRows.length !== 1) throw new Error(`Expected one ${FALLBACK_SKU} variant, found ${fallbackRows.length}.`);
    const fallback = fallbackRows[0];

    const [connectionRows] = await mainDb.execute(
      'SELECT shopify_shop_id, shopify_access_token FROM connections WHERE business_id = ? LIMIT 1',
      [business.business_id],
    );
    if (!connectionRows[0]?.shopify_shop_id || !connectionRows[0]?.shopify_access_token) {
      throw new Error('Monsterthreads Shopify credentials are unavailable.');
    }
    const shopify = new Shopify({
      shopName: String(connectionRows[0].shopify_shop_id).replace(/\.myshopify\.com$/i, ''),
      accessToken: decrypt(connectionRows[0].shopify_access_token),
      apiVersion: '2024-01',
      autoLimit: true,
    });

    const remapPlans = [];
    for (const target of REMAPS) {
      const [[line]] = await imsDb.execute(
        `SELECT soi.id, soi.variant_id, soi.shopify_line_item_id, soi.qty_ordered,
                so.shopify_order_id, so.shopify_order_name, so.location_id
           FROM ims_sales_order_items soi
           JOIN ims_sales_orders so ON so.id = soi.so_id
          WHERE soi.id = ? AND soi.so_id = ? AND so.business_id = ?`,
        [target.lineItemId, target.soId, business.business_id],
      );
      if (!line || line.shopify_order_name !== target.orderName) throw new Error(`Remap line ${target.lineItemId} identity changed.`);
      const [variantRows] = await imsDb.execute(
        `SELECT pv.variant_id, pv.shopify_variant_id, p.name, p.is_stock_item
           FROM ims_product_variants pv
           JOIN ims_products p ON p.product_id = pv.product_id
          WHERE p.business_id = ? AND pv.sku = ?`,
        [business.business_id, target.sku],
      );
      if (variantRows.length !== 1 || Number(variantRows[0].is_stock_item) !== 1) {
        throw new Error(`Expected one stock variant for SKU ${target.sku}.`);
      }
      if (![fallback.variant_id, variantRows[0].variant_id].includes(line.variant_id)) {
        throw new Error(`Line ${target.lineItemId} is neither fallback nor already mapped to ${target.sku}.`);
      }
      const shopifyOrder = await shopify.order.get(Number(line.shopify_order_id), { fields: 'id,line_items' });
      const shopifyLine = shopifyOrder.line_items?.find(item => String(item.id) === String(line.shopify_line_item_id));
      if (!shopifyLine?.variant_id) throw new Error(`Shopify line ${line.shopify_line_item_id} has no variant ID.`);
      const [conflicts] = await imsDb.execute(
        `SELECT sku FROM ims_product_variants
          WHERE shopify_variant_id = ? AND variant_id <> ?`,
        [String(shopifyLine.variant_id), variantRows[0].variant_id],
      );
      if (conflicts.length > 0) throw new Error(`Shopify variant ${shopifyLine.variant_id} is already linked to ${conflicts[0].sku}.`);
      remapPlans.push({ ...target, ...line, targetVariantId: variantRows[0].variant_id, shopifyVariantId: String(shopifyLine.variant_id) });
    }

    const [openFallbackLines] = await imsDb.execute(
      `SELECT so.id AS so_id, so.shopify_order_name, soi.id AS item_id, soi.notes,
              soi.qty_ordered - soi.qty_fulfilled AS outstanding
         FROM ims_sales_order_items soi
         JOIN ims_sales_orders so ON so.id = soi.so_id
        WHERE soi.variant_id = ? AND so.business_id = ?
          AND so.status IN ('confirmed', 'partially_fulfilled', 'backordered')
          AND soi.qty_ordered > soi.qty_fulfilled
        ORDER BY so.id, soi.id`,
      [fallback.variant_id, business.business_id],
    );
    const [fallbackStock] = await imsDb.execute(
      `SELECT s.location_id, l.name AS location, s.qty_on_hand, s.qty_committed
         FROM ims_stock s JOIN ims_locations l ON l.id = s.location_id
        WHERE s.variant_id = ? ORDER BY s.location_id`,
      [fallback.variant_id],
    );
    console.log(`Business: ${business.name} (${business.business_id})`);
    console.log(`Schema: ${business.ims_db_name}`);
    console.log('\nVerified audited orders:');
    console.table(orders.map(order => ({ id: order.id, order: order.shopify_order_name, status: order.status })));
    console.log('\nVerified product remaps:');
    console.table(remapPlans.map(plan => ({ order: plan.orderName, item: plan.lineItemId, sku: plan.sku, shopify_variant_id: plan.shopifyVariantId })));
    console.log('\nAll open fallback lines before repair:');
    console.table(openFallbackLines);
    console.log('\nFallback stock before repair:');
    console.table(fallbackStock);

    await imsDb.beginTransaction();
    await imsDb.execute('UPDATE ims_products SET is_stock_item = 0 WHERE product_id = ? AND business_id = ?', [fallback.product_id, business.business_id]);
    for (const plan of remapPlans) {
      await imsDb.execute(
        'UPDATE ims_product_variants SET shopify_variant_id = ? WHERE variant_id = ? AND business_id = ?',
        [plan.shopifyVariantId, plan.targetVariantId, business.business_id],
      );
      await imsDb.execute(
        'UPDATE ims_sales_order_items SET variant_id = ?, business_id = ? WHERE id = ? AND so_id = ?',
        [plan.targetVariantId, business.business_id, plan.lineItemId, plan.soId],
      );
    }
    await imsDb.execute(
      `UPDATE ims_sales_order_items soi
       JOIN ims_sales_orders so ON so.id = soi.so_id
          SET soi.business_id = ?
        WHERE so.business_id = ? AND so.id IN (${AUDITED_ORDERS.map(() => '?').join(',')})`,
      [business.business_id, business.business_id, ...AUDITED_ORDERS.map(([id]) => id)],
    );

    for (const stock of fallbackStock) {
      const oldOnHand = Number(stock.qty_on_hand);
      if (oldOnHand !== 0) {
        await imsDb.execute(
          `INSERT INTO ims_stock_movements
            (business_id, variant_id, location_id, movement_type, channel, reference_type,
             reference_id, qty_change, qty_after_soh, unit_cost, notes)
           VALUES (?, ?, ?, 'adjustment', 'online', 'manual', NULL, ?, 0, 0,
                   'Repair non-stock Shopify fallback ledger after 2026-08 fulfillment audit')`,
          [business.business_id, fallback.variant_id, stock.location_id, -oldOnHand],
        );
      }
      await imsDb.execute(
        'UPDATE ims_stock SET qty_on_hand = 0, qty_committed = 0 WHERE variant_id = ? AND location_id = ?',
        [fallback.variant_id, stock.location_id],
      );
    }

    const affectedVariantIds = [...new Set(remapPlans.map(plan => plan.targetVariantId))];
    for (const variantId of affectedVariantIds) {
      const [locations] = await imsDb.execute(
        `SELECT id FROM ims_locations WHERE business_id = ?
         UNION SELECT location_id AS id FROM ims_stock WHERE variant_id = ?`,
        [business.business_id, variantId],
      );
      for (const location of locations) {
        const quantity = await expectedCommitted(imsDb, business.business_id, variantId, Number(location.id));
        if (quantity > 0) {
          await imsDb.execute(
            `INSERT INTO ims_stock (business_id, variant_id, location_id, qty_committed)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_committed = VALUES(qty_committed)`,
            [business.business_id, variantId, Number(location.id), quantity],
          );
        } else {
          await imsDb.execute(
            'UPDATE ims_stock SET qty_committed = 0 WHERE variant_id = ? AND location_id = ?',
            [variantId, Number(location.id)],
          );
        }
      }
    }
    await imsDb.execute(
      `INSERT IGNORE INTO ims_shopify_inventory_queue (variant_id, queued_at)
       VALUES ${affectedVariantIds.map(() => '(?, NOW())').join(',')}`,
      affectedVariantIds,
    ).catch(() => {});

    if (APPLY) {
      await imsDb.commit();
      console.log('\nAPPLIED: fallback is non-stock, verified product lines are remapped, fallback stock is zero, and affected commitments are reconciled.');
      console.log('Deploy the webhook fix, complete transfers for #47724 and #47709, then replay the audited Shopify fulfillments.');
    } else {
      await imsDb.rollback();
      console.log('\nDRY RUN: all writes rolled back. Re-run with --apply after reviewing this report.');
    }
  } catch (error) {
    if (imsDb) await imsDb.rollback().catch(() => {});
    throw error;
  } finally {
    if (imsDb) await imsDb.end();
    await mainDb.end();
  }
}

main().catch(error => {
  console.error(`Repair aborted: ${error.message}`);
  process.exitCode = 1;
});