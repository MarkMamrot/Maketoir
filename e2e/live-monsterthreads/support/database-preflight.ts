import mysql from 'mysql2/promise';

import { appendLiveRunEvent } from '../../../src/lib/liveE2E/manifest';
import type { LiveE2EConfig } from '../../../src/lib/liveE2E/safety';
import { createManifest, readManifest } from './manifest-store';

let activeConnection: mysql.Connection | null = null;
let activeLockName: string | null = null;

function envRequired(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Live E2E blocked: ${key} is required for database preflight.`);
  return value;
}

export async function runDatabasePreflight(config: LiveE2EConfig): Promise<void> {
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  const lockName = `live-e2e:${config.expectedBusinessId}`;
  let lockHeld = false;

  try {
    const [[lock]] = await connection.query<mysql.RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    if (Number(lock?.acquired) !== 1) throw new Error('Live E2E blocked: another Monsterthreads live run holds the advisory lock.');
    lockHeld = true;

    const [[business]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT business_id, name, ims_db_name
         FROM businesses
        WHERE business_id = ? AND deleted_at IS NULL
        LIMIT 1`,
      [config.expectedBusinessId],
    );
    if (!business || business.ims_db_name !== config.expectedImsSchema) {
      throw new Error('Live E2E blocked: business-to-IMS-schema mapping does not match the expected identity.');
    }

    const [[integration]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT shopify_shop_id, xero_tenant_id
         FROM connections
        WHERE business_id = ?
        LIMIT 1`,
      [config.expectedBusinessId],
    );
    if (integration?.shopify_shop_id !== config.expectedShopifyShop || integration?.xero_tenant_id !== config.expectedXeroTenantId) {
      throw new Error('Live E2E blocked: stored Shopify or Xero identity does not match the expected identity.');
    }

    const schema = connection.escapeId(config.expectedImsSchema);
    const [[variant]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT v.variant_id, v.sku, v.is_active AS variant_active, v.shopify_variant_id,
              v.shopify_inventory_item_id, p.is_active AS product_active, p.is_online,
              p.is_stock_item, p.shopify_product_id
         FROM ${schema}.ims_product_variants v
         JOIN ${schema}.ims_products p
           ON p.product_id = v.product_id AND p.business_id = v.business_id
        WHERE v.business_id = ? AND v.variant_id = ?
        LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId],
    );
    if (!variant || variant.sku !== config.fixtureSku || !Number(variant.variant_active) || !Number(variant.product_active)
      || !Number(variant.is_stock_item) || Number(variant.is_online)
      || variant.shopify_product_id || variant.shopify_variant_id || variant.shopify_inventory_item_id) {
      throw new Error('Live E2E blocked: fixture variant is missing, inactive, non-stock, online, Shopify-linked, or has the wrong SKU.');
    }

    const [[location]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, name, is_active, has_pos, has_online
         FROM ${schema}.ims_locations
        WHERE business_id = ? AND id = ?
        LIMIT 1`,
      [config.expectedBusinessId, config.fixtureLocationId],
    );
    if (!location || !Number(location.is_active) || Number(location.has_pos) || Number(location.has_online)) {
      throw new Error('Live E2E blocked: fixture location must be active and isolated from POS and online trading.');
    }

    const [contacts] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, name, type, is_active
         FROM ${schema}.ims_contacts
        WHERE business_id = ? AND id IN (?, ?)`,
      [config.expectedBusinessId, config.fixtureSupplierId, config.fixtureCustomerId],
    );
    const supplier = contacts.find(row => Number(row.id) === config.fixtureSupplierId);
    const customer = contacts.find(row => Number(row.id) === config.fixtureCustomerId);
    if (!supplier || !Number(supplier.is_active) || !['supplier', 'both'].includes(String(supplier.type))) {
      throw new Error('Live E2E blocked: fixture supplier is missing, inactive, or not a supplier.');
    }
    if (!customer || !Number(customer.is_active) || !['b2b_customer', 'retail_customer', 'both'].includes(String(customer.type))) {
      throw new Error('Live E2E blocked: fixture customer is missing, inactive, or not a customer.');
    }

    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed
         FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ?
        LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const existingEvents = config.action === 'preflight' ? [] : await readManifest(config.runId);
    const currentState = existingEvents.at(-1)?.state;
    const checkpointedPoId = Number((existingEvents.findLast(event => event.state === 'p1_created')?.details as any)?.purchaseOrderId);
    const checkpointedSoId = Number((existingEvents.findLast(event => event.state === 'p2_created')?.details as any)?.salesOrderId);
    const checkpointedP3SoId = Number((existingEvents.findLast(event => event.state === 'p3_created')?.details as any)?.salesOrderId);
    const checkpointedP4ReplacementSoId = Number((existingEvents.findLast(event => event.state === 'p4_created')?.details as any)?.replacementSoId);
    const [openPurchaseOrders] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT po.id, po.status, po.location_id, item.qty_received, po.notes
         FROM ${schema}.ims_purchase_order_items item
         JOIN ${schema}.ims_purchase_orders po ON po.id = item.po_id
        WHERE po.business_id = ? AND item.variant_id = ?
          AND po.status IN ('draft','confirmed','partially_received','backordered')`,
      [config.expectedBusinessId, config.fixtureVariantId],
    );
    const [openSalesOrders] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so.id, so.status, so.customer_id, so.location_id, so.notes, item.qty_ordered, item.qty_fulfilled
         FROM ${schema}.ims_sales_order_items item
         JOIN ${schema}.ims_sales_orders so ON so.id = item.so_id
        WHERE so.business_id = ? AND item.variant_id = ?
          AND so.status IN ('draft','confirmed','partially_fulfilled','backordered')`,
      [config.expectedBusinessId, config.fixtureVariantId],
    );
    const checkpointedP3SourceOrder = Number.isInteger(checkpointedP3SoId)
      ? (await connection.query<mysql.RowDataPacket[]>(
          `SELECT so.id, so.status, so.xero_invoice_id, item.qty_ordered, item.qty_fulfilled
             FROM ${schema}.ims_sales_orders so
             JOIN ${schema}.ims_sales_order_items item ON item.so_id = so.id
            WHERE so.business_id = ? AND so.id = ? LIMIT 1`,
          [config.expectedBusinessId, checkpointedP3SoId],
        ))[0][0] ?? null
      : null;
    const resumablePurchaseOrder = config.action === 'p1'
      && currentState === 'p1_created'
      && Number.isInteger(checkpointedPoId)
      && openPurchaseOrders.length === 1
      && Number(openPurchaseOrders[0].id) === checkpointedPoId
      && openPurchaseOrders[0].status === 'confirmed'
      && Number(openPurchaseOrders[0].location_id) === config.fixtureLocationId
      && Number(openPurchaseOrders[0].qty_received) === 0
      && String(openPurchaseOrders[0].notes ?? '').includes(`LIVE E2E ${config.runId} P1`);
    const p2ActionStateAllowed = (config.action === 'p2' && currentState === 'p2_created')
      || (config.action === 'p2-compensate' && ['acknowledged', 'compensation_retry_authorized'].includes(currentState ?? ''));
    const resumableSalesOrder = p2ActionStateAllowed
      && Number.isInteger(checkpointedSoId)
      && openSalesOrders.length === 1
      && Number(openSalesOrders[0].id) === checkpointedSoId
      && ['draft', 'confirmed'].includes(String(openSalesOrders[0].status))
      && Number(openSalesOrders[0].customer_id) === config.fixtureCustomerId
      && Number(openSalesOrders[0].location_id) === config.fixtureLocationId
      && Number(openSalesOrders[0].qty_fulfilled) === 0
      && String(openSalesOrders[0].notes ?? '').includes(`LIVE E2E ${config.runId} P2`);
    const p3OpenSalesOrdersAreExpected = ['p3', 'p3-compensate'].includes(config.action)
      && openSalesOrders.length > 0
      && openSalesOrders.every(order =>
        Number(order.customer_id) === config.fixtureCustomerId
        && Number(order.location_id) === config.fixtureLocationId
        && Number(order.qty_ordered) >= 1
        && Number(order.qty_fulfilled) >= 0
        && ['draft', 'confirmed', 'backordered', 'partially_fulfilled'].includes(String(order.status)),
      );
    const resumableP3Source = config.action === 'p3'
      && p3OpenSalesOrdersAreExpected
      && (
        (
          currentState === 'preflight_passed'
          && Number(openSalesOrders.length) === 1
          && String(openSalesOrders[0].status) === 'draft'
        )
        || (
          ['p3_created', 'blocked'].includes(currentState ?? '')
          && Number.isInteger(checkpointedP3SoId)
          && openSalesOrders.some(order =>
            Number(order.id) === checkpointedP3SoId
            && ['draft', 'confirmed'].includes(String(order.status))
            && Number(order.location_id) === config.fixtureLocationId
            && Number(order.qty_fulfilled) === 0
            && Number(order.qty_ordered) === 2,
          )
        )
        || (
          Number.isInteger(checkpointedP3SoId)
          && Number(openSalesOrders.length) === 1
          && Number(openSalesOrders[0].id) === checkpointedP3SoId
          && String(openSalesOrders[0].status) === 'confirmed'
          && Number(openSalesOrders[0].location_id) === config.fixtureLocationId
          && Number(openSalesOrders[0].qty_fulfilled) === 0
          && Number(openSalesOrders[0].qty_ordered) === 2
        )
        || (
          Number.isInteger(checkpointedP3SoId)
          && Number(openSalesOrders.length) === 1
          && String(openSalesOrders[0].status) === 'backordered'
          && Number(openSalesOrders[0].location_id) === config.fixtureLocationId
          && Number(openSalesOrders[0].qty_fulfilled) === 0
        )
      );
    const resumableP3Completed = config.action === 'p3'
      && currentState === 'p3_created'
      && checkpointedP3SourceOrder
      && String(checkpointedP3SourceOrder.status) === 'fulfilled'
      && Number(checkpointedP3SourceOrder.qty_fulfilled) === 1;
    const p3CompensationStateAllowed = config.action === 'p3-compensate'
      && ['acknowledged', 'compensation_retry_authorized'].includes(currentState ?? '');
    const resumableP3Compensation = p3CompensationStateAllowed
      && Number.isInteger(checkpointedP3SoId)
      && checkpointedP3SourceOrder
      && String(checkpointedP3SourceOrder.status) === 'fulfilled'
      && Number(checkpointedP3SourceOrder.qty_fulfilled) === 1
      && p3OpenSalesOrdersAreExpected;
    const p4ActionStateAllowed = (config.action === 'p4' && ['preflight_passed', 'p4_created'].includes(currentState ?? ''))
      || (config.action === 'p4-compensate' && ['acknowledged', 'compensation_retry_authorized'].includes(currentState ?? ''));
    const resumableP4Replacement = p4ActionStateAllowed
      && Number.isInteger(checkpointedP4ReplacementSoId)
      && openSalesOrders.some(order =>
        Number(order.id) === checkpointedP4ReplacementSoId
        && ['draft', 'confirmed'].includes(String(order.status))
        && Number(order.customer_id) === config.fixtureCustomerId
        && Number(order.location_id) === config.fixtureLocationId
      );
    const allowP4PreflightCarry = config.action === 'p4' && currentState === 'preflight_passed' && openPurchaseOrders.length === 0;
    const allowP3PreflightCarry = config.action === 'p3' && ['preflight_passed', 'blocked'].includes(currentState ?? '') && openPurchaseOrders.length === 0;
    if (!allowP3PreflightCarry && !allowP4PreflightCarry && ((openSalesOrders.length > 0 && !resumableSalesOrder && !resumableP3Source && !resumableP3Completed && !resumableP3Compensation && !resumableP4Replacement) || (openPurchaseOrders.length > 0 && !resumablePurchaseOrder))) {
      throw new Error('Live E2E blocked: the dedicated fixture variant has open PO or SO work.');
    }

    const initialEvents = appendLiveRunEvent([], 'initialized', {
      runId: config.runId,
      businessId: config.expectedBusinessId,
      imsSchema: config.expectedImsSchema,
      shopifyShop: config.expectedShopifyShop,
      xeroTenantId: config.expectedXeroTenantId,
      fixture: {
        variantId: config.fixtureVariantId,
        sku: config.fixtureSku,
        locationId: config.fixtureLocationId,
        locationName: location.name,
        supplierId: config.fixtureSupplierId,
        supplierName: supplier.name,
        customerId: config.fixtureCustomerId,
        customerName: customer.name,
      },
      baseline: {
        stockRowExisted: !!stock,
        qtyOnHand: Number(stock?.qty_on_hand ?? 0),
        qtyIncoming: Number(stock?.qty_incoming ?? 0),
        qtyCommitted: Number(stock?.qty_committed ?? 0),
      },
      maxDocumentTotal: config.maxDocumentTotal,
    });
    if (config.action === 'preflight') {
      await createManifest(config.runId, initialEvents[0]);
    } else {
      const allowedStates = config.action === 'p1' ? ['preflight_passed', 'p1_created']
        : config.action === 'p1-repair' ? ['awaiting_operator']
        : config.action === 'p1-compensate' ? ['acknowledged', 'compensation_retry_authorized']
        : config.action === 'p2' ? ['preflight_passed', 'p2_created']
        : config.action === 'p2-compensate' ? ['acknowledged', 'compensation_retry_authorized']
        : config.action === 'p3' ? ['preflight_passed', 'p3_created', 'blocked']
        : config.action === 'p3-compensate' ? ['acknowledged', 'compensation_retry_authorized']
        : config.action === 'p4' ? ['preflight_passed', 'p4_created']
        : config.action === 'p4-compensate' ? ['acknowledged', 'compensation_retry_authorized']
          : [];
      if (!allowedStates.includes(currentState ?? '')) {
        throw new Error(`Live E2E blocked: action ${config.action} requires manifest state ${allowedStates.join(' or ') || 'unsupported'}, found ${currentState ?? 'missing'}.`);
      }
    }
    activeConnection = connection;
    activeLockName = lockName;
  } catch (error) {
    if (lockHeld) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    await connection.end().catch(() => {});
    throw error;
  }
}

export async function releaseDatabasePreflightLock(): Promise<void> {
  const connection = activeConnection;
  const lockName = activeLockName;
  activeConnection = null;
  activeLockName = null;
  if (!connection) return;
  if (lockName) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
  await connection.end().catch(() => {});
}

export async function verifyPurchaseOrderCompensation(config: LiveE2EConfig, poId: number): Promise<{
  poStatus: string;
  xeroBillId: string | null;
  stock: { qtyOnHand: number; qtyIncoming: number; qtyCommitted: number };
}> {
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[po]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT status, xero_bill_id FROM ${schema}.ims_purchase_orders WHERE business_id = ? AND id = ? LIMIT 1`,
      [config.expectedBusinessId, poId],
    );
    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ? LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const actual = {
      qtyOnHand: Number(stock?.qty_on_hand),
      qtyIncoming: Number(stock?.qty_incoming),
      qtyCommitted: Number(stock?.qty_committed),
    };
    if (!po || po.status !== 'cancelled') throw new Error('Live E2E blocked: compensated PO is not cancelled.');
    if (actual.qtyOnHand !== Number(baseline.qtyOnHand)
      || actual.qtyIncoming !== Number(baseline.qtyIncoming)
      || actual.qtyCommitted !== Number(baseline.qtyCommitted)) {
      throw new Error('Live E2E blocked: fixture stock did not return to its preflight baseline.');
    }
    return { poStatus: String(po.status), xeroBillId: po.xero_bill_id ? String(po.xero_bill_id) : null, stock: actual };
  } finally {
    await connection.end();
  }
}

export async function verifySalesOrderCompensation(config: LiveE2EConfig, soId: number): Promise<{
  soStatus: string;
  xeroInvoiceId: string | null;
  stock: { qtyOnHand: number; qtyIncoming: number; qtyCommitted: number };
}> {
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[so]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so.status, so.xero_invoice_id, item.qty_fulfilled
         FROM ${schema}.ims_sales_orders so
         JOIN ${schema}.ims_sales_order_items item ON item.so_id = so.id
        WHERE so.business_id = ? AND so.id = ? AND item.variant_id = ? LIMIT 1`,
      [config.expectedBusinessId, soId, config.fixtureVariantId],
    );
    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ? LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const actual = {
      qtyOnHand: Number(stock?.qty_on_hand),
      qtyIncoming: Number(stock?.qty_incoming),
      qtyCommitted: Number(stock?.qty_committed),
    };
    if (!so || so.status !== 'cancelled' || Number(so.qty_fulfilled) !== 0) {
      throw new Error('Live E2E blocked: compensated SO is not cancelled and unfulfilled.');
    }
    if (so.xero_invoice_id) throw new Error('Live E2E blocked: compensated SO still has a Xero invoice link.');
    if (actual.qtyOnHand !== Number(baseline.qtyOnHand)
      || actual.qtyIncoming !== Number(baseline.qtyIncoming)
      || actual.qtyCommitted !== Number(baseline.qtyCommitted)) {
      throw new Error('Live E2E blocked: fixture stock did not return to its preflight baseline.');
    }
    return { soStatus: String(so.status), xeroInvoiceId: null, stock: actual };
  } finally {
    await connection.end();
  }
}

export async function verifySalesOrderAwaitingOperator(config: LiveE2EConfig, soId: number): Promise<{
  soNumber: string;
  xeroInvoiceId: string;
  stock: { qtyOnHand: number; qtyIncoming: number; qtyCommitted: number };
}> {
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[so]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so.so_number, so.status, so.customer_id, so.location_id, so.total_amount,
              so.xero_invoice_id, item.variant_id, item.qty_ordered, item.qty_fulfilled
         FROM ${schema}.ims_sales_orders so
         JOIN ${schema}.ims_sales_order_items item ON item.so_id = so.id
        WHERE so.business_id = ? AND so.id = ? LIMIT 1`,
      [config.expectedBusinessId, soId],
    );
    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ? LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const actual = {
      qtyOnHand: Number(stock?.qty_on_hand),
      qtyIncoming: Number(stock?.qty_incoming),
      qtyCommitted: Number(stock?.qty_committed),
    };
    if (!so || so.status !== 'confirmed'
      || Number(so.customer_id) !== config.fixtureCustomerId
      || Number(so.location_id) !== config.fixtureLocationId
      || String(so.variant_id) !== config.fixtureVariantId
      || Number(so.qty_ordered) !== 1
      || Number(so.qty_fulfilled) !== 0
      || Number(so.total_amount) !== config.maxDocumentTotal
      || !so.xero_invoice_id) {
      throw new Error('Live E2E blocked: confirmed P2 SO does not match the exact low-value fixture contract.');
    }
    if (actual.qtyOnHand !== Number(baseline.qtyOnHand)
      || actual.qtyIncoming !== Number(baseline.qtyIncoming)
      || actual.qtyCommitted !== Number(baseline.qtyCommitted) + 1) {
      throw new Error('Live E2E blocked: confirmed P2 SO did not create the expected isolated commitment.');
    }
    return { soNumber: String(so.so_number), xeroInvoiceId: String(so.xero_invoice_id), stock: actual };
  } finally {
    await connection.end();
  }
}

export async function verifySalesOrderPartialFulfilment(config: LiveE2EConfig, soId: number): Promise<{
  sourceSoNumber: string;
  backorderSoId: number;
  backorderSoNumber: string;
  xeroInvoiceId: string;
  stock: { qtyOnHand: number; qtyIncoming: number; qtyCommitted: number };
}> {
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[source]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so.so_number, so.status, so.xero_invoice_id, item.qty_ordered, item.qty_fulfilled, item.variant_id
         FROM ${schema}.ims_sales_orders so
         JOIN ${schema}.ims_sales_order_items item ON item.so_id = so.id
        WHERE so.business_id = ? AND so.id = ? LIMIT 1`,
      [config.expectedBusinessId, soId],
    );
    const [backorders] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so.id, so.so_number, so.status
         FROM ${schema}.ims_sales_orders so
         JOIN ${schema}.ims_so_backorder_lines bl ON bl.backorder_so_id = so.id
        WHERE bl.business_id = ? AND bl.source_so_id = ?
        ORDER BY so.id DESC`,
      [config.expectedBusinessId, soId],
    );
    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ? LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const actual = {
      qtyOnHand: Number(stock?.qty_on_hand),
      qtyIncoming: Number(stock?.qty_incoming),
      qtyCommitted: Number(stock?.qty_committed),
    };
    const backorder = backorders[0];
    if (!source || source.status !== 'fulfilled' || Number(source.qty_fulfilled) !== 1 || !source.xero_invoice_id) {
      throw new Error('Live E2E blocked: source SO did not finish in the expected fulfilled state.');
    }
    if (!backorder || String(backorder.status) !== 'backordered') {
      throw new Error('Live E2E blocked: backorder child was not created as expected.');
    }
    if (actual.qtyOnHand !== Number(baseline.qtyOnHand) - 1
      || actual.qtyIncoming !== Number(baseline.qtyIncoming)
      || actual.qtyCommitted !== Number(baseline.qtyCommitted) + 1) {
      throw new Error('Live E2E blocked: partial fulfilment did not produce the expected stock balance.');
    }
    return {
      sourceSoNumber: String(source.so_number),
      backorderSoId: Number(backorder.id),
      backorderSoNumber: String(backorder.so_number),
      xeroInvoiceId: String(source.xero_invoice_id),
      stock: actual,
    };
  } finally {
    await connection.end();
  }
}

export async function verifySalesOrderPartialCompensation(config: LiveE2EConfig, soId: number): Promise<{
  sourceSoNumber: string;
  sourceSoStatus: string;
  backorderSoId: number;
  backorderSoStatus: string;
  creditNoteId: number;
  creditNoteNumber: string;
  stock: { qtyOnHand: number; qtyIncoming: number; qtyCommitted: number };
}> {
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[source]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so.so_number, so.status, item.qty_fulfilled
         FROM ${schema}.ims_sales_orders so
         JOIN ${schema}.ims_sales_order_items item ON item.so_id = so.id
        WHERE so.business_id = ? AND so.id = ? LIMIT 1`,
      [config.expectedBusinessId, soId],
    );
    const [backorders] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT bo.id, bo.so_number, bo.status
         FROM ${schema}.ims_sales_orders bo
         JOIN ${schema}.ims_so_backorder_lines bl ON bl.backorder_so_id = bo.id
        WHERE bl.business_id = ? AND bl.source_so_id = ?
        ORDER BY bo.id DESC`,
      [config.expectedBusinessId, soId],
    );
    const [openFixtureOrders] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so.id
         FROM ${schema}.ims_sales_orders so
         JOIN ${schema}.ims_sales_order_items item ON item.so_id = so.id
        WHERE so.business_id = ?
          AND item.variant_id = ?
          AND so.status IN ('draft','confirmed','partially_fulfilled','backordered')`,
      [config.expectedBusinessId, config.fixtureVariantId],
    );
    const [[creditNote]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT cn.id, cn.cn_number, cn.status
         FROM ${schema}.ims_credit_notes cn
         JOIN ${schema}.ims_credit_note_items cni ON cni.cn_id = cn.id
        WHERE cn.business_id = ? AND cn.so_id = ?
          AND cn.status = 'complete'
          AND cni.source_so_item_id IS NOT NULL
        ORDER BY cn.id DESC
        LIMIT 1`,
      [config.expectedBusinessId, soId],
    );
    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ? LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const actual = {
      qtyOnHand: Number(stock?.qty_on_hand),
      qtyIncoming: Number(stock?.qty_incoming),
      qtyCommitted: Number(stock?.qty_committed),
    };
    const backorder = backorders[0];
    if (!source || String(source.status) !== 'fulfilled' || Number(source.qty_fulfilled) !== 1) {
      throw new Error('Live E2E blocked: P3 source SO no longer reflects the fulfilled shipped quantity.');
    }
    if (!backorder || String(backorder.status) !== 'cancelled') {
      throw new Error('Live E2E blocked: P3 backorder child was not cancelled during compensation.');
    }
    if (!creditNote) {
      throw new Error('Live E2E blocked: completed return credit note was not found for P3 compensation.');
    }
    if (openFixtureOrders.length > 0) {
      throw new Error('Live E2E blocked: fixture still has open sales-order work after P3 compensation.');
    }
    if (actual.qtyOnHand !== Number(baseline.qtyOnHand)
      || actual.qtyIncoming !== Number(baseline.qtyIncoming)
      || actual.qtyCommitted !== Number(baseline.qtyCommitted)) {
      throw new Error('Live E2E blocked: P3 compensation did not restore fixture stock to baseline.');
    }
    return {
      sourceSoNumber: String(source.so_number),
      sourceSoStatus: String(source.status),
      backorderSoId: Number(backorder.id),
      backorderSoStatus: String(backorder.status),
      creditNoteId: Number(creditNote.id),
      creditNoteNumber: String(creditNote.cn_number),
      stock: actual,
    };
  } finally {
    await connection.end();
  }
}

export async function verifySalesOrderReplacementDraft(config: LiveE2EConfig, sourceSoId: number, replacementSoId: number): Promise<{
  sourceSoNumber: string;
  replacementSoNumber: string;
  replacementStatus: string;
  stock: { qtyOnHand: number; qtyIncoming: number; qtyCommitted: number };
}> {
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[source]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so_number, status FROM ${schema}.ims_sales_orders
        WHERE business_id = ? AND id = ? LIMIT 1`,
      [config.expectedBusinessId, sourceSoId],
    );
    const [[replacement]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT so_number, status, qty_fulfilled, xero_invoice_id
         FROM ${schema}.ims_sales_orders
        WHERE business_id = ? AND id = ? LIMIT 1`,
      [config.expectedBusinessId, replacementSoId],
    );
    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ? LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const actual = {
      qtyOnHand: Number(stock?.qty_on_hand),
      qtyIncoming: Number(stock?.qty_incoming),
      qtyCommitted: Number(stock?.qty_committed),
    };
    if (!source || String(source.status) !== 'fulfilled') {
      throw new Error('Live E2E blocked: P4 source sales order is not fulfilled.');
    }
    if (!replacement || String(replacement.status) !== 'draft' || Number(replacement.qty_fulfilled) !== 0 || replacement.xero_invoice_id) {
      throw new Error('Live E2E blocked: replacement sales order is not a clean draft.');
    }
    if (actual.qtyOnHand !== Number(baseline.qtyOnHand)
      || actual.qtyIncoming !== Number(baseline.qtyIncoming)
      || actual.qtyCommitted !== Number(baseline.qtyCommitted)) {
      throw new Error('Live E2E blocked: replacement draft creation changed fixture stock unexpectedly.');
    }
    return {
      sourceSoNumber: String(source.so_number),
      replacementSoNumber: String(replacement.so_number),
      replacementStatus: String(replacement.status),
      stock: actual,
    };
  } finally {
    await connection.end();
  }
}

export async function verifySalesOrderReplacementCompensation(config: LiveE2EConfig, replacementSoId: number): Promise<{
  replacementState: 'deleted' | 'cancelled';
  stock: { qtyOnHand: number; qtyIncoming: number; qtyCommitted: number };
}> {
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[replacement]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT status FROM ${schema}.ims_sales_orders
        WHERE business_id = ? AND id = ? LIMIT 1`,
      [config.expectedBusinessId, replacementSoId],
    );
    const [[stock]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ? LIMIT 1`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId],
    );
    const actual = {
      qtyOnHand: Number(stock?.qty_on_hand),
      qtyIncoming: Number(stock?.qty_incoming),
      qtyCommitted: Number(stock?.qty_committed),
    };
    const replacementState = replacement ? (String(replacement.status) === 'cancelled' ? 'cancelled' : null) : 'deleted';
    if (!replacementState) throw new Error('Live E2E blocked: replacement sales order was not deleted or cancelled.');
    if (actual.qtyOnHand !== Number(baseline.qtyOnHand)
      || actual.qtyIncoming !== Number(baseline.qtyIncoming)
      || actual.qtyCommitted !== Number(baseline.qtyCommitted)) {
      throw new Error('Live E2E blocked: replacement compensation did not preserve baseline stock.');
    }
    return { replacementState, stock: actual };
  } finally {
    await connection.end();
  }
}