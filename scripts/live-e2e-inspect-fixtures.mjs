import 'dotenv/config';

import mysql from 'mysql2/promise';

const expectedSchema = process.env.LIVE_E2E_EXPECTED_IMS_SCHEMA?.trim();
if (!expectedSchema) throw new Error('Set LIVE_E2E_EXPECTED_IMS_SCHEMA before inspecting fixtures.');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const exactSku = argument('sku') ?? process.env.LIVE_E2E_FIXTURE_SKU?.trim();
const exactLocationId = Number(argument('location') ?? process.env.LIVE_E2E_FIXTURE_LOCATION_ID) || null;
const exactLocationName = argument('location-name');
const exactSupplierId = Number(argument('supplier') ?? process.env.LIVE_E2E_FIXTURE_SUPPLIER_ID) || null;
const exactSupplierName = argument('supplier-name');
const exactCustomerId = Number(argument('customer') ?? process.env.LIVE_E2E_FIXTURE_CUSTOMER_ID) || null;
const exactCustomerName = argument('customer-name');

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

try {
  const [[business]] = await connection.query(
    `SELECT b.business_id, b.name, b.ims_db_name,
            c.shopify_shop_id, c.xero_tenant_id, c.xero_tenant_name
       FROM businesses b
       LEFT JOIN connections c ON c.business_id = b.business_id
      WHERE b.ims_db_name = ? AND b.deleted_at IS NULL
      LIMIT 1`,
    [expectedSchema],
  );
  if (!business) throw new Error(`No active business maps to ${expectedSchema}.`);

  const schema = connection.escapeId(expectedSchema);
  const [variants] = await connection.query(
    `SELECT v.variant_id, v.sku, p.name AS product_name, p.is_active AS product_active, p.is_online,
            p.is_stock_item, p.shopify_product_id, v.shopify_variant_id,
            v.shopify_inventory_item_id, v.is_active
       FROM ${schema}.ims_product_variants v
       JOIN ${schema}.ims_products p ON p.product_id = v.product_id AND p.business_id = v.business_id
      WHERE v.business_id = ?
        AND (UPPER(COALESCE(v.sku, '')) LIKE '%E2E%' OR UPPER(p.name) LIKE '%E2E TEST%' OR v.sku = ?)
      ORDER BY v.id DESC LIMIT 20`,
    [business.business_id, exactSku ?? ''],
  );
  const [locations] = await connection.query(
    `SELECT id, name, code, is_active, has_pos, has_online, has_wholesale
       FROM ${schema}.ims_locations
      WHERE business_id = ?
        AND (UPPER(name) LIKE '%E2E%' OR UPPER(COALESCE(code, '')) LIKE '%E2E%'
          OR id = ? OR name = ? OR code = ?)
      ORDER BY id DESC LIMIT 20`,
    [business.business_id, exactLocationId ?? 0, exactLocationName ?? '', exactLocationName ?? ''],
  );
  const [contacts] = await connection.query(
    `SELECT id, name, customer_code, type, is_active, shopify_customer_id
       FROM ${schema}.ims_contacts
      WHERE business_id = ? AND (UPPER(name) LIKE '%E2E%' OR id IN (?, ?) OR name IN (?, ?)
        OR customer_code IN (?, ?))
      ORDER BY id DESC LIMIT 20`,
    [business.business_id, exactSupplierId ?? 0, exactCustomerId ?? 0, exactSupplierName ?? '', exactCustomerName ?? '',
      exactSupplierId ? String(exactSupplierId) : '', exactCustomerId ? String(exactCustomerId) : ''],
  );

  let exactStock = [];
  const exactVariant = variants.find(variant => variant.sku === exactSku);
  const exactLocation = locations.find(location => location.id === exactLocationId
    || location.name === exactLocationName || location.code === exactLocationName);
  if (exactVariant && exactLocation) {
    [exactStock] = await connection.query(
      `SELECT variant_id, location_id, qty_on_hand, qty_incoming, qty_committed
         FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
      [business.business_id, exactVariant.variant_id, exactLocation.id],
    );
  }
  let exactOpenOrders = { purchaseOrders: [], salesOrders: [], recentPurchaseOrders: [], xeroLogs: [] };
  if (exactVariant) {
    const [purchaseOrders] = await connection.query(
      `SELECT po.id, po.po_number, po.status, po.location_id, po.total_amount, po.xero_bill_id,
              item.qty_ordered, item.qty_received, po.created_at
         FROM ${schema}.ims_purchase_order_items item
         JOIN ${schema}.ims_purchase_orders po ON po.id = item.po_id
        WHERE po.business_id = ? AND item.variant_id = ?
          AND po.status IN ('draft','confirmed','partially_received','backordered')
        ORDER BY po.id DESC LIMIT 20`,
      [business.business_id, exactVariant.variant_id],
    );
    const [salesOrders] = await connection.query(
      `SELECT so.id, so.so_number, so.status, so.location_id, so.total_amount, so.xero_invoice_id,
              item.qty_ordered, item.qty_fulfilled, so.created_at
         FROM ${schema}.ims_sales_order_items item
         JOIN ${schema}.ims_sales_orders so ON so.id = item.so_id
        WHERE so.business_id = ? AND item.variant_id = ?
          AND so.status IN ('draft','confirmed','partially_fulfilled','backordered')
        ORDER BY so.id DESC LIMIT 20`,
      [business.business_id, exactVariant.variant_id],
    );
    const [recentPurchaseOrders] = await connection.query(
      `SELECT po.id, po.po_number, po.status, po.location_id, po.total_amount, po.xero_bill_id,
              item.qty_ordered, item.qty_received, po.notes, po.created_at
         FROM ${schema}.ims_purchase_order_items item
         JOIN ${schema}.ims_purchase_orders po ON po.id = item.po_id
        WHERE po.business_id = ? AND item.variant_id = ? AND po.notes LIKE 'LIVE E2E %'
        ORDER BY po.id DESC LIMIT 10`,
      [business.business_id, exactVariant.variant_id],
    );
    let xeroLogs = [];
    const recentPoIds = recentPurchaseOrders.map(row => Number(row.id)).filter(Number.isInteger);
    if (recentPoIds.length > 0) {
      const placeholders = recentPoIds.map(() => '?').join(',');
      [xeroLogs] = await connection.query(
        `SELECT reference_id, sync_type, xero_id, status, xero_state, detail, created_at
           FROM xero_sync_log
          WHERE business_id = ? AND reference_id IN (${placeholders})
            AND sync_type IN ('po_bill', 'po_bill_void')
          ORDER BY reference_id, id`,
        [business.business_id, ...recentPoIds],
      );
    }
    exactOpenOrders = { purchaseOrders, salesOrders, recentPurchaseOrders, xeroLogs };
  }

  console.log(JSON.stringify({
    business: {
      businessId: business.business_id,
      name: business.name,
      imsSchema: business.ims_db_name,
      shopifyShop: business.shopify_shop_id,
      xeroTenantId: business.xero_tenant_id,
      xeroTenantName: business.xero_tenant_name,
    },
    candidates: { variants, locations, contacts, exactStock, exactOpenOrders },
  }, null, 2));
} finally {
  await connection.end();
}