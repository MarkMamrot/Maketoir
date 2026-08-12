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
    const [[openWork]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM ${schema}.ims_purchase_order_items item
           JOIN ${schema}.ims_purchase_orders po ON po.id = item.po_id
          WHERE po.business_id = ? AND item.variant_id = ?
            AND po.status IN ('draft','confirmed','partially_received','backordered')) AS open_po_count,
         (SELECT COUNT(*) FROM ${schema}.ims_sales_order_items item
           JOIN ${schema}.ims_sales_orders so ON so.id = item.so_id
          WHERE so.business_id = ? AND item.variant_id = ?
            AND so.status IN ('draft','confirmed','partially_fulfilled','backordered')) AS open_so_count`,
      [config.expectedBusinessId, config.fixtureVariantId, config.expectedBusinessId, config.fixtureVariantId],
    );
    if (Number(openWork.open_po_count) || Number(openWork.open_so_count)) {
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
      const events = await readManifest(config.runId);
      const currentState = events.at(-1)?.state;
      const allowedStates = config.action === 'p1' ? ['preflight_passed', 'p1_created']
        : config.action === 'p1-compensate' ? ['acknowledged']
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
  if (!activeConnection) throw new Error('Live E2E blocked: database preflight lock is not active.');
  const events = await readManifest(config.runId);
  const baseline = (events[0]?.details as any)?.baseline;
  if (!baseline) throw new Error('Live E2E blocked: manifest baseline is missing.');
  const schema = activeConnection.escapeId(config.expectedImsSchema);
  const [[po]] = await activeConnection.query<mysql.RowDataPacket[]>(
    `SELECT status, xero_bill_id FROM ${schema}.ims_purchase_orders WHERE business_id = ? AND id = ? LIMIT 1`,
    [config.expectedBusinessId, poId],
  );
  const [[stock]] = await activeConnection.query<mysql.RowDataPacket[]>(
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
}