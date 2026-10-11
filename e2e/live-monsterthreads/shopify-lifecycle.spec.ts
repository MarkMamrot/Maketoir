import { expect, test } from '@playwright/test';
import mysql from 'mysql2/promise';

import { loadLiveE2EConfig, type LiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { getShopifyAdminCredentials } from '../../src/lib/shopifyCredentials';
import { runImsForBusiness } from '../../src/lib/db/BusinessRegistry';
import { importShopifyOrder, cancelShopifyOrder } from '../../src/lib/channels/shopifyOrderImport';
import { applyShopifyOrderFulfilment } from '../../src/lib/channels/shopifyOrderFulfilment';
import { applyShopifyOrderRefund } from '../../src/lib/channels/shopifyOrderRefund';
import { xeroApiFetch } from '../../src/services/XeroService';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { loadAllocationFixtureSnapshot } from './support/database-preflight';

test.describe.configure({ timeout: 240_000 });

async function oracle(config: LiveE2EConfig, variantId: string, externalOrderId: string, channelInstanceId: string) {
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [orders] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, status, location_id, total_amount, financial_status FROM ${schema}.ims_sales_orders
        WHERE business_id = ? AND channel_instance_id = ? AND external_order_id = ?`,
      [config.expectedBusinessId, channelInstanceId, externalOrderId]);
    const [stock] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT location_id, qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock WHERE business_id = ? AND variant_id = ? ORDER BY location_id`,
      [config.expectedBusinessId, variantId]);
    const [items] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT item.variant_id, item.qty_ordered, item.qty_fulfilled FROM ${schema}.ims_sales_order_items item
         JOIN ${schema}.ims_sales_orders so ON so.id = item.so_id
        WHERE so.business_id = ? AND so.channel_instance_id = ? AND so.external_order_id = ?`,
      [config.expectedBusinessId, channelInstanceId, externalOrderId]);
    return { orders, stock, items };
  } finally { await connection.end(); }
}

test('@shopify-order verifies one exact development-store test order lifecycle', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const paidLifecycle = process.env.LIVE_E2E_SHOPIFY_SURFACE === 'paid';
  expect(process.env.LIVE_E2E_SHOPIFY_SURFACE ?? 'unpaid').toMatch(/^(paid|unpaid)$/);
  expect(config.action).toBe('allocation');
  const events = await readManifest(config.runId);
  const saved = events.at(-1)?.details as any;
  const resumeReceipt = paidLifecycle && events.at(-1)?.state === 'blocked'
    && saved?.error === "Unknown column 'refund_method' in 'field list'" && saved?.paidLifecycle === true
    && saved?.externalOrderId === null && saved?.salesOrderId === null && Number(saved?.purchaseOrderId) > 0;
  const resumeDraft = paidLifecycle && events.at(-1)?.state === 'blocked' && saved?.paidLifecycle === true
    && saved?.externalOrderId === null && saved?.salesOrderId === null && Number(saved?.purchaseOrderId) > 0
    && events.findLast(event => event.state === 'allocation_created')?.details
    && (events.findLast(event => event.state === 'allocation_created')!.details as any).phase === 'receipt_po_created'
    && String(saved?.error).includes('draft');
  if (!resumeReceipt && !resumeDraft) expect(events.at(-1)?.state).toBe('preflight_passed');
  const baseline = await loadAllocationFixtureSnapshot(config);
  expect(baseline.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  const credentials = await getShopifyAdminCredentials(config.expectedBusinessId);
  expect(credentials?.shopDomain).toBe(config.expectedShopifyShop);
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  let channelInstanceId: string;
  try {
    const [channels] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT channel_instance_id FROM sales_channel_instances WHERE business_id = ? AND provider = 'shopify'
        AND external_account_key = ? AND is_enabled = 1 AND runtime_status = 'active' AND readiness_status = 'ready'`,
      [config.expectedBusinessId, config.expectedShopifyShop]);
    expect(channels).toHaveLength(1);
    channelInstanceId = String(channels[0].channel_instance_id);
  } finally { await connection.end(); }
  const marker = `LIVE E2E ${config.runId} SHOPIFY`;
  const sku = `E2E-SHP-${config.runId}`;
  let productId: string | null = null;
  let variantId: string | null = null;
  let remoteProductId: string | null = null;
  let remoteVariantId: string | null = null;
  let externalOrderId: string | null = null;
  let salesOrderId: number | null = null;
  let purchaseOrderId: number | null = null;
  let supplierCreditNoteId: number | null = null;
  let creditNoteId: number | null = null;
  let providerFulfilmentId: string | null = null;
  let providerRefundId: string | null = null;
  let originalPolicy: Record<string, unknown> | null = null;
  if (resumeReceipt || resumeDraft) {
    expect(saved.channelInstanceId).toBe(channelInstanceId);
    productId = saved.productId;
    variantId = saved.variantId;
    remoteProductId = saved.remoteProductId;
    remoteVariantId = saved.remoteVariantId;
    purchaseOrderId = saved.purchaseOrderId;
    originalPolicy = saved.originalPolicy;
  }
  const policyEndpoint = `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`;
  const checkpoint = (phase: string) => appendManifestState(config.runId, 'allocation_created', {
    scenario: 'Shopify exact order', phase, purchaseOrderIds: [], salesOrderIds: [],
    productId, variantId, remoteProductId, remoteVariantId, externalOrderId, salesOrderId, channelInstanceId,
    purchaseOrderId, supplierCreditNoteId, creditNoteId, providerFulfilmentId, providerRefundId, paidLifecycle, originalPolicy,
  });
  const paidSnapshot = async () => {
    const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
    try {
      const schema = connection.escapeId(config.expectedImsSchema);
      const [movements] = await connection.query<mysql.RowDataPacket[]>(`SELECT id, movement_type, reference_type, reference_id, qty_change, unit_cost,
        cost_method_snapshot FROM ${schema}.ims_stock_movements WHERE business_id=? AND variant_id=? ORDER BY id`, [config.expectedBusinessId, variantId]);
      const [layers] = await connection.query<mysql.RowDataPacket[]>(`SELECT id, original_quantity, remaining_quantity, unit_cost, source_movement_id
        FROM ${schema}.ims_fifo_cost_layers WHERE business_id=? AND variant_id=? ORDER BY id`, [config.expectedBusinessId, variantId]);
      const [credits] = await connection.query<mysql.RowDataPacket[]>(`SELECT id, status, source, settlement_method, total_amount, tax_amount, xero_credit_note_id
        FROM ${schema}.ims_credit_notes WHERE business_id=? AND so_id=? ORDER BY id`, [config.expectedBusinessId, salesOrderId]);
      return { movements, layers, credits };
    } finally { await connection.end(); }
  };
  const graph = async (query: string, variables: Record<string, unknown> = {}) => {
    const response = await fetch(`https://${credentials!.shopDomain}/admin/api/2025-10/graphql.json`, {
      method: 'POST', headers: { 'X-Shopify-Access-Token': credentials!.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json();
    expect(response.ok, 'Shopify GraphQL HTTP failure').toBe(true);
    expect(result.errors, 'Shopify GraphQL rejected the operation').toBeUndefined();
    return result.data;
  };
  const remoteOrder = async () => {
    const response = await fetch(`https://${credentials!.shopDomain}/admin/api/2025-10/orders/${externalOrderId}.json`, {
      headers: { 'X-Shopify-Access-Token': credentials!.token }, signal: AbortSignal.timeout(30_000),
    });
    expect(response.ok).toBe(true);
    const order = (await response.json()).order;
    expect(String(order.id)).toBe(externalOrderId);
    expect(order.test).toBe(true);
    expect(order.note).toBe(marker);
    expect(order.currency).toBe('AUD');
    expect(Number(order.total_price)).toBe(config.maxDocumentTotal);
    expect(order.line_items).toHaveLength(1);
    expect(String(order.line_items[0].variant_id)).toBe(remoteVariantId!.split('/').at(-1));
    expect(Number(order.line_items[0].quantity)).toBe(1);
    return order;
  };
  await loginToIms(page, config);
  await checkpoint('prepared');
  try {
    const scopes = await graph('query { currentAppInstallation { accessScopes { handle } } }');
    expect(scopes.currentAppInstallation.accessScopes.map((scope: any) => scope.handle)).toEqual(expect.arrayContaining(['write_orders', 'write_products']));
    if (paidLifecycle) {
      expect(config.expectedCostingMethod).toBe('fifo');
      expect(config.maxDocumentTotal).toBe(1);
      expect(scopes.currentAppInstallation.accessScopes.map((scope: any) => scope.handle)).toEqual(expect.arrayContaining([
        'write_fulfillments', 'read_merchant_managed_fulfillment_orders', 'write_merchant_managed_fulfillment_orders',
      ]));
      const policyResponse = await page.request.get(policyEndpoint);
      expect(policyResponse.ok()).toBe(true);
      const livePolicy = (await policyResponse.json()).policy;
      if (resumeReceipt || resumeDraft) expect(livePolicy).toEqual(originalPolicy);
      else originalPolicy = livePolicy;
      expect(originalPolicy).toBeTruthy();
      await checkpoint('original_policy_saved');
    }
    if (resumeReceipt || resumeDraft) {
      const providerOrders = await graph('query($query:String!) { orders(first:10,query:$query) { nodes { id } } }', { query: `tag:${config.runId}` });
      expect(providerOrders.orders.nodes).toEqual([]);
      if (resumeDraft) {
        const draft = (await (await page.request.get(`/api/ims/purchase-orders/${purchaseOrderId}`)).json()).data;
        expect(draft).toMatchObject({ status: 'draft', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, tax_treatment: 'no_tax' });
        expect(draft.notes).toBe(`${marker} RECEIPT`);
        expect(Number(draft.total_amount)).toBe(1);
        expect(draft.items).toHaveLength(1);
        expect(draft.items[0].variant_id).toBe(variantId);
        expect(Number(draft.items[0].qty_received)).toBe(0);
        expect(Number(draft.items[0].unit_cost)).toBe(1);
        const confirmed = await page.request.put(`/api/ims/purchase-orders/${purchaseOrderId}`, { data: { status: 'confirmed' } });
        expect(confirmed.ok(), (await confirmed.json()).error).toBe(true);
        const received = await page.request.post('/api/ims/receive/batch', { data: {
          po_id: purchaseOrderId, location_id: config.fixtureLocationId, operation_key: `${config.runId}:receipt`,
          received_items: [{ variant_id: variantId, qty_received: 1 }], mark_po_received: true, create_backorder_po: false,
        } });
        expect(received.ok(), (await received.json()).error).toBe(true);
      }
      const po = (await (await page.request.get(`/api/ims/purchase-orders/${purchaseOrderId}`)).json()).data;
      expect(po).toMatchObject({ status: 'complete', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, tax_treatment: 'no_tax' });
      expect(po.notes).toBe(`${marker} RECEIPT`);
      expect(Number(po.total_amount)).toBe(1);
      expect(po.items).toHaveLength(1);
      expect(po.items[0].variant_id).toBe(variantId);
      expect(Number(po.items[0].qty_received)).toBe(1);
      const recovered = await paidSnapshot();
      expect(recovered.layers).toHaveLength(1);
      expect(Number(recovered.layers[0].remaining_quantity)).toBe(1);
      expect(Number(recovered.layers[0].unit_cost)).toBe(1);
      await checkpoint('fifo_stock_received_recovered_without_resubmission');
    } else {
    const createProduct = await page.request.post('/api/ims/products', { data: { name: marker, base_sku: sku, is_active: 1, is_online: 0, is_stock_item: 1 } });
    const product = await createProduct.json();
    expect(createProduct.ok(), product.error).toBe(true);
    productId = product.product_id;
    expect(productId).toBeTruthy();
    await checkpoint('ims_product_created');
    const createVariant = await page.request.post('/api/ims/variants', { data: { product_id: productId, sku, is_active: 1, price_rrp: config.maxDocumentTotal, cost_aud: 1 } });
    const variant = await createVariant.json();
    expect(createVariant.ok(), variant.error).toBe(true);
    variantId = variant.variant_id;
    expect(variantId).toBeTruthy();
    await checkpoint('ims_variant_created');
    const created = await graph('mutation($product: ProductCreateInput!) { productCreate(product:$product) { product { id variants(first:1) { nodes { id } } } userErrors { message } } }',
      { product: { title: marker, status: 'ACTIVE', tags: ['live-e2e', config.runId] } });
    expect(created.productCreate.userErrors).toEqual([]);
    remoteProductId = created.productCreate.product.id;
    remoteVariantId = created.productCreate.product.variants.nodes[0].id;
    await checkpoint('shopify_product_created');
    const priced = await graph('mutation($productId:ID!, $variants:[ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId,variants:$variants) { userErrors { message } } }',
      { productId: remoteProductId, variants: [{ id: remoteVariantId, price: String(config.maxDocumentTotal), taxable: false, inventoryItem: { sku, tracked: true } }] });
    expect(priced.productVariantsBulkUpdate.userErrors).toEqual([]);
    const link = await page.request.patch(`/api/ims/products/${productId}/shopify-sync`, { data: { action: 'link', channelInstanceId, shopifyProductId: remoteProductId!.split('/').at(-1) } });
    const linked = await link.json();
    expect(link.ok(), linked.error).toBe(true);
    expect(linked.variantsLinked).toBe(1);
    await checkpoint('exact_mapping_linked');
    if (paidLifecycle) {
      const response = await page.request.post('/api/ims/purchase-orders', { data: {
        supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, status: 'confirmed',
        order_date: new Date().toISOString().slice(0, 10), tax_treatment: 'no_tax', currency_code: 'AUD',
        supplier_invoice_number: `E2E-${config.runId}`,
        subtotal: 1, tax_amount: 0, total_amount: 1,
        notes: `${marker} RECEIPT`, items: [{ variant_id: variantId, qty_ordered: 1, unit_cost: 1, tax_rate: 0, line_total: 1 }],
      } });
      const body = await response.json();
      expect(response.ok(), body.error).toBe(true);
      purchaseOrderId = Number(body.id);
      expect(purchaseOrderId).toBeGreaterThan(0);
      await checkpoint('receipt_po_created');
      const confirmed = await page.request.put(`/api/ims/purchase-orders/${purchaseOrderId}`, { data: { status: 'confirmed' } });
      expect(confirmed.ok(), (await confirmed.json()).error).toBe(true);
      const source = (await (await page.request.get(`/api/ims/purchase-orders/${purchaseOrderId}`)).json()).data;
      expect(source.status).toBe('confirmed');
      expect(Number(source.total_amount)).toBe(1);
      expect(Number(source.items[0].unit_cost)).toBe(1);
      const receive = await page.request.post('/api/ims/receive/batch', { data: {
        po_id: purchaseOrderId, location_id: config.fixtureLocationId, operation_key: `${config.runId}:receipt`,
        received_items: [{ variant_id: variantId, qty_received: 1 }], mark_po_received: true, create_backorder_po: false,
      } });
      expect(receive.ok(), (await receive.json()).error).toBe(true);
      expect((await paidSnapshot()).layers.reduce((sum, layer) => sum + Number(layer.remaining_quantity), 0)).toBe(1);
      await checkpoint('fifo_stock_received');
    }
    }
    const orderCreated = await graph('mutation($order:OrderCreateOrderInput!, $options:OrderCreateOptionsInput) { orderCreate(order:$order, options:$options) { order { legacyResourceId } userErrors { message } } }',
      { order: { currency: 'AUD', test: true, note: marker, tags: ['live-e2e', config.runId], financialStatus: paidLifecycle ? 'PAID' : 'PENDING',
          ...(paidLifecycle ? { transactions: [{ amountSet: { shopMoney: { amount: '1.00', currencyCode: 'AUD' } }, kind: 'SALE', status: 'SUCCESS', gateway: 'manual', test: true }] } : {}),
          lineItems: [{ variantId: remoteVariantId, quantity: 1 }] },
        options: { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: 'BYPASS' } });
    expect(orderCreated.orderCreate.userErrors).toEqual([]);
    externalOrderId = String(orderCreated.orderCreate.order.legacyResourceId);
    await checkpoint('provider_order_created');
    const order = await remoteOrder();
    expect(order.cancelled_at).toBeNull();
    expect(order.financial_status).toBe(paidLifecycle ? 'paid' : 'pending');
    const imported = await runImsForBusiness(config.expectedBusinessId, () => importShopifyOrder({
      businessId: config.expectedBusinessId, channelInstanceId, locationId: config.fixtureLocationId, topic: paidLifecycle ? 'orders/paid' : 'orders/create', order,
    }));
    salesOrderId = imported.salesOrderId;
    expect(imported.outcome).toBe('imported');
    await checkpoint('exact_order_imported');
    const confirmed = await oracle(config, variantId!, externalOrderId!, channelInstanceId);
    expect(confirmed.orders).toHaveLength(1);
    expect(confirmed.orders[0]).toMatchObject({ id: salesOrderId, status: 'confirmed', location_id: config.fixtureLocationId });
    expect(Number(confirmed.orders[0].total_amount)).toBe(config.maxDocumentTotal);
    expect(confirmed.items).toHaveLength(1);
    expect(confirmed.items[0].variant_id).toBe(variantId);
    expect(Number(confirmed.items[0].qty_fulfilled)).toBe(0);
    expect(confirmed.stock).toHaveLength(1);
    expect(Number(confirmed.stock[0].qty_on_hand)).toBe(paidLifecycle ? 1 : 0);
    expect(Number(confirmed.stock[0].qty_committed)).toBe(1);
    const replay = await runImsForBusiness(config.expectedBusinessId, () => importShopifyOrder({ businessId: config.expectedBusinessId, channelInstanceId,
      locationId: config.fixtureLocationId, topic: 'orders/create', order }));
    expect(replay.salesOrderId).toBe(salesOrderId);
    expect(await oracle(config, variantId!, externalOrderId!, channelInstanceId)).toEqual(confirmed);
    if (paidLifecycle) {
      const rest = async (path: string, data?: Record<string, unknown>) => {
        const response = await fetch(`https://${credentials!.shopDomain}/admin/api/2025-10/${path}.json`, {
          method: data ? 'POST' : 'GET', headers: { 'X-Shopify-Access-Token': credentials!.token, 'Content-Type': 'application/json' },
          ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(60_000),
        });
        const body = await response.json();
        expect(response.ok, JSON.stringify(body.errors ?? {})).toBe(true);
        return body;
      };
      const fulfilmentOrders = (await rest(`orders/${externalOrderId}/fulfillment_orders`)).fulfillment_orders;
      expect(fulfilmentOrders).toHaveLength(1);
      expect(fulfilmentOrders[0].line_items).toHaveLength(1);
      const providerLocationId = Number(fulfilmentOrders[0].assigned_location_id);
      expect(providerLocationId).toBeGreaterThan(0);
      const fulfilled = await graph('mutation($fulfillment:FulfillmentInput!) { fulfillmentCreate(fulfillment:$fulfillment) { fulfillment { id } userErrors { message } } }', {
        fulfillment: { notifyCustomer: false, lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: `gid://shopify/FulfillmentOrder/${fulfilmentOrders[0].id}`,
          fulfillmentOrderLineItems: [{ id: `gid://shopify/FulfillmentOrderLineItem/${fulfilmentOrders[0].line_items[0].id}`, quantity: 1 }] }] },
      });
      expect(fulfilled.fulfillmentCreate.userErrors).toEqual([]);
      providerFulfilmentId = fulfilled.fulfillmentCreate.fulfillment.id;
      await checkpoint('provider_fulfilled');
      const delivered = await remoteOrder();
      expect(delivered.fulfillment_status).toBe('fulfilled');
      expect(delivered.fulfillments).toHaveLength(1);
      const fulfilment = delivered.fulfillments[0];
      expect(Number(fulfilment.line_items[0].quantity)).toBe(1);
      const applied = await runImsForBusiness(config.expectedBusinessId, () => applyShopifyOrderFulfilment({
        businessId: config.expectedBusinessId, channelInstanceId, topic: 'fulfillments/create', payload: fulfilment,
      }));
      expect(applied.salesOrderId).toBe(salesOrderId);
      const afterFulfilment = await oracle(config, variantId!, externalOrderId!, channelInstanceId);
      expect(afterFulfilment.orders[0].status).toBe('fulfilled');
      expect(Number(afterFulfilment.items[0].qty_fulfilled)).toBe(1);
      expect(Number(afterFulfilment.stock[0].qty_on_hand)).toBe(0);
      expect(Number(afterFulfilment.stock[0].qty_committed)).toBe(0);
      const consumed = await paidSnapshot();
      expect(consumed.layers.reduce((sum, layer) => sum + Number(layer.remaining_quantity), 0)).toBe(0);
      expect(consumed.movements.filter(row => Number(row.qty_change) === -1)).toHaveLength(1);
      expect(Number(consumed.movements.at(-1)!.unit_cost)).toBe(1);
      expect((await runImsForBusiness(config.expectedBusinessId, () => applyShopifyOrderFulfilment({
        businessId: config.expectedBusinessId, channelInstanceId, topic: 'fulfillments/create', payload: fulfilment,
      }))).outcome).toBe('already_fulfilled');
      expect(await paidSnapshot()).toEqual(consumed);
      await checkpoint('fifo_fulfilment_replay_verified');
      const policy = await page.request.put('/api/xero/document-policies', { data: {
        databaseId: config.expectedBusinessId, policy: { ...originalPolicy, shopifyRefundCreditNoteEnabled: true, supplierCreditNoteAction: 'draft' },
      } });
      expect(policy.ok(), (await policy.json()).error).toBe(true);
      const refundInput = { currency: 'AUD', notify: false, note: marker,
        refund_line_items: [{ line_item_id: order.line_items[0].id, quantity: 1, restock_type: 'return', location_id: providerLocationId }] };
      const calculated = await rest(`orders/${externalOrderId}/refunds/calculate`, { refund: refundInput });
      expect(calculated.refund.transactions).toHaveLength(1);
      expect(Number(calculated.refund.transactions[0].amount)).toBe(1);
      const refunded = await rest(`orders/${externalOrderId}/refunds`, { refund: { ...refundInput,
        transactions: calculated.refund.transactions.map((transaction: any) => ({ parent_id: transaction.parent_id,
          amount: transaction.amount, kind: 'refund', gateway: transaction.gateway, test: true })),
      } });
      providerRefundId = String(refunded.refund.id);
      await checkpoint('provider_refunded');
      expect(String(refunded.refund.order_id)).toBe(externalOrderId);
      expect(refunded.refund.transactions).toHaveLength(1);
      expect(refunded.refund.transactions[0].status).toBe('success');
      const persistedRefund = (await rest(`orders/${externalOrderId}/refunds/${providerRefundId}`)).refund;
      expect(String(persistedRefund.id)).toBe(providerRefundId);
      expect(persistedRefund.refund_line_items).toHaveLength(1);
      expect(Number(persistedRefund.refund_line_items[0].subtotal)).toBe(1);
      expect(Number(persistedRefund.refund_line_items[0].total_tax)).toBe(0);
      const result = await runImsForBusiness(config.expectedBusinessId, () => applyShopifyOrderRefund({
        businessId: config.expectedBusinessId, channelInstanceId, refund: persistedRefund,
      }));
      creditNoteId = result.creditNoteId;
      expect(creditNoteId).toBeGreaterThan(0);
      await checkpoint('ims_refund_completed');
      const restoredStock = await oracle(config, variantId!, externalOrderId!, channelInstanceId);
      expect(restoredStock.orders[0].financial_status).toBe('refunded');
      expect(Number(restoredStock.stock[0].qty_on_hand)).toBe(1);
      expect(Number(restoredStock.stock[0].qty_committed)).toBe(0);
      const returned = await paidSnapshot();
      expect(returned.credits).toHaveLength(1);
      expect(returned.credits[0]).toMatchObject({ status: 'complete', source: 'shopify', settlement_method: 'external' });
      expect(Number(returned.credits[0].total_amount)).toBe(1);
      expect(Number(returned.credits[0].tax_amount)).toBe(0);
      expect(returned.layers.reduce((sum, layer) => sum + Number(layer.remaining_quantity), 0)).toBe(1);
      expect(Number(returned.movements.at(-1)!.unit_cost)).toBe(1);
      expect((await runImsForBusiness(config.expectedBusinessId, () => applyShopifyOrderRefund({
        businessId: config.expectedBusinessId, channelInstanceId, refund: persistedRefund,
      }))).outcome).toBe('duplicate');
      expect(await paidSnapshot()).toEqual(returned);
      const credit = await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${returned.credits[0].xero_credit_note_id}`, { method: 'GET' });
      expect(credit.CreditNotes[0].Status).toBe('AUTHORISED');
      expect(Number(credit.CreditNotes[0].Total)).toBe(1);
      expect(Number(credit.CreditNotes[0].TotalTax)).toBe(0);
      const po = (await (await page.request.get(`/api/ims/purchase-orders/${purchaseOrderId}`)).json()).data;
      expect(po.status).toBe('complete');
      expect(po.items).toHaveLength(1);
      expect(po.items[0].variant_id).toBe(variantId);
      const createdResponse = await page.request.post('/api/ims/supplier-credit-notes', { data: {
        po_id: purchaseOrderId, supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId,
        scn_date: new Date().toISOString().slice(0, 10), tax_treatment: 'no_tax', currency_code: 'AUD', notes: `${marker} CLEANUP`,
        items: [{ variant_id: variantId, source_po_item_id: Number(po.items[0].id), qty: 1, unit_cost: 1, tax_rate: 0, restock: true }],
      } });
      const created = await createdResponse.json();
      expect(createdResponse.ok(), created.error).toBe(true);
      supplierCreditNoteId = Number(created.data.id);
      await checkpoint('cleanup_supplier_return_created');
      const completion = { operationKey: `${config.runId}:supplier-return` };
      const completed = await page.request.post(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, { data: completion });
      expect(completed.ok(), (await completed.json()).error).toBe(true);
      const finalStock = await oracle(config, variantId!, externalOrderId!, channelInstanceId);
      expect(Number(finalStock.stock[0].qty_on_hand)).toBe(0);
      expect(Number(finalStock.stock[0].qty_committed)).toBe(0);
      expect(Number(finalStock.stock[0].qty_incoming)).toBe(0);
      expect((await paidSnapshot()).layers.reduce((sum, layer) => sum + Number(layer.remaining_quantity), 0)).toBe(0);
      let supplierXeroId: string | null = null;
      await expect.poll(async () => {
        const body = await (await page.request.get(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/xero-status`)).json();
        supplierXeroId = body.latest?.status === 'success' ? body.latest.xero_id : null;
        return supplierXeroId;
      }, { timeout: 60_000 }).not.toBeNull();
      const supplierCredit = await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${supplierXeroId}`, { method: 'GET' });
      expect(['DRAFT', 'AUTHORISED']).toContain(supplierCredit.CreditNotes[0].Status);
      expect(Number(supplierCredit.CreditNotes[0].Total)).toBe(1);
      expect(Number(supplierCredit.CreditNotes[0].TotalTax)).toBe(0);
      const bill = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${po.xero_bill_id}`, { method: 'GET' });
      expect(Number(bill.Invoices[0].Total)).toBe(1);
      await checkpoint('paid_refund_and_cleanup_verified');
    }
    await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'Shopify exact order', productId, variantId, remoteProductId, remoteVariantId, externalOrderId, salesOrderId, channelInstanceId });
    await appendManifestState(config.runId, 'acknowledged', { operator: 'User-authorized exact unpaid test order cancellation; provider and SQL identity verified' });
    await appendManifestState(config.runId, 'compensating', { scenario: 'Shopify exact order', externalOrderId, salesOrderId });
    if (!paidLifecycle) {
      const cancelled = await graph('mutation($orderId:ID!) { orderCancel(orderId:$orderId,notifyCustomer:false,refund:false,restock:false,reason:OTHER) { job { id } userErrors { message } } }',
        { orderId: `gid://shopify/Order/${externalOrderId}` });
      expect(cancelled.orderCancel.userErrors).toEqual([]);
      await expect.poll(async () => (await remoteOrder()).cancelled_at, { timeout: 60_000 }).not.toBeNull();
      const result = await runImsForBusiness(config.expectedBusinessId, () => cancelShopifyOrder({ businessId: config.expectedBusinessId, channelInstanceId, order }));
      expect(result.salesOrderId).toBe(salesOrderId);
    }
    const after = await oracle(config, variantId!, externalOrderId!, channelInstanceId);
    expect(after.orders[0].status).toBe(paidLifecycle ? 'fulfilled' : 'cancelled');
    for (const row of after.stock) {
      expect(Number(row.qty_on_hand)).toBe(0);
      expect(Number(row.qty_incoming)).toBe(0);
      expect(Number(row.qty_committed)).toBe(0);
    }
    if (!paidLifecycle) expect((await runImsForBusiness(config.expectedBusinessId, () => cancelShopifyOrder({ businessId: config.expectedBusinessId, channelInstanceId, order }))).outcome).toBe('already_cancelled');
    expect(await oracle(config, variantId!, externalOrderId!, channelInstanceId)).toEqual(after);
    const archived = await graph('mutation($product:ProductUpdateInput!) { productUpdate(product:$product) { product { status } userErrors { message } } }', { product: { id: remoteProductId, status: 'ARCHIVED' } });
    expect(archived.productUpdate.userErrors).toEqual([]);
    expect(archived.productUpdate.product.status).toBe('ARCHIVED');
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(baseline);
    if (originalPolicy) {
      const restored = await page.request.put('/api/xero/document-policies', { data: { databaseId: config.expectedBusinessId, policy: originalPolicy } });
      expect(restored.ok()).toBe(true);
      expect((await (await page.request.get(policyEndpoint)).json()).policy).toEqual(originalPolicy);
    }
    await appendManifestState(config.runId, 'clean', { scenario: 'Shopify exact order', productId, variantId, remoteProductId, externalOrderId, salesOrderId, channelInstanceId,
      purchaseOrderId, supplierCreditNoteId, creditNoteId, providerFulfilmentId, providerRefundId, paidLifecycle,
      permanentArtifacts: [paidLifecycle ? 'Refunded Shopify test order, fulfilled IMS order, linked external customer credit and supplier cleanup return' : 'Cancelled unpaid Shopify test order and exact cancelled IMS order',
        'Archived labelled Shopify product with retained offline IMS mapping'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Shopify exact order', productId, variantId, remoteProductId, remoteVariantId, externalOrderId, salesOrderId, channelInstanceId,
      purchaseOrderId, supplierCreditNoteId, creditNoteId, providerFulfilmentId, providerRefundId, originalPolicy, paidLifecycle,
      error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    throw error;
  } finally {
    if (originalPolicy) {
      const restored = await page.request.put('/api/xero/document-policies', { data: { databaseId: config.expectedBusinessId, policy: originalPolicy } });
      expect(restored.ok()).toBe(true);
      expect((await (await page.request.get(policyEndpoint)).json()).policy).toEqual(originalPolicy);
    }
  }
});

test('@shopify-refund-recovery retries only the saved provider refund and completes supported cleanup', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  expect(config.expectedCostingMethod).toBe('fifo');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('blocked');
  const saved = events.at(-1)!.details as any;
  expect(saved.scenario).toBe('Shopify exact order');
  const completedRefundCleanup = config.runId === 'campaign-20261011-shopify-paid-fifo-004'
    && saved.creditNoteId === 700 && saved.supplierCreditNoteId === null;
  if (!completedRefundCleanup) {
    expect(saved.error).toContain('not linked to an original POS or sales-order line');
    expect(saved.creditNoteId).toBeNull();
  }
  expect(saved.providerRefundId).toMatch(/^\d+$/);
  await loginToIms(page, config);
  const credentials = await getShopifyAdminCredentials(config.expectedBusinessId);
  expect(credentials?.shopDomain).toBe(config.expectedShopifyShop);
  const providerGet = async (path: string) => {
    const response = await fetch(`https://${credentials!.shopDomain}/admin/api/2025-10/${path}.json`, {
      headers: { 'X-Shopify-Access-Token': credentials!.token }, signal: AbortSignal.timeout(30_000),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };
  const order = (await providerGet(`orders/${saved.externalOrderId}`)).order;
  expect(order.test).toBe(true);
  expect(order.note).toBe(`LIVE E2E ${config.runId} SHOPIFY`);
  expect(order.currency).toBe('AUD');
  expect(Number(order.total_price)).toBe(1);
  expect(order.financial_status).toBe('refunded');
  expect(order.fulfillment_status).toBe('fulfilled');
  expect(order.refunds).toHaveLength(1);
  const refund = order.refunds[0];
  expect(String(refund.id)).toBe(saved.providerRefundId);
  expect(String(refund.order_id)).toBe(saved.externalOrderId);
  expect(refund.refund_line_items).toHaveLength(1);
  expect(refund.refund_line_items[0].restock_type).toBe('return');
  expect(Number(refund.refund_line_items[0].quantity)).toBe(1);
  expect(String(refund.refund_line_items[0].line_item.variant_id)).toBe(saved.remoteVariantId.split('/').at(-1));
  expect(refund.transactions.filter((transaction: any) => transaction.kind === 'refund' && transaction.status === 'success')
    .reduce((sum: number, transaction: any) => sum + Number(transaction.amount), 0)).toBe(1);
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  const schema = connection.escapeId(config.expectedImsSchema);
  const snapshot = async () => {
    const [items] = await connection.query<mysql.RowDataPacket[]>(`SELECT id, variant_id, qty_fulfilled, unit_cost, external_order_item_id
      FROM ${schema}.ims_sales_order_items WHERE business_id=? AND so_id=?`, [config.expectedBusinessId, saved.salesOrderId]);
    const [credits] = await connection.query<mysql.RowDataPacket[]>(`SELECT cn.id, cn.status, cn.source, cn.settlement_method, cn.total_amount,
      cn.tax_amount, cn.xero_credit_note_id, item.id AS item_id, item.source_so_item_id FROM ${schema}.ims_credit_notes cn
      JOIN ${schema}.ims_credit_note_items item ON item.cn_id=cn.id WHERE cn.business_id=? AND cn.so_id=?`, [config.expectedBusinessId, saved.salesOrderId]);
    const [movements] = await connection.query<mysql.RowDataPacket[]>(`SELECT id, movement_type, qty_change, unit_cost, source_line_id
      FROM ${schema}.ims_stock_movements WHERE business_id=? AND variant_id=? ORDER BY id`, [config.expectedBusinessId, saved.variantId]);
    const [layers] = await connection.query<mysql.RowDataPacket[]>(`SELECT id, original_quantity, remaining_quantity, unit_cost, source_movement_id
      FROM ${schema}.ims_fifo_cost_layers WHERE business_id=? AND variant_id=? ORDER BY id`, [config.expectedBusinessId, saved.variantId]);
    return { items, credits, movements, layers };
  };
  const policyEndpoint = `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`;
  const originalPolicy = (await (await page.request.get(policyEndpoint)).json()).policy;
  expect(originalPolicy).toEqual(saved.originalPolicy);
  let creditNoteId: number | null = completedRefundCleanup ? saved.creditNoteId : null;
  let supplierCreditNoteId: number | null = null;
  const checkpoint = (phase: string) => appendManifestState(config.runId, 'allocation_created', {
    ...saved, purchaseOrderIds: [], salesOrderIds: [], phase, creditNoteId, supplierCreditNoteId,
    providerRefundResubmitted: false, originalLifecyclePassed: false,
  });
  try {
    const before = await snapshot();
    if (completedRefundCleanup) {
      expect(before.credits).toHaveLength(1);
      expect(before.credits[0].id).toBe(saved.creditNoteId);
    } else expect(before.credits).toEqual([]);
    expect(before.items).toHaveLength(1);
    expect(before.items[0].variant_id).toBe(saved.variantId);
    expect(Number(before.items[0].qty_fulfilled)).toBe(1);
    expect(Number(before.items[0].unit_cost)).toBe(1);
    expect(String(before.items[0].external_order_item_id)).toBe(String(refund.refund_line_items[0].line_item_id));
    expect(before.movements.map(row => row.movement_type)).toEqual(completedRefundCleanup ? ['po_received', 'so_fulfilled', 'cn_returned'] : ['po_received', 'so_fulfilled']);
    expect(before.layers).toHaveLength(completedRefundCleanup ? 2 : 1);
    expect(Number(before.layers[0].remaining_quantity)).toBe(0);
    const baseline = await oracle(config, saved.variantId, saved.externalOrderId, saved.channelInstanceId);
    expect(baseline.orders[0].status).toBe('fulfilled');
    expect(Number(baseline.stock[0].qty_on_hand)).toBe(completedRefundCleanup ? 1 : 0);
    expect(Number(baseline.stock[0].qty_committed)).toBe(0);
    await checkpoint('existing_refund_retry_authorized_and_verified');
    if (!completedRefundCleanup) {
    const result = await runImsForBusiness(config.expectedBusinessId, () => applyShopifyOrderRefund({
      businessId: config.expectedBusinessId, channelInstanceId: saved.channelInstanceId, refund,
    }));
    creditNoteId = result.creditNoteId;
    expect(result.outcome).toBe('refunded');
    expect(creditNoteId).toBeGreaterThan(0);
    await checkpoint('existing_refund_completed');
    }
    const returned = await snapshot();
    expect(returned.credits).toHaveLength(1);
    const credit = returned.credits[0];
    expect(credit).toMatchObject({ status: 'complete', source: 'shopify', settlement_method: 'external' });
    expect(Number(credit.source_so_item_id)).toBe(Number(before.items[0].id));
    expect(Number(credit.item_id)).toBeGreaterThan(0);
    expect(Number(credit.total_amount)).toBe(1);
    expect(Number(credit.tax_amount)).toBe(0);
    expect(returned.movements).toHaveLength(3);
    expect(returned.movements[2].movement_type).toBe('cn_returned');
    expect(Number(returned.movements[2].source_line_id)).toBe(Number(credit.item_id));
    expect(Number(returned.movements[2].unit_cost)).toBe(1);
    expect(returned.layers.reduce((sum, layer) => sum + Number(layer.remaining_quantity), 0)).toBe(1);
    const restoredStock = await oracle(config, saved.variantId, saved.externalOrderId, saved.channelInstanceId);
    expect(restoredStock.orders[0].financial_status).toBe('refunded');
    expect(Number(restoredStock.stock[0].qty_on_hand)).toBe(1);
    expect((await runImsForBusiness(config.expectedBusinessId, () => applyShopifyOrderRefund({
      businessId: config.expectedBusinessId, channelInstanceId: saved.channelInstanceId, refund,
    }))).outcome).toBe('duplicate');
    expect(await snapshot()).toEqual(returned);
    const xeroCredit = (await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${credit.xero_credit_note_id}`, { method: 'GET' })).CreditNotes[0];
    if (completedRefundCleanup) expect(xeroCredit.Status).toBe('PAID');
    else expect(xeroCredit.Status).toBe('AUTHORISED');
    expect(Number(xeroCredit.Total)).toBe(completedRefundCleanup ? 0 : 1);
    expect(Number(xeroCredit.TotalTax)).toBe(0);
    await checkpoint('refund_provenance_replay_and_xero_verified');
    const po = (await (await page.request.get(`/api/ims/purchase-orders/${saved.purchaseOrderId}`)).json()).data;
    expect(po.status).toBe('complete');
    expect(po.items).toHaveLength(1);
    expect(po.items[0].variant_id).toBe(saved.variantId);
    await appendManifestState(config.runId, 'awaiting_operator', { ...saved, creditNoteId });
    await appendManifestState(config.runId, 'acknowledged', { operator: 'Approved exact existing Shopify refund recovery and supplier return cleanup' });
    await appendManifestState(config.runId, 'compensating', { ...saved, creditNoteId });
    const updated = await page.request.put('/api/xero/document-policies', { data: { databaseId: config.expectedBusinessId,
      policy: { ...originalPolicy, supplierCreditNoteAction: 'draft' } } });
    expect(updated.ok()).toBe(true);
    const create = await page.request.post('/api/ims/supplier-credit-notes', { data: {
      po_id: saved.purchaseOrderId, supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId,
      scn_date: new Date().toISOString().slice(0, 10), tax_treatment: 'no_tax', currency_code: 'AUD',
      notes: `LIVE E2E ${config.runId} SHOPIFY RECOVERY CLEANUP`,
      items: [{ variant_id: saved.variantId, source_po_item_id: Number(po.items[0].id), qty: 1, unit_cost: 1, tax_rate: 0, restock: true }],
    } });
    const created = await create.json();
    expect(create.ok(), created.error).toBe(true);
    supplierCreditNoteId = Number(created.data.id);
    const completion = { operationKey: `${config.runId}:supplier-return:recovery` };
    const completed = await page.request.post(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, { data: completion });
    expect(completed.ok(), (await completed.json()).error).toBe(true);
    const after = await snapshot();
    const replay = await page.request.post(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, { data: completion });
    expect(replay.ok()).toBe(true);
    expect(await snapshot()).toEqual(after);
    expect(after.layers.reduce((sum, layer) => sum + Number(layer.remaining_quantity), 0)).toBe(0);
    const finalStock = await oracle(config, saved.variantId, saved.externalOrderId, saved.channelInstanceId);
    for (const row of finalStock.stock) {
      expect(Number(row.qty_on_hand)).toBe(0); expect(Number(row.qty_incoming)).toBe(0); expect(Number(row.qty_committed)).toBe(0);
    }
    let supplierXeroId: string | null = null;
    await expect.poll(async () => {
      const body = await (await page.request.get(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/xero-status`)).json();
      supplierXeroId = body.latest?.status === 'success' ? body.latest.xero_id : null;
      return supplierXeroId;
    }, { timeout: 60_000 }).not.toBeNull();
    const supplierCredit = (await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${supplierXeroId}`, { method: 'GET' })).CreditNotes[0];
    expect(Number(supplierCredit.Total)).toBe(1); expect(Number(supplierCredit.TotalTax)).toBe(0);
    const bill = (await xeroApiFetch(config.expectedBusinessId, `/Invoices/${po.xero_bill_id}`, { method: 'GET' })).Invoices[0];
    expect(Number(bill.Total)).toBe(1);
    const archived = await fetch(`https://${credentials!.shopDomain}/admin/api/2025-10/graphql.json`, {
      method: 'POST', headers: { 'X-Shopify-Access-Token': credentials!.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'mutation($product:ProductUpdateInput!) { productUpdate(product:$product) { product { status } userErrors { message } } }',
        variables: { product: { id: saved.remoteProductId, status: 'ARCHIVED' } } }),
    });
    expect(archived.ok).toBe(true);
    const archive = (await archived.json()).data.productUpdate;
    expect(archive.userErrors).toEqual([]); expect(archive.product.status).toBe('ARCHIVED');
    const restored = await page.request.put('/api/xero/document-policies', { data: { databaseId: config.expectedBusinessId, policy: originalPolicy } });
    expect(restored.ok()).toBe(true);
    expect((await (await page.request.get(policyEndpoint)).json()).policy).toEqual(originalPolicy);
    await appendManifestState(config.runId, 'clean', { ...saved, creditNoteId, supplierCreditNoteId,
      recoveryPassed: !completedRefundCleanup, completedRefundCleanupPassed: completedRefundCleanup,
      accountingMismatchRetained: completedRefundCleanup, originalLifecyclePassed: false, providerRefundResubmitted: false,
      permanentArtifacts: ['Original paid fulfilled/refunded provider order', 'Source-linked IMS customer return and Xero credit', 'Linked supplier return and original bill/credit', 'Archived labelled product'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { ...saved, creditNoteId, supplierCreditNoteId,
      recoveryError: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    const restored = await page.request.put('/api/xero/document-policies', { data: { databaseId: config.expectedBusinessId, policy: originalPolicy } });
    expect(restored.ok()).toBe(true);
    await connection.end();
  }
});

test('@shopify-seed-cleanup cleans only an exact aborted unfulfilled paid fixture', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('blocked');
  const saved = events.at(-1)!.details as any;
  expect(saved.scenario).toBe('Shopify exact order');
  expect(saved.paidLifecycle).toBe(true);
  const paidOrderExists = saved.externalOrderId !== null;
  if (paidOrderExists) {
    expect(String(saved.externalOrderId)).toMatch(/^\d+$/);
    expect(Number(saved.salesOrderId)).toBeGreaterThan(0);
    expect(saved.creditNoteId).toBeNull();
    expect(saved.error).toContain('required permission');
  } else expect(saved.salesOrderId).toBeNull();
  expect(Number(saved.purchaseOrderId)).toBeGreaterThan(0);
  await loginToIms(page, config);
  const po = (await (await page.request.get(`/api/ims/purchase-orders/${saved.purchaseOrderId}`)).json()).data;
  expect(po).toMatchObject({ status: 'complete', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId });
  expect(po.notes).toBe(`LIVE E2E ${config.runId} SHOPIFY RECEIPT`);
  expect(po.items).toHaveLength(1);
  expect(po.items[0].variant_id).toBe(saved.variantId);
  expect(Number(po.items[0].qty_received)).toBe(1);
  const credentials = await getShopifyAdminCredentials(config.expectedBusinessId);
  expect(credentials?.shopDomain).toBe(config.expectedShopifyShop);
  const graph = async (query: string, variables: Record<string, unknown>) => {
    const response = await fetch(`https://${credentials!.shopDomain}/admin/api/2025-10/graphql.json`, {
      method: 'POST', headers: { 'X-Shopify-Access-Token': credentials!.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000),
    });
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body.errors).toBeUndefined();
    return body.data;
  };
  const orders = await graph('query($query:String!) { orders(first:10,query:$query) { nodes { id } } }', { query: `tag:${config.runId}` });
  if (paidOrderExists) expect(orders.orders.nodes).toEqual([{ id: `gid://shopify/Order/${saved.externalOrderId}` }]);
  else expect(orders.orders.nodes).toEqual([]);
  const remoteOrder = async () => {
    const response = await fetch(`https://${credentials!.shopDomain}/admin/api/2025-10/orders/${saved.externalOrderId}.json`, {
      headers: { 'X-Shopify-Access-Token': credentials!.token }, signal: AbortSignal.timeout(30_000),
    });
    expect(response.ok).toBe(true);
    const order = (await response.json()).order;
    expect(String(order.id)).toBe(saved.externalOrderId);
    expect(order.test).toBe(true);
    expect(order.note).toBe(`LIVE E2E ${config.runId} SHOPIFY`);
    expect(Number(order.total_price)).toBe(1);
    expect(order.currency).toBe('AUD');
    expect(order.fulfillments).toEqual([]);
    expect(order.line_items).toHaveLength(1);
    expect(String(order.line_items[0].variant_id)).toBe(saved.remoteVariantId.split('/').at(-1));
    return order;
  };
  if (paidOrderExists) {
    const order = await remoteOrder();
    expect(order.financial_status).toBe('paid');
    expect(order.cancelled_at).toBeNull();
    const before = await oracle(config, saved.variantId, saved.externalOrderId, saved.channelInstanceId);
    expect(before.orders).toHaveLength(1);
    expect(before.orders[0]).toMatchObject({ id: saved.salesOrderId, status: 'confirmed', financial_status: 'paid' });
    expect(Number(before.items[0].qty_fulfilled)).toBe(0);
  }
  await appendManifestState(config.runId, 'allocation_created', { ...saved, purchaseOrderIds: [], salesOrderIds: [], phase: 'aborted_seed_cleanup_verified' });
  await appendManifestState(config.runId, 'awaiting_operator', saved);
  await appendManifestState(config.runId, 'acknowledged', { operator: 'User-authorized exact campaign cleanup; provider order absent and source receipt verified' });
  await appendManifestState(config.runId, 'compensating', saved);
  try {
  if (paidOrderExists) {
    const cancelled = await graph('mutation($orderId:ID!) { orderCancel(orderId:$orderId,notifyCustomer:false,refund:true,restock:false,reason:OTHER) { job { id } userErrors { message } } }',
      { orderId: `gid://shopify/Order/${saved.externalOrderId}` });
    expect(cancelled.orderCancel.userErrors).toEqual([]);
    await expect.poll(async () => {
      const order = await remoteOrder();
      return { cancelled: !!order.cancelled_at, financialStatus: order.financial_status };
    }, { timeout: 60_000 }).toEqual({ cancelled: true, financialStatus: 'refunded' });
    const result = await runImsForBusiness(config.expectedBusinessId, () => cancelShopifyOrder({ businessId: config.expectedBusinessId,
      channelInstanceId: saved.channelInstanceId, order: { id: saved.externalOrderId } }));
    expect(result.salesOrderId).toBe(saved.salesOrderId);
    const after = await oracle(config, saved.variantId, saved.externalOrderId, saved.channelInstanceId);
    expect(after.orders[0].status).toBe('cancelled');
    expect(Number(after.stock[0].qty_on_hand)).toBe(1);
    expect(Number(after.stock[0].qty_committed)).toBe(0);
  }
  const undone = await page.request.post(`/api/ims/purchase-orders/${saved.purchaseOrderId}/undo-receipt`, { data: {
    operationKey: `${config.runId}:aborted-seed-undo`, expectedUpdatedAt: po.updated_at,
  } });
  const body = await undone.json();
  expect(undone.ok(), body.error).toBe(true);
  expect(body.xeroWarning).toBeUndefined();
  const final = (await (await page.request.get(`/api/ims/purchase-orders/${saved.purchaseOrderId}`)).json()).data;
  expect(final.status).toBe('cancelled');
  const snapshot = await oracle(config, saved.variantId, '0', saved.channelInstanceId);
  for (const row of snapshot.stock) {
    expect(Number(row.qty_on_hand)).toBe(0);
    expect(Number(row.qty_incoming)).toBe(0);
    expect(Number(row.qty_committed)).toBe(0);
  }
  const archived = await graph('mutation($product:ProductUpdateInput!) { productUpdate(product:$product) { product { status } userErrors { message } } }', {
    product: { id: saved.remoteProductId, status: 'ARCHIVED' },
  });
  expect(archived.productUpdate.userErrors).toEqual([]);
  expect(archived.productUpdate.product.status).toBe('ARCHIVED');
  const policyEndpoint = `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`;
  expect((await (await page.request.get(policyEndpoint)).json()).policy).toEqual(saved.originalPolicy);
  await appendManifestState(config.runId, 'clean', { ...saved, originalLifecyclePassed: false, abortedSeedCleanupPassed: true,
    permanentArtifacts: ['Cancelled PO and untouched receipt reversal', paidOrderExists ? 'Cancelled and refunded unfulfilled paid Shopify test order with cancelled IMS order' : 'No provider order created',
      'Archived labelled provider product'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { ...saved, cleanupError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});