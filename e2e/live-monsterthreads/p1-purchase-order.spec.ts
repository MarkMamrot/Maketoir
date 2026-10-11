import { expect, test } from '@playwright/test';
import mysql from 'mysql2/promise';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { xeroApiFetch } from '../../src/services/XeroService';
import { loginToIms } from './support/auth';
import { verifyLiveFifoIntegrity } from './support/fifo-database';
import { appendManifestState, readManifest } from './support/manifest-store';
import { loadAllocationFixtureSnapshot, verifyPurchaseOrderCompensation, verifyPurchaseOrderReceipt } from './support/database-preflight';

test.describe.configure({ timeout: 120_000 });

async function openPurchaseOrders(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('ims-nav-__purchasing').click();
  await page.getByTestId('ims-nav-purchase-orders').click();
}

function purchaseOrderId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.purchaseOrderId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P1 purchase order ID.');
}

test('@branch-round-trip preserves FIFO cost across TEST and Warehouse Branch', async ({ page }) => {
  test.setTimeout(300_000);
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('build');
  expect(config.expectedCostingMethod).toBe('fifo');
  expect(process.env.LIVE_E2E_SECOND_LOCATION_NAME).toBe('Warehouse Branch');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('awaiting_operator');
  const source = events.at(-1)!.details as any;
  expect(source.scenario).toBe('P1');
  await loginToIms(page, config);
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  const schema = connection.escapeId(config.expectedImsSchema);
  const transferIds: number[] = [];
  let secondLocationId: number | null = null;
  let supplierCreditNoteId: number | null = null;
  const policyEndpoint = `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`;
  const policyResponse = await page.request.get(policyEndpoint);
  expect(policyResponse.ok()).toBe(true);
  const originalPolicy = (await policyResponse.json()).policy;
  const command = async (endpoint: string, data: unknown, method: 'post' | 'put' = 'put') => {
    const response = await page.request[method](endpoint, { data });
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    expect(body.success, body.error).toBe(true);
    return body;
  };
  const checkpoint = (phase: string) => appendManifestState(config.runId, 'awaiting_operator', {
    ...source, scenario: 'Warehouse branch round trip', phase, secondLocationId, transferIds: [...transferIds], supplierCreditNoteId, originalPolicy,
  });
  const snapshot = async () => {
    const [stock] = await connection.query<mysql.RowDataPacket[]>(`SELECT location_id,qty_on_hand,qty_incoming,qty_committed FROM ${schema}.ims_stock
      WHERE business_id=? AND variant_id=? AND location_id IN (?,?) ORDER BY location_id`, [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId, secondLocationId]);
    const [layers] = await connection.query<mysql.RowDataPacket[]>(`SELECT id,location_id,remaining_quantity,unit_cost,parent_layer_id,source_reference_type,source_reference_id
      FROM ${schema}.ims_fifo_cost_layers WHERE business_id=? AND variant_id=? AND location_id IN (?,?) ORDER BY id`, [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId, secondLocationId]);
    const [movements] = await connection.query<mysql.RowDataPacket[]>(`SELECT id,location_id,qty_change,unit_cost,reference_type,reference_id FROM ${schema}.ims_stock_movements
      WHERE business_id=? AND variant_id=? AND location_id IN (?,?) ORDER BY id`, [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId, secondLocationId]);
    return { stock, layers, movements };
  };
  const quantities = async (testQuantity: number, warehouseQuantity: number, testCommitted = 0, warehouseCommitted = 0) => {
    const state = await snapshot();
    for (const [locationId, quantity, committed] of [[config.fixtureLocationId, testQuantity, testCommitted], [secondLocationId, warehouseQuantity, warehouseCommitted]]) {
      const row = state.stock.find(row => Number(row.location_id) === locationId);
      expect([row?.qty_on_hand ?? 0, row?.qty_incoming ?? 0, row?.qty_committed ?? 0].map(Number)).toEqual([quantity, 0, committed]);
      const layers = state.layers.filter(layer => Number(layer.location_id) === locationId && Number(layer.remaining_quantity) > 0);
      expect(layers.reduce((sum, layer) => sum + Number(layer.remaining_quantity), 0)).toBe(quantity);
      expect(layers.every(layer => Number(layer.unit_cost) === config.maxDocumentTotal)).toBe(true);
    }
    return state;
  };
  try {
    const [locations] = await connection.query<mysql.RowDataPacket[]>(`SELECT id,name FROM ${schema}.ims_locations WHERE business_id=? AND is_active=1 AND name=?`, [config.expectedBusinessId, 'Warehouse Branch']);
    expect(locations).toHaveLength(1);
    secondLocationId = Number(locations[0].id);
    expect(secondLocationId).not.toBe(config.fixtureLocationId);
    await quantities(1, 0);
    const poResponse = await page.request.get(`/api/ims/purchase-orders/${source.purchaseOrderId}`);
    expect(poResponse.ok()).toBe(true);
    const po = (await poResponse.json()).data;
    expect(po.status).toBe('complete');
    expect(po.location_id).toBe(config.fixtureLocationId);
    expect(po.notes).toContain(`LIVE E2E ${config.runId} P1`);
    expect(Number(po.total_amount)).toBe(config.maxDocumentTotal);
    expect(po.items).toHaveLength(1);
    expect(po.items[0].variant_id).toBe(config.fixtureVariantId);
    await checkpoint('two_location_baseline_verified');
    for (const direction of ['outbound', 'return'] as const) {
      const outbound = direction === 'outbound';
      const created = await command('/api/ims/branch-transfers', {
        from_location_id: outbound ? config.fixtureLocationId : secondLocationId,
        to_location_id: outbound ? secondLocationId : config.fixtureLocationId,
        transfer_date: new Date().toISOString().slice(0, 10), notes: `LIVE E2E ${config.runId} ${direction.toUpperCase()}`,
        items: [{ variant_id: config.fixtureVariantId, qty_sent: 1, unit_cost: config.maxDocumentTotal }],
      }, 'post');
      const transferId = Number(created.id);
      expect(transferId).toBeGreaterThan(0);
      transferIds.push(transferId);
      await checkpoint(`${direction}_draft_created`);
      const detail = (await (await page.request.get(`/api/ims/branch-transfers/${transferId}`)).json()).data;
      expect(detail.status).toBe('draft');
      expect(detail.items).toHaveLength(1);
      const itemId = Number(detail.items[0].id);
      await command(`/api/ims/branch-transfers/${transferId}`, { status: 'sent' });
      const sent = await quantities(outbound ? 1 : 0, outbound ? 0 : 1, outbound ? 1 : 0, outbound ? 0 : 1);
      await checkpoint(`${direction}_sent`);
      await command(`/api/ims/branch-transfers/${transferId}`, { status: 'sent' });
      expect(await snapshot()).toEqual(sent);
      if (outbound) {
        const halfReceipt = { status: 'received', receivedItems: [{ item_id: itemId, qty_received: 0.5 }] };
        await command(`/api/ims/branch-transfers/${transferId}`, halfReceipt);
        const half = await quantities(0.5, 0.5);
        const partial = (await (await page.request.get(`/api/ims/branch-transfers/${transferId}`)).json()).data;
        expect(partial.status).toBe('partial');
        expect(Number(partial.items[0].qty_received)).toBe(0.5);
        await checkpoint('warehouse_half_received');
        await command(`/api/ims/branch-transfers/${transferId}`, { action: 'set_item_received', item_id: itemId, qty_received: 0.5 });
        expect(await snapshot()).toEqual(half);
      }
      const fullReceipt = { status: 'received', receivedItems: [{ item_id: itemId, qty_received: 1 }] };
      await command(`/api/ims/branch-transfers/${transferId}`, fullReceipt);
      const received = await quantities(outbound ? 0 : 1, outbound ? 1 : 0);
      const completed = (await (await page.request.get(`/api/ims/branch-transfers/${transferId}`)).json()).data;
      expect(completed.status).toBe('received');
      expect(Number(completed.total_value)).toBe(config.maxDocumentTotal);
      const transferMovements = received.movements.filter(row => row.reference_type === 'branch_transfer' && Number(row.reference_id) === transferId);
      expect(transferMovements.length).toBeGreaterThanOrEqual(2);
      expect(transferMovements.reduce((sum, row) => sum + Number(row.qty_change), 0)).toBe(0);
      expect(transferMovements.every(row => Number(row.unit_cost) === config.maxDocumentTotal)).toBe(true);
      await checkpoint(`${direction}_received_cost_verified`);
      await command(`/api/ims/branch-transfers/${transferId}`, fullReceipt);
      expect(await snapshot()).toEqual(received);
    }
    await quantities(1, 0);
    const createdCredit = await command('/api/ims/supplier-credit-notes', { po_id: source.purchaseOrderId,
      supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, scn_date: new Date().toISOString().slice(0, 10),
      tax_treatment: 'no_tax', notes: `LIVE E2E ${config.runId} ROUND TRIP CLEANUP`,
      items: [{ variant_id: config.fixtureVariantId, source_po_item_id: Number(po.items[0].id), qty: 1, unit_cost: config.maxDocumentTotal, tax_rate: 0, restock: true }] }, 'post');
    supplierCreditNoteId = Number(createdCredit.data.id);
    await checkpoint('supplier_cleanup_draft');
    await command('/api/xero/document-policies', { databaseId: config.expectedBusinessId, policy: { ...originalPolicy, supplierCreditNoteAction: 'draft' } });
    await appendManifestState(config.runId, 'acknowledged', { operator: 'User-authorized Warehouse Branch round trip and exact cleanup', transferIds, supplierCreditNoteId });
    await appendManifestState(config.runId, 'compensating', { supplierCreditNoteId });
    const completion = { operationKey: `${config.runId}:supplier-cleanup` };
    await command(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, completion, 'post');
    const cleaned = await quantities(0, 0);
    await command(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, completion, 'post');
    expect(await snapshot()).toEqual(cleaned);
    let xeroCreditId: string | null = null;
    await expect.poll(async () => {
      const status = await (await page.request.get(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/xero-status`)).json();
      xeroCreditId = status.latest?.status === 'success' ? status.latest.xero_id : null;
      return xeroCreditId;
    }, { timeout: 60_000 }).not.toBeNull();
    const bill = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${source.xeroBillId}`, { method: 'GET' });
    const credit = await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${xeroCreditId}`, { method: 'GET' });
    expect(Number(bill.Invoices[0].Total)).toBe(config.maxDocumentTotal);
    expect(Number(credit.CreditNotes[0].Total)).toBe(config.maxDocumentTotal);
    expect(Number(credit.CreditNotes[0].TotalTax)).toBe(0);
    await command('/api/xero/document-policies', { databaseId: config.expectedBusinessId, policy: originalPolicy });
    expect((await (await page.request.get(policyEndpoint)).json()).policy).toEqual(originalPolicy);
    await appendManifestState(config.runId, 'clean', { scenario: 'Warehouse branch round trip', purchaseOrderId: source.purchaseOrderId,
      secondLocationId, transferIds, supplierCreditNoteId, xeroCreditId, roundTripPassed: true, partialReceiptPassed: true,
      costPreserved: true, replayPassed: true, bothLocationsZero: true, originalPolicyRestored: true });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { ...source, scenario: 'Warehouse branch round trip', secondLocationId,
      transferIds, supplierCreditNoteId, originalPolicy, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await command('/api/xero/document-policies', { databaseId: config.expectedBusinessId, policy: originalPolicy });
    await connection.end();
  }
});

test('@po-non-stock receives and undoes an expense-only PO without inventory history', async ({ page }) => {
  test.setTimeout(240_000);
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('p1');
  expect((await readManifest(config.runId)).at(-1)?.state).toBe('preflight_passed');
  await loginToIms(page, config);
  const mappingResponse = await page.request.get(`/api/xero/accounts?databaseId=${encodeURIComponent(config.expectedBusinessId)}`);
  expect(mappingResponse.ok()).toBe(true);
  const mapping = (await mappingResponse.json()).mappings.find((entry: any) => entry.role_key === 'non_stock_purchases');
  expect(mapping?.xero_account_code, 'Existing non-stock expense mapping is required; do not change accounting mappings for this test.').toBeTruthy();
  const before = await loadAllocationFixtureSnapshot(config);
  let productId: string | null = null;
  let variantId: string | null = null;
  let poId: number | null = null;
  let xeroBillId: string | null = null;
  const sku = `E2E-NON-STOCK-${config.runId}`;
  const checkpoint = (phase: string) => appendManifestState(config.runId, 'awaiting_operator', {
    scenario: 'Non-stock PO', phase, productId, variantId, purchaseOrderId: poId, xeroBillId,
  });
  const inventoryOracle = async () => {
    const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
    try {
      const schema = connection.escapeId(config.expectedImsSchema);
      const [stock] = await connection.query<mysql.RowDataPacket[]>(`SELECT qty_on_hand,qty_incoming,qty_committed FROM ${schema}.ims_stock WHERE business_id=? AND variant_id=?`, [config.expectedBusinessId, variantId]);
      const [movements] = await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM ${schema}.ims_stock_movements WHERE business_id=? AND variant_id=?`, [config.expectedBusinessId, variantId]);
      const [layers] = await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM ${schema}.ims_fifo_cost_layers WHERE business_id=? AND variant_id=?`, [config.expectedBusinessId, variantId]);
      const [lines] = await connection.query<mysql.RowDataPacket[]>(`SELECT is_stock_item,qty_ordered,qty_received FROM ${schema}.ims_purchase_order_items WHERE business_id=? AND po_id=?`, [config.expectedBusinessId, poId]);
      expect(stock.every(row => [row.qty_on_hand, row.qty_incoming, row.qty_committed].every(quantity => Number(quantity) === 0))).toBe(true);
      expect(movements).toHaveLength(0);
      expect(layers).toHaveLength(0);
      expect(await loadAllocationFixtureSnapshot(config)).toEqual(before);
      return lines;
    } finally { await connection.end(); }
  };
  try {
    const productResponse = await page.request.post('/api/ims/products', { data: { name: `LIVE E2E ${config.runId} NON-STOCK EXPENSE`,
      base_sku: sku, is_active: 1, is_online: 0, is_stock_item: 0 } });
    expect(productResponse.ok()).toBe(true);
    productId = (await productResponse.json()).product_id;
    await appendManifestState(config.runId, 'p1_created', { scenario: 'Non-stock PO', productId });
    const variantResponse = await page.request.post('/api/ims/variants', { data: { product_id: productId, sku, is_active: 1, cost_aud: 0, price_rrp: 1 } });
    expect(variantResponse.ok()).toBe(true);
    variantId = (await variantResponse.json()).variant_id;
    await checkpoint('unused_expense_product_created');
    await openPurchaseOrders(page);
    await page.getByTestId('po-new').click();
    await page.getByTestId('po-supplier').selectOption(String(config.fixtureSupplierId));
    await page.getByTestId('po-location').selectOption(String(config.fixtureLocationId));
    await page.getByTestId('po-tax-treatment').selectOption('no_tax');
    await page.getByTestId('po-notes').fill(`LIVE E2E ${config.runId} NON-STOCK PO`);
    await page.getByTestId('po-line-0-variant').fill(sku);
    await page.getByTestId(`po-line-0-variant-option-${variantId}`).click();
    await page.getByTestId('po-line-0-qty').fill('1');
    await page.getByTestId('po-line-0-unit-cost').fill(String(config.maxDocumentTotal));
    const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/purchase-orders') && response.request().method() === 'POST', { timeout: 30_000 });
    await page.getByTestId('po-create-confirm').click();
    const created = await (await createdResponse).json();
    poId = Number(created.id);
    await checkpoint('expense_po_confirmed');
    expect(created.success, created.error).toBe(true);
    expect(poId).toBeGreaterThan(0);
    const confirmedLines = await inventoryOracle();
    expect(confirmedLines).toHaveLength(1);
    expect(Number(confirmedLines[0].is_stock_item)).toBe(0);
    expect(Number(confirmedLines[0].qty_received)).toBe(0);
    await expect.poll(async () => {
      const detail = await (await page.request.get(`/api/ims/purchase-orders/${poId}`)).json();
      xeroBillId = detail.data?.xero_bill_id ?? null;
      return xeroBillId;
    }, { timeout: 30_000 }).not.toBeNull();
    await checkpoint('expense_bill_created');
    await page.getByRole('button', { name: 'Receive', exact: true }).click({ timeout: 15_000 });
    await page.getByTestId('po-line-0-received').fill('1');
    await page.getByTestId('po-supplier-invoice-number').fill(`E2E-${config.runId}`);
    const receivedResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/receive/batch') && response.request().method() === 'POST', { timeout: 30_000 });
    await page.getByTestId('po-receive-complete').click();
    const received = await (await receivedResponse).json();
    expect(received.success, received.error).toBe(true);
    const receivedLines = await inventoryOracle();
    expect(Number(receivedLines[0].qty_received)).toBe(1);
    expect(Number(receivedLines[0].is_stock_item)).toBe(0);
    const detail = await (await page.request.get(`/api/ims/purchase-orders/${poId}`)).json();
    expect(detail.data.status).toBe('complete');
    expect(Number(detail.data.total_amount)).toBe(config.maxDocumentTotal);
    const bill = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${xeroBillId}`, { method: 'GET' });
    expect(Number(bill.Invoices[0].Total)).toBe(config.maxDocumentTotal);
    expect(Number(bill.Invoices[0].TotalTax)).toBe(0);
    expect(bill.Invoices[0].LineItems).toHaveLength(1);
    expect(String(bill.Invoices[0].LineItems[0].AccountCode)).toBe(String(mapping.xero_account_code));
    await checkpoint('non_stock_receipt_and_expense_bill_verified');
    await appendManifestState(config.runId, 'acknowledged', { operator: 'Authorised exact non-stock receipt cleanup', purchaseOrderId: poId });
    await appendManifestState(config.runId, 'compensating', { scenario: 'Non-stock PO', purchaseOrderId: poId });
    page.once('dialog', dialog => dialog.accept());
    const undoResponse = page.waitForResponse(response => response.url().endsWith(`/api/ims/purchase-orders/${poId}/undo-receipt`) && response.request().method() === 'POST', { timeout: 30_000 });
    await page.getByTestId(`po-undo-receipt-${poId}`).click();
    const undone = await (await undoResponse).json();
    expect(undone.success, undone.error).toBe(true);
    expect(undone.xeroWarning).toBeUndefined();
    const undoneLines = await inventoryOracle();
    expect(Number(undoneLines[0].qty_received)).toBe(0);
    const savedBill = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${xeroBillId}`, { method: 'GET' });
    expect(['DELETED', 'VOIDED']).toContain(savedBill.Invoices[0].Status);
    const archive = await page.request.put(`/api/ims/products/${productId}`, { data: { is_active: 0 } });
    expect(archive.ok()).toBe(true);
    await appendManifestState(config.runId, 'clean', { scenario: 'Non-stock PO', purchaseOrderId: poId, productId, variantId, xeroBillId,
      nonStockReceiptPassed: true, expenseMappingPassed: true, inventoryUnchanged: true, receiptUndoPassed: true });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Non-stock PO', productId, variantId, purchaseOrderId: poId, xeroBillId,
      error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@p1-create creates and confirms the isolated low-value PO', async ({ page }) => {
  const config = loadLiveE2EConfig();
  let poId: number | null = null;
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('preflight_passed');
  await loginToIms(page, config);
  try {
    await openPurchaseOrders(page);
    await page.getByTestId('po-new').click();
    await page.getByTestId('po-supplier').selectOption(String(config.fixtureSupplierId));
    await page.getByTestId('po-location').selectOption(String(config.fixtureLocationId));
    await page.getByTestId('po-tax-treatment').selectOption('no_tax');
    await page.getByTestId('po-notes').fill(`LIVE E2E ${config.runId} P1 - permanent audit artifact`);
    await page.getByTestId('po-line-0-variant').fill(config.fixtureSku);
    await page.getByTestId(`po-line-0-variant-option-${config.fixtureVariantId}`).click();
    await page.getByTestId('po-line-0-qty').fill('1');
    await page.getByTestId('po-line-0-unit-cost').fill(String(config.maxDocumentTotal));

    const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/purchase-orders') && response.request().method() === 'POST');
    await page.getByTestId('po-create-confirm').click();
    const created = await (await createdResponse).json() as { success?: boolean; id?: number; error?: string };
    expect(created.success, created.error).toBe(true);
    poId = Number(created.id);
    expect(poId).toBeGreaterThan(0);

    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/purchase-orders/${poId}`);
      const body = await response.json();
      return body?.data?.xero_bill_id ?? null;
    }, { timeout: 30_000, message: 'Confirmed PO did not receive its Xero draft bill ID.' }).not.toBeNull();
    const detail = await (await page.request.get(`/api/ims/purchase-orders/${poId}`)).json();
    await appendManifestState(config.runId, 'p1_created', {
      scenario: 'P1',
      purchaseOrderId: poId,
      purchaseOrderNumber: detail?.data?.po_number ?? null,
      xeroBillId: detail?.data?.xero_bill_id ?? null,
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'P1', phase: 'create_confirm', purchaseOrderId: poId, error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    throw error;
  }
});

test('@p1-receive fully receives the existing isolated low-value PO', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const poId = purchaseOrderId(events);
  expect(events.at(-1)?.state).toBe('p1_created');
  await loginToIms(page, config);
  try {
    await openPurchaseOrders(page);
    const poRow = page.getByTestId(`po-open-${poId}`).locator('xpath=ancestor::tr');
    await poRow.getByRole('combobox').selectOption('receive');
    await poRow.getByRole('button', { name: 'Go' }).click();
    await page.getByTestId('po-line-0-received').fill('1');
    await page.getByTestId('po-supplier-invoice-number').fill(`E2E-${config.runId}`);
    const editResponse = page.waitForResponse(response => response.url().endsWith(`/api/ims/purchase-orders/${poId}`)
      && response.request().method() === 'PUT');
    const receiveResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/receive/batch')
      && response.request().method() === 'POST');
    await page.getByTestId('po-receive-complete').dispatchEvent('click');
    const edited = await (await editResponse).json() as { success?: boolean; error?: string };
    expect(edited.success, edited.error ?? 'PO receive edit request failed.').toBe(true);
    const received = await (await receiveResponse).json() as { success?: boolean; error?: string };
    expect(received.success, received.error ?? 'PO receive request failed.').toBe(true);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/purchase-orders/${poId}`);
      const body = await response.json();
      return body?.data?.status;
    }).toBe('complete');

    const detail = await (await page.request.get(`/api/ims/purchase-orders/${poId}`)).json();
    const stock = await verifyPurchaseOrderReceipt(config, poId);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/xero/bill-details?poId=${poId}`);
      const bill = await response.json();
      return { success: response.ok() && bill.success === true, total: Number(bill.total), taxTotal: Number(bill.taxTotal) };
    }, { timeout: 30_000, message: 'Xero test bill does not match the received untaxed PO.' })
      .toEqual({ success: true, total: config.maxDocumentTotal, taxTotal: 0 });
    const fifo = config.expectedCostingMethod === 'fifo' ? await verifyLiveFifoIntegrity(config) : null;
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P1',
      purchaseOrderId: poId,
      purchaseOrderNumber: detail?.data?.po_number ?? null,
      xeroBillId: detail?.data?.xero_bill_id ?? null,
      stock,
      fifo,
      operatorChecks: ['IMS PO is complete with quantity 1 received', 'Xero bill exists and matches the low-value PO'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'p1_created', { scenario: 'P1', phase: 'receive_attempt', purchaseOrderId: poId, receiveError: error instanceof Error ? error.message : String(error) }).catch(() => {});
    throw error;
  }
});

test('@p1-partial receives two exact halves and protects captured receipt facts from amendments', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('p1');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('p1_created');
  const poId = purchaseOrderId(events);
  const receiptKey = `${config.runId}:receipt:half:1`;
  const secondReceiptKey = `${config.runId}:receipt:half:2`;
  await loginToIms(page, config);
  const detail = async () => {
    const response = await page.request.get(`/api/ims/purchase-orders/${poId}`);
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    return body.data;
  };
  const original = await detail();
  expect(original).toMatchObject({ status: 'confirmed', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, tax_treatment: 'no_tax' });
  expect(original.notes).toContain(`LIVE E2E ${config.runId} P1`);
  expect(Number(original.total_amount)).toBe(config.maxDocumentTotal);
  expect(original.items).toHaveLength(1);
  expect(original.items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(original.items[0].qty_ordered)).toBe(1);
  expect(Number(original.items[0].qty_received)).toBe(0);
  expect(Number(original.items[0].unit_cost)).toBe(config.maxDocumentTotal);
  expect(original.xero_bill_id).toBeTruthy();
  const before = await loadAllocationFixtureSnapshot(config);
  expect(before.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 1, qtyCommitted: 0 });
  await appendManifestState(config.runId, 'p1_created', { scenario: 'P1', phase: 'before_partial_receipt', purchaseOrderId: poId,
    xeroBillId: original.xero_bill_id, receiptKey, secondReceiptKey });
  try {
    const updated = await page.request.put(`/api/ims/purchase-orders/${poId}`, { data: { supplier_invoice_number: `E2E-${config.runId}` } });
    expect(updated.ok(), (await updated.json()).error).toBe(true);
    const input = { po_id: poId, location_id: config.fixtureLocationId, operation_key: receiptKey,
      received_items: [{ variant_id: config.fixtureVariantId, qty_received: 0.5 }], mark_po_received: false, create_backorder_po: false };
    const first = await page.request.post('/api/ims/receive/batch', { data: input });
    expect(first.ok(), (await first.json()).error).toBe(true);
    const halfOrder = await detail();
    expect(halfOrder.status).toBe('partially_received');
    expect(Number(halfOrder.items[0].qty_received)).toBe(0.5);
    const half = await loadAllocationFixtureSnapshot(config);
    expect(half.stock).toEqual({ qtyOnHand: 0.5, qtyIncoming: 0.5, qtyCommitted: 0 });
    const halfFifo = await verifyLiveFifoIntegrity(config);
    expect(halfFifo.stockQuantity).toBe(0.5);
    expect(halfFifo.layerQuantity).toBe(0.5);
    await appendManifestState(config.runId, 'p1_created', { scenario: 'P1', phase: 'half_received', purchaseOrderId: poId,
      xeroBillId: original.xero_bill_id, receiptKey, secondReceiptKey, stock: half.stock, fifo: halfFifo });
    const replay = await page.request.post('/api/ims/receive/batch', { data: input });
    expect(replay.ok(), (await replay.json()).error).toBe(true);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(half);
    const conflict = await page.request.post('/api/ims/receive/batch', { data: { ...input,
      received_items: [{ variant_id: config.fixtureVariantId, qty_received: 0.25 }] } });
    expect(conflict.status()).toBe(409);
    for (const change of [{ qty_ordered: 0.25 }, { unit_cost: 0.5 }]) {
      const response = await page.request.put(`/api/ims/purchase-orders/${poId}`, { data: {
        items: halfOrder.items.map((item: any) => ({ ...item, ...change })),
      } });
      expect([400, 409]).toContain(response.status());
      expect((await response.json()).error).toBeTruthy();
      expect(await loadAllocationFixtureSnapshot(config)).toEqual(half);
      const unchanged = await detail();
      expect(Number(unchanged.items[0].qty_ordered)).toBe(1);
      expect(Number(unchanged.items[0].qty_received)).toBe(0.5);
      expect(Number(unchanged.items[0].unit_cost)).toBe(config.maxDocumentTotal);
    }
    const secondInput = { ...input, operation_key: secondReceiptKey, mark_po_received: true };
    const second = await page.request.post('/api/ims/receive/batch', { data: secondInput });
    expect(second.ok(), (await second.json()).error).toBe(true);
    expect((await detail()).status).toBe('complete');
    const stock = await verifyPurchaseOrderReceipt(config, poId);
    const completed = await loadAllocationFixtureSnapshot(config);
    expect(completed.stock).toEqual({ qtyOnHand: 1, qtyIncoming: 0, qtyCommitted: 0 });
    const secondReplay = await page.request.post('/api/ims/receive/batch', { data: secondInput });
    expect(secondReplay.ok(), (await secondReplay.json()).error).toBe(true);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(completed);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/xero/bill-details?poId=${poId}`);
      const bill = await response.json();
      return { success: response.ok() && bill.success === true, total: Number(bill.total), taxTotal: Number(bill.taxTotal) };
    }, { timeout: 30_000 }).toEqual({ success: true, total: config.maxDocumentTotal, taxTotal: 0 });
    const fifo = await verifyLiveFifoIntegrity(config);
    expect(fifo.stockQuantity).toBe(1);
    expect(fifo.layerQuantity).toBe(1);
    await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'P1', phase: 'two_partial_receipts_verified', purchaseOrderId: poId,
      xeroBillId: original.xero_bill_id, receiptKey, secondReceiptKey, stock, fifo,
      operatorChecks: ['Two exact half receipts and keyed replay', 'Below-received quantity and captured-cost edits rejected', 'Actual AUD1 NoTax Xero bill verified'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'P1', phase: 'partial_receipt', purchaseOrderId: poId,
      xeroBillId: original.xero_bill_id, receiptKey, secondReceiptKey, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@p1-amend-receipts preserves received facts while reducing the outstanding balance', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('p1');
  expect(config.expectedCostingMethod).toBe('fifo');
  expect(config.maxDocumentTotal).toBe(1);
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('p1_created');
  const poId = purchaseOrderId(events);
  await loginToIms(page, config);
  const detail = async () => {
    const response = await page.request.get(`/api/ims/purchase-orders/${poId}`);
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    return body.data;
  };
  const original = await detail();
  expect(original).toMatchObject({ status: 'confirmed', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, tax_treatment: 'no_tax' });
  expect(original.notes).toContain(`LIVE E2E ${config.runId} P1`);
  expect(original.items).toHaveLength(1);
  expect(original.items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(original.items[0].qty_received)).toBe(0);
  const amend = async (order: any, quantity: number, unitCost: number, phase: string) => {
    const input = { operationKey: `${config.runId}:amend:${phase}`, expectedUpdatedAt: order.updated_at,
      supplier_invoice_number: order.supplier_invoice_number || `E2E-${config.runId}`,
      subtotal: quantity * unitCost, tax_amount: 0, total_amount: quantity * unitCost,
      items: order.items.map((item: any) => ({ ...item, qty_ordered: quantity, unit_cost: unitCost, line_total: quantity * unitCost })) };
    await appendManifestState(config.runId, 'p1_created', { scenario: 'P1', phase: `before_${phase}`, purchaseOrderId: poId,
      xeroBillId: original.xero_bill_id, amendmentKey: input.operationKey });
    const response = await page.request.put(`/api/ims/purchase-orders/${poId}`, { data: input });
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    expect(body.xeroWarning).toBeUndefined();
    const after = await loadAllocationFixtureSnapshot(config);
    const replay = await page.request.put(`/api/ims/purchase-orders/${poId}`, { data: input });
    expect(replay.ok(), (await replay.json()).error).toBe(true);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(after);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/xero/bill-details?poId=${poId}`);
      const body = await response.json();
      return { success: response.ok() && body.success, total: Number(body.total), tax: Number(body.taxTotal) };
    }, { timeout: 30_000 }).toEqual({ success: true, total: quantity * unitCost, tax: 0 });
    return after;
  };
  try {
    const before = await loadAllocationFixtureSnapshot(config);
    expect(before.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 1, qtyCommitted: 0 });
    const expanded = await amend(original, 2, 0.5, 'unreceived_quantity_and_cost');
    expect(expanded.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 2, qtyCommitted: 0 });
    const expansionMovements = expanded.movements.filter(row => !before.movements.some(prior => prior.id === row.id));
    expect(expansionMovements).toHaveLength(1);
    expect(expansionMovements[0]).toMatchObject({ movement_type: 'po_approved', reference_type: 'purchase_order', reference_id: poId });
    expect(Number(expansionMovements[0].qty_change)).toBe(1);
    const receipt = { po_id: poId, location_id: config.fixtureLocationId, operation_key: `${config.runId}:receipt:half:1`,
      received_items: [{ variant_id: config.fixtureVariantId, qty_received: 0.5 }], mark_po_received: false, create_backorder_po: false };
    const received = await page.request.post('/api/ims/receive/batch', { data: receipt });
    expect(received.ok(), (await received.json()).error).toBe(true);
    const half = await loadAllocationFixtureSnapshot(config);
    expect(half.stock).toEqual({ qtyOnHand: 0.5, qtyIncoming: 1.5, qtyCommitted: 0 });
    const halfOrder = await detail();
    expect(halfOrder.status).toBe('partially_received');
    expect(Number(halfOrder.items[0].qty_received)).toBe(0.5);
    const reduced = await amend(halfOrder, 1, 0.5, 'reduce_unreceived_balance');
    expect(reduced.stock).toEqual({ qtyOnHand: 0.5, qtyIncoming: 0.5, qtyCommitted: 0 });
    const reductionMovements = reduced.movements.filter(row => !half.movements.some(prior => prior.id === row.id));
    expect(reductionMovements).toHaveLength(1);
    expect(reductionMovements[0]).toMatchObject({ movement_type: 'po_unapproved', reference_type: 'purchase_order', reference_id: poId });
    expect(Number(reductionMovements[0].qty_change)).toBe(-1);
    const reducedOrder = await detail();
    expect(Number(reducedOrder.items[0].qty_received)).toBe(0.5);
    expect(Number(reducedOrder.items[0].unit_cost)).toBe(0.5);
    const secondInput = { ...receipt, operation_key: `${config.runId}:receipt:half:2`, mark_po_received: true };
    const second = await page.request.post('/api/ims/receive/batch', { data: secondInput });
    expect(second.ok(), (await second.json()).error).toBe(true);
    const completed = await detail();
    expect(completed.status).toBe('complete');
    expect(Number(completed.total_amount)).toBe(0.5);
    expect(Number(completed.items[0].qty_received)).toBe(1);
    const stock = await loadAllocationFixtureSnapshot(config);
    expect(stock.stock).toEqual({ qtyOnHand: 1, qtyIncoming: 0, qtyCommitted: 0 });
    const added = stock.movements.filter(row => !before.movements.some(prior => prior.id === row.id));
    expect(added.filter(row => row.movement_type === 'po_received')).toHaveLength(2);
    for (const movement of added.filter(row => row.movement_type === 'po_received')) {
      expect(Number(movement.qty_change)).toBe(0.5);
      expect(Number(movement.unit_cost)).toBe(0.5);
    }
    const replay = await page.request.post('/api/ims/receive/batch', { data: secondInput });
    expect(replay.ok()).toBe(true);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(stock);
    const fifo = await verifyLiveFifoIntegrity(config);
    expect(fifo.layerQuantity).toBe(1);
    await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'P1', phase: 'positive_amendment_receipts_verified',
      purchaseOrderId: poId, xeroBillId: original.xero_bill_id, stock: stock.stock, fifo,
      operatorChecks: ['Positive pre-receipt quantity/cost amendment and replay', 'Outstanding balance reduction preserves receipt facts', 'Two half receipts at captured cost 0.50', 'Xero bill amendment total 0.50'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'P1', phase: 'positive_amendment_receipts', purchaseOrderId: poId,
      xeroBillId: original.xero_bill_id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@p1-repair corrects the exact untaxed P1 Xero bill and renews operator review', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const poId = purchaseOrderId(events);
  const manifestXeroId = String((events.findLast(event => event.state === 'awaiting_operator')?.details as any)?.xeroBillId ?? '');
  expect(events.at(-1)?.state).toBe('awaiting_operator');
  await loginToIms(page, config);

  const beforeResponse = await page.request.get(`/api/ims/purchase-orders/${poId}`);
  const before = (await beforeResponse.json())?.data;
  const lines = Array.isArray(before?.items) ? before.items : [];
  expect(beforeResponse.ok()).toBe(true);
  expect(before).toMatchObject({
    id: poId,
    status: 'complete',
    tax_treatment: 'no_tax',
    xero_bill_id: manifestXeroId,
  });
  expect(Number(before.total_amount)).toBe(config.maxDocumentTotal);
  expect(Number(before.tax_amount)).toBe(0);
  expect(lines).toHaveLength(1);
  expect(String(lines[0].variant_id)).toBe(config.fixtureVariantId);
  expect(Number(lines[0].tax_rate)).toBe(0);
  expect(Number(lines[0].line_total)).toBe(config.maxDocumentTotal);

  const pushResponse = await page.request.post('/api/ims/xero/push', { data: { type: 'po', id: poId } });
  const pushed = await pushResponse.json() as { success?: boolean; xeroId?: string; error?: string };
  expect(pushResponse.ok(), pushed.error).toBe(true);
  expect(pushed.success, pushed.error).toBe(true);
  expect(pushed.xeroId).toBe(manifestXeroId);

  await expect.poll(async () => {
    const response = await page.request.get(`/api/ims/xero/bill-details?poId=${poId}`);
    const body = await response.json();
    return Number(body?.total);
  }, { timeout: 30_000, message: 'Corrected Xero bill did not read back at the IMS total.' }).toBe(config.maxDocumentTotal);

  await appendManifestState(config.runId, 'awaiting_operator', {
    scenario: 'P1',
    phase: 'xero_tax_repaired',
    purchaseOrderId: poId,
    xeroBillId: manifestXeroId,
    xeroTotal: config.maxDocumentTotal,
    operatorChecks: ['Xero bill is Tax Exclusive with No GST and total AUD 1.00', 'IMS PO remains complete with quantity 1 received'],
  });
});

test('@po-partial-return compensates only the reconciled multi-receipt fixture through a linked supplier credit', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('p1-compensate');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('compensation_retry_authorized');
  const failed = events.findLast(event => event.state === 'blocked')?.details as any;
  expect(failed.phase).toBe('compensation');
  const amendedReceiptCleanup = config.runId === 'campaign-20261011-po-amend-fifo-003';
  expect(failed.error).toContain(amendedReceiptCleanup ? 'receipt valuation history' : 'do not identify one receipt movement');
  const source = events.findLast(event => (event.details as any)?.phase ===
    (amendedReceiptCleanup ? 'positive_amendment_receipts_verified' : 'two_partial_receipts_verified'))?.details as any;
  expect(source).toBeDefined();
  const cleanupTotal = amendedReceiptCleanup ? 0.5 : config.maxDocumentTotal;
  const poId = purchaseOrderId(events);
  expect(source.purchaseOrderId).toBe(poId);
  const before = await loadAllocationFixtureSnapshot(config);
  expect(before.stock).toEqual({ qtyOnHand: 1, qtyIncoming: 0, qtyCommitted: 0 });
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [layers] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT layer.id, layer.original_quantity, layer.remaining_quantity, layer.unit_cost, layer.source_movement_id,
        (SELECT COUNT(*) FROM ${schema}.ims_fifo_cost_allocations allocation WHERE allocation.layer_id = layer.id) AS allocations,
        (SELECT COUNT(*) FROM ${schema}.ims_fifo_cost_layers child WHERE child.parent_layer_id = layer.id) AS children
       FROM ${schema}.ims_fifo_cost_layers layer WHERE layer.business_id = ? AND layer.variant_id = ? AND layer.location_id = ?
         AND layer.source_type = 'po_receipt' AND layer.source_reference_type = 'purchase_order' AND layer.source_reference_id = ? ORDER BY layer.id`,
      [config.expectedBusinessId, config.fixtureVariantId, config.fixtureLocationId, poId]);
    expect(layers).toHaveLength(2);
    expect(new Set(layers.map(layer => Number(layer.source_movement_id))).size).toBe(2);
    for (const layer of layers) {
      expect(Number(layer.original_quantity)).toBe(0.5);
      expect(Number(layer.remaining_quantity)).toBe(0.5);
      expect(Number(layer.unit_cost)).toBe(cleanupTotal);
      expect(Number(layer.allocations)).toBe(0);
      expect(Number(layer.children)).toBe(0);
    }
  } finally { await connection.end(); }
  await loginToIms(page, config);
  const poResponse = await page.request.get(`/api/ims/purchase-orders/${poId}`);
  const po = (await poResponse.json()).data;
  expect(poResponse.ok()).toBe(true);
  expect(po).toMatchObject({ status: 'complete', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId,
    tax_treatment: 'no_tax', xero_bill_id: source.xeroBillId });
  expect(po.notes).toContain(`LIVE E2E ${config.runId} P1`);
  expect(Number(po.total_amount)).toBe(cleanupTotal);
  expect(po.items).toHaveLength(1);
  expect(po.items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(po.items[0].qty_received)).toBe(1);
  const policyEndpoint = `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`;
  const policyResponse = await page.request.get(policyEndpoint);
  const originalPolicy = (await policyResponse.json()).policy;
  expect(policyResponse.ok()).toBe(true);
  expect(originalPolicy).toBeDefined();
  let supplierCreditNoteId: number | null = null;
  await appendManifestState(config.runId, 'compensating', { scenario: 'P1 partial receipt supplier return', purchaseOrderId: poId,
    xeroBillId: source.xeroBillId, originalPolicy, originalUndoDefect: true });
  try {
    const createdResponse = await page.request.post('/api/ims/supplier-credit-notes', { data: {
      po_id: poId, supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId,
      scn_date: new Date().toISOString().slice(0, 10), tax_treatment: 'no_tax', currency_code: 'AUD',
      notes: `LIVE E2E ${config.runId} PARTIAL RECEIPT RETURN`,
      items: [{ variant_id: config.fixtureVariantId, source_po_item_id: Number(po.items[0].id), qty: 1,
        unit_cost: cleanupTotal, tax_rate: 0, restock: true }],
    } });
    const created = await createdResponse.json();
    expect(createdResponse.ok(), created.error).toBe(true);
    supplierCreditNoteId = Number(created.data.id);
    expect(supplierCreditNoteId).toBeGreaterThan(0);
    const policyUpdate = await page.request.put('/api/xero/document-policies', { data: {
      databaseId: config.expectedBusinessId, policy: { ...originalPolicy, supplierCreditNoteAction: 'draft' },
    } });
    expect(policyUpdate.ok(), (await policyUpdate.json()).error).toBe(true);
    const completion = { operationKey: `${config.runId}:supplier-return:complete` };
    const completeResponse = await page.request.post(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, { data: completion });
    const complete = await completeResponse.json();
    expect(completeResponse.ok(), complete.error).toBe(true);
    expect(complete.data.status).toBe('complete');
    const after = await loadAllocationFixtureSnapshot(config);
    expect(after.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
    const added = after.movements.filter(row => !before.movements.some(prior => prior.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ reference_type: 'supplier_credit_note', cost_method_snapshot: 'fifo' });
    expect(Number(added[0].qty_change)).toBe(-1);
    expect(Number(added[0].unit_cost)).toBe(cleanupTotal);
    const replay = await page.request.post(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, { data: completion });
    expect(replay.ok(), (await replay.json()).error).toBe(true);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(after);
    let xeroCreditNoteId: string | null = null;
    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/xero-status`);
      const body = await response.json();
      xeroCreditNoteId = body.latest?.status === 'success' ? body.latest.xero_id : null;
      return xeroCreditNoteId;
    }, { timeout: 60_000 }).not.toBeNull();
    const credit = await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${xeroCreditNoteId}`, { method: 'GET' });
    expect(credit.CreditNotes).toHaveLength(1);
    expect(['DRAFT', 'AUTHORISED']).toContain(credit.CreditNotes[0].Status);
    expect(Number(credit.CreditNotes[0].Total)).toBe(cleanupTotal);
    expect(Number(credit.CreditNotes[0].TotalTax)).toBe(0);
    const bill = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${source.xeroBillId}`, { method: 'GET' });
    expect(bill.Invoices).toHaveLength(1);
    expect(['DRAFT', 'AUTHORISED']).toContain(bill.Invoices[0].Status);
    expect(Number(bill.Invoices[0].Total)).toBe(cleanupTotal);
    const fifo = await verifyLiveFifoIntegrity(config);
    expect(fifo.stockQuantity).toBe(0);
    expect(fifo.layerQuantity).toBe(0);
    await appendManifestState(config.runId, 'clean', { scenario: 'P1 partial receipt supplier return', purchaseOrderId: poId,
      supplierCreditNoteId, xeroBillId: source.xeroBillId, xeroCreditNoteId, fifo,
      originalUndoPassed: false, alternativeCleanupPassed: true, permanentArtifacts: ['Completed PO with two receipts', 'Linked supplier return and original Xero bill/credit', 'Original FIFO undo defect retained'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'P1 partial receipt supplier return', purchaseOrderId: poId,
      supplierCreditNoteId, originalPolicy, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    const restored = await page.request.put('/api/xero/document-policies', { data: { databaseId: config.expectedBusinessId, policy: originalPolicy } });
    expect(restored.ok()).toBe(true);
    expect((await (await page.request.get(policyEndpoint)).json()).policy).toEqual(originalPolicy);
  }
});

test('@p1-compensate undoes only the acknowledged mistaken receipt and verifies baseline stock', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const poId = purchaseOrderId(events);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'P1', purchaseOrderId: poId });
  try {
    await openPurchaseOrders(page);
    await page.getByTestId(`po-open-${poId}`).click();
    page.once('dialog', dialog => dialog.accept());
    const undoResponse = page.waitForResponse(response => response.url().endsWith(`/api/ims/purchase-orders/${poId}/undo-receipt`) && response.request().method() === 'POST');
    await page.getByTestId(`po-undo-receipt-${poId}`).click();
    const undo = await (await undoResponse).json() as { success?: boolean; xeroWarning?: string; error?: string };
    expect(undo.success, undo.error).toBe(true);
    expect(undo.xeroWarning, 'Xero did not confirm automatic voiding').toBeUndefined();
    const verification = await verifyPurchaseOrderCompensation(config, poId);
    const fifo = config.expectedCostingMethod === 'fifo' ? await verifyLiveFifoIntegrity(config) : null;
    await appendManifestState(config.runId, 'clean', {
      scenario: 'P1',
      purchaseOrderId: poId,
      ...verification,
      fifo,
      permanentArtifacts: ['Cancelled IMS purchase order and immutable activity/stock history', 'Voided Xero bill and Xero audit history'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'P1', phase: 'compensation', purchaseOrderId: poId, error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    throw error;
  }
});