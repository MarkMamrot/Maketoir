import { expect, test, type Page } from '@playwright/test';

import { loadLiveE2EConfig, type LiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { loadAllocationFixtureSnapshot } from './support/database-preflight';
import { xeroApiFetch } from '../../src/services/XeroService';
import mysql from 'mysql2/promise';

test.describe.configure({ timeout: 360_000 });

type Documents = { purchaseOrderIds: number[]; salesOrderIds: number[]; receivedPurchaseOrderIds?: number[] };

async function recordedDocuments(config: LiveE2EConfig): Promise<Documents> {
  const events = await readManifest(config.runId);
  const details = events.findLast(event => event.state === 'allocation_created')?.details as Documents | undefined;
  return { purchaseOrderIds: [...(details?.purchaseOrderIds ?? [])], salesOrderIds: [...(details?.salesOrderIds ?? [])], receivedPurchaseOrderIds: [...(details?.receivedPurchaseOrderIds ?? [])] };
}

async function checkpoint(config: LiveE2EConfig, documents: Documents, phase: string) {
  await appendManifestState(config.runId, 'allocation_created', { scenario: 'Incoming allocation', ...documents, phase });
}

async function detail(page: Page, kind: 'purchase-orders' | 'sales-orders', id: number) {
  const response = await page.request.get(`/api/ims/${kind}/${id}`);
  const body = await response.json();
  expect(response.ok(), body.error).toBe(true);
  expect(body.success).toBe(true);
  return body.data;
}

async function createOrder(page: Page, config: LiveE2EConfig, kind: 'po' | 'so', label: string, unitAmount = config.maxDocumentTotal / 2) {
  await page.goto('/ims');
  await page.getByTestId(kind === 'po' ? 'ims-nav-__purchasing' : 'ims-nav-__sales').click();
  await page.getByTestId(kind === 'po' ? 'ims-nav-purchase-orders' : 'ims-nav-sales-orders').click();
  await page.getByTestId(`${kind}-new`).click();
  await page.getByTestId(kind === 'po' ? 'po-supplier' : 'so-customer').selectOption(String(kind === 'po' ? config.fixtureSupplierId : config.fixtureCustomerId));
  await page.getByTestId(`${kind}-location`).selectOption(String(config.fixtureLocationId));
  await page.getByTestId(`${kind}-tax-treatment`).selectOption('no_tax');
  await page.getByTestId(`${kind}-notes`).fill(`LIVE E2E ${config.runId} ALLOCATION ${label}`);
  await page.getByTestId(`${kind}-line-0-variant`).fill(config.fixtureSku);
  const option = page.getByTestId(`${kind}-line-0-variant-option-${config.fixtureVariantId}`);
  if (kind === 'po') await option.click(); else await option.dispatchEvent('mousedown');
  await page.getByTestId(kind === 'po' ? 'po-line-0-qty' : 'so-line-qty-0').fill('2');
  await page.getByTestId(kind === 'po' ? 'po-line-0-unit-cost' : 'so-line-price-0').fill(String(unitAmount));
  const route = kind === 'po' ? 'purchase-orders' : 'sales-orders';
  const pending = page.waitForResponse(response => response.url().endsWith(`/api/ims/${route}`) && response.request().method() === 'POST');
  await page.getByTestId(kind === 'po' ? 'po-create-confirm' : 'so-create-draft').click();
  const response = await pending;
  const body = await response.json();
  expect(response.ok(), body.error).toBe(true);
  expect(body.success).toBe(true);
  const id = Number(body.id ?? body.data?.id);
  expect(id).toBeGreaterThan(0);
  return id;
}

async function openSalesOrder(page: Page, soId: number) {
  await page.goto('/ims');
  await page.getByTestId('ims-nav-__sales').click();
  await page.getByTestId('ims-nav-sales-orders').click();
  await page.getByTestId(`so-open-${soId}`).click();
  const toggle = page.getByRole('button', { name: /^Stock allocation/ }).last();
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

async function command(page: Page, body: Record<string, unknown>, expectedStatus = 200) {
  const response = await page.request.patch('/api/ims/stock-allocations', { data: body });
  const result = await response.json();
  expect(response.status(), result.error).toBe(expectedStatus);
  expect(result.success).toBe(expectedStatus === 200);
  return result;
}

async function useCurrentSalesDates(page: Page) {
  await page.getByRole('button', { name: '90 Days', exact: true }).click();
  await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
}

async function confirmUnsourcedSalesOrder(page: Page, soId: number) {
  await page.goto('/ims');
  await page.getByTestId('ims-nav-__sales').click();
  await page.getByTestId('ims-nav-sales-orders').click();
  await useCurrentSalesDates(page);
  const row = page.getByTestId(`so-open-${soId}`).locator('xpath=ancestor::tr');
  await row.getByRole('combobox').selectOption('confirm', { timeout: 15_000 });
  await row.getByRole('button', { name: 'Go' }).click();
  await expect(page.getByRole('heading', { name: /^Stock sourcing/ })).toBeVisible({ timeout: 45_000 });
  const quantities = page.getByRole('spinbutton', { name: /^Quantity from / });
  await expect(quantities).toHaveCount(2);
  for (const input of await quantities.all()) await input.fill('0');
  const confirm = page.getByRole('button', { name: 'Confirm with Unsourced Quantity', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox', { name: /^Leave 2 unsourced\./ }).check();
  const pending = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${soId}/sourcing`) && response.request().method() === 'POST', { timeout: 90_000 });
  await confirm.click();
  const response = await pending;
  const body = await response.json();
  expect(response.ok(), body.error).toBe(true);
  expect(body.success).toBe(true);
}

async function verifyFinalAllocationArtifacts(page: Page, config: LiveE2EConfig, documents: Documents, allocationId: number, verified = ['UI allocate/reassign/promise/release', 'API resize up/down', 'same-key replay', 'changed-payload/stale/over-demand rejection', 'incoming never becomes physical stock', 'committed demand unchanged', 'Xero Draft totals']) {
  const snapshot = await loadAllocationFixtureSnapshot(config);
  expect(snapshot.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: documents.salesOrderIds.length * 2 });
  expect(snapshot.allocations.filter(row => row.state === 'active')).toHaveLength(0);
  const availabilityResponse = await page.request.get('/api/ims/stock-availability');
  const availability = await availabilityResponse.json();
  expect(availabilityResponse.ok()).toBe(true);
  expect(availability.success).toBe(true);
  expect(Array.isArray(availability.data)).toBe(true);
  for (const soId of documents.salesOrderIds) {
    const demand = availability.data.filter((row: any) => Number(row.so_id) === soId);
    expect(demand).toHaveLength(1);
    expect(Number(demand[0].readyNowQuantity)).toBe(0);
    expect(Number(demand[0].unsourcedQuantity)).toBe(2);
  }
  for (const poId of documents.purchaseOrderIds) {
    const billResponse = await page.request.get(`/api/ims/xero/bill-details?poId=${poId}`);
    const bill = await billResponse.json();
    expect(billResponse.ok(), bill.error).toBe(true);
    expect(bill.status).toBe('DRAFT');
    expect(Number(bill.total)).toBe(config.maxDocumentTotal);
    expect(Number(bill.taxTotal)).toBe(0);
  }
  for (const soId of documents.salesOrderIds) {
    const invoiceResponse = await page.request.get(`/api/ims/xero/invoice-details?soId=${soId}`);
    const invoice = await invoiceResponse.json();
    expect(invoiceResponse.ok(), invoice.error).toBe(true);
    expect(invoice.status).toBe('DRAFT');
    expect(Number(invoice.total)).toBe(config.maxDocumentTotal);
    expect(Number(invoice.taxTotal)).toBe(0);
  }
  await appendManifestState(config.runId, 'awaiting_operator', {
    scenario: 'Incoming allocation', ...documents, allocationId, snapshot,
    verified,
  });
}

test('@allocation-create sets up two incoming drops and explicitly unsourced demand', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('preflight_passed');
  const baseline = await loadAllocationFixtureSnapshot(config);
  expect(baseline.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  expect(baseline.allocations.filter(row => row.state === 'active')).toHaveLength(0);
  await loginToIms(page, config);
  const documents: Documents = { purchaseOrderIds: [], salesOrderIds: [] };
  await checkpoint(config, documents, 'creating_documents');
  try {
    for (const label of ['PO1', 'PO2']) {
      documents.purchaseOrderIds.push(await createOrder(page, config, 'po', label));
      await checkpoint(config, documents, `${label}_created`);
      await expect.poll(async () => (await detail(page, 'purchase-orders', documents.purchaseOrderIds.at(-1)!)).status, { timeout: 45_000 }).toBe('confirmed');
    }
    const soId = await createOrder(page, config, 'so', 'SO1');
    documents.salesOrderIds.push(soId);
    await checkpoint(config, documents, 'SO1_draft_created');
    await confirmUnsourcedSalesOrder(page, soId);
    const snapshot = await loadAllocationFixtureSnapshot(config);
    expect(snapshot.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 2 });
    expect(snapshot.allocations.filter(allocation => allocation.state === 'active')).toHaveLength(0);
    await checkpoint(config, documents, 'documents_ready');
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Incoming allocation', phase: 'setup', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-confirm resumes only the exact interrupted draft confirmations', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  expect(documents.purchaseOrderIds).toHaveLength(2);
  expect(documents.salesOrderIds).toHaveLength(1);
  await loginToIms(page, config);
  await checkpoint(config, documents, 'resuming_confirmation');
  for (const poId of documents.purchaseOrderIds) {
    const order = await detail(page, 'purchase-orders', poId);
    expect(String(order.notes)).toContain(`LIVE E2E ${config.runId} ALLOCATION `);
    expect(['draft', 'confirmed']).toContain(order.status);
    if (order.status === 'draft') {
      const response = await page.request.put(`/api/ims/purchase-orders/${poId}`, { data: { status: 'confirmed', operationKey: `${config.runId}-resume-confirm-${poId}`, expectedUpdatedAt: order.updated_at } });
      const body = await response.json();
      expect(response.ok(), body.error).toBe(true);
      expect(body.success).toBe(true);
      expect(body.xeroWarning).toBeUndefined();
    }
    expect((await detail(page, 'purchase-orders', poId)).status).toBe('confirmed');
  }
  const soId = documents.salesOrderIds[0];
  expect((await detail(page, 'sales-orders', soId)).status).toBe('draft');
  await confirmUnsourcedSalesOrder(page, soId);
  expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 2 });
  await checkpoint(config, documents, 'documents_ready');
});

test('@allocation-multi-create sets up two competing unsourced SOs and two incoming POs', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  expect((await readManifest(config.runId)).at(-1)?.state).toBe('preflight_passed');
  expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  await loginToIms(page, config);
  const documents: Documents = { purchaseOrderIds: [], salesOrderIds: [] };
  await checkpoint(config, documents, 'creating_multi_documents');
  try {
    for (const label of ['PO1', 'PO2']) {
      const poId = await createOrder(page, config, 'po', label);
      documents.purchaseOrderIds.push(poId);
      await checkpoint(config, documents, `${label}_created`);
      await expect.poll(async () => (await detail(page, 'purchase-orders', poId)).status, { timeout: 45_000 }).toBe('confirmed');
    }
    for (const label of ['SO1', 'SO2']) {
      const soId = await createOrder(page, config, 'so', label);
      documents.salesOrderIds.push(soId);
      await checkpoint(config, documents, `${label}_draft_created`);
      await confirmUnsourcedSalesOrder(page, soId);
      await checkpoint(config, documents, `${label}_confirmed`);
    }
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 4 });
    await checkpoint(config, documents, 'multi_documents_ready');
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Multi-SO allocation', phase: 'setup', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-multi-exercise verifies competing requests and atomic batch protection', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  expect(documents.salesOrderIds).toHaveLength(2);
  expect(documents.purchaseOrderIds).toHaveLength(2);
  await loginToIms(page, config);
  await checkpoint(config, documents, 'multi_exercising');
  try {
    const salesOrders = await Promise.all(documents.salesOrderIds.map(id => detail(page, 'sales-orders', id)));
    const purchaseOrders = await Promise.all(documents.purchaseOrderIds.map(id => detail(page, 'purchase-orders', id)));
    const soItemIds = salesOrders.map(order => Number(order.items[0].id));
    const poItemIds = purchaseOrders.map(order => Number(order.items[0].id));
    const initial = await loadAllocationFixtureSnapshot(config);
    expect(initial.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 4 });
    expect(initial.allocations.filter(row => row.state === 'active')).toHaveLength(0);
    const competing = await Promise.all(soItemIds.map((soItemId, index) => page.request.post('/api/ims/stock-allocations', {
      data: { operationKey: `${config.runId}-race-${index}`, soItemId, poItemId: poItemIds[0], quantity: 2 },
    })));
    expect(competing.map(response => response.status()).sort()).toEqual([200, 409]);
    let snapshot = await loadAllocationFixtureSnapshot(config);
    let active = snapshot.allocations.filter(row => row.state === 'active');
    expect(active).toHaveLength(1);
    expect(Number(active[0].qty_allocated)).toBe(2);
    expect(snapshot.stock).toEqual(initial.stock);
    expect(snapshot.movements).toEqual(initial.movements);
    await command(page, { operationKey: `${config.runId}-release-race`, allocationId: Number(active[0].id), revision: Number(active[0].revision), action: 'release', reason: 'Live campaign release competing winner' });
    const batch = { operationKey: `${config.runId}-batch`, allocations: soItemIds.map(soItemId => ({ soItemId, poItemId: poItemIds[0], quantity: 1 })) };
    const createdResponse = await page.request.post('/api/ims/stock-allocations', { data: batch });
    const created = await createdResponse.json();
    expect(createdResponse.ok(), created.error).toBe(true);
    expect(created.data.allocationIds).toHaveLength(2);
    const batched = await loadAllocationFixtureSnapshot(config);
    active = batched.allocations.filter(row => row.state === 'active');
    expect(active).toHaveLength(2);
    expect(active.map(row => Number(row.qty_allocated))).toEqual([1, 1]);
    expect(batched.stock).toEqual(initial.stock);
    expect(batched.movements).toEqual(initial.movements);
    const replayResponse = await page.request.post('/api/ims/stock-allocations', { data: batch });
    const replay = await replayResponse.json();
    expect(replayResponse.ok(), replay.error).toBe(true);
    expect(replay.data.replayed).toBe(true);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(batched);
    const changedResponse = await page.request.post('/api/ims/stock-allocations', { data: { ...batch, allocations: [batch.allocations[0], { ...batch.allocations[1], quantity: 2 }] } });
    expect(changedResponse.status()).toBe(409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(batched);
    const invalidResponse = await page.request.post('/api/ims/stock-allocations', {
      data: { operationKey: `${config.runId}-atomic-rejection`, allocations: [
        { soItemId: soItemIds[0], poItemId: poItemIds[1], quantity: 1, overrideReason: 'Live campaign atomic rollback probe' },
        { soItemId: soItemIds[1], poItemId: poItemIds[1], quantity: 2, overrideReason: 'Live campaign atomic rollback probe' },
      ] },
    });
    expect(invalidResponse.status()).toBe(409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(batched);
    await command(page, { operationKey: `${config.runId}-shared-po-overflow`, allocationId: Number(active[0].id), revision: Number(active[0].revision), action: 'resize', quantity: 2, reason: 'Live campaign shared supply overflow probe' }, 409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(batched);
    for (const row of active) {
      await command(page, { operationKey: `${config.runId}-release-${row.id}`, allocationId: Number(row.id), revision: Number(row.revision), action: 'release', reason: 'Live campaign batch protection release' });
    }
    snapshot = await loadAllocationFixtureSnapshot(config);
    expect(snapshot.stock).toEqual(initial.stock);
    expect(snapshot.movements).toEqual(initial.movements);
    await checkpoint(config, documents, 'multi_mutations_verified');
    await verifyFinalAllocationArtifacts(page, config, documents, Number(active[0].id), ['concurrent competing SO requests: one winner', 'shared PO capacity enforcement', 'atomic batch allocation', 'exact batch replay', 'changed batch rejection', 'whole-batch rollback after valid first entry', 'release of all protections', 'stock/cost history unchanged', 'all four Xero Drafts']);
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Multi-SO allocation', phase: 'exercise', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-move-create sets up two low-value drafts without stock commitments', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  expect((await readManifest(config.runId)).at(-1)?.state).toBe('preflight_passed');
  const snapshot = await loadAllocationFixtureSnapshot(config);
  expect(snapshot.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  await loginToIms(page, config);
  const documents: Documents = { purchaseOrderIds: [], salesOrderIds: [] };
  await checkpoint(config, documents, 'creating_move_drafts');
  try {
    for (const label of ['MOVE-SOURCE', 'MOVE-TARGET']) {
      documents.salesOrderIds.push(await createOrder(page, config, 'so', label, config.maxDocumentTotal / 4));
      await checkpoint(config, documents, `${label}_created`);
    }
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual(snapshot.stock);
    await checkpoint(config, documents, 'move_drafts_ready');
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Draft SO movement', phase: 'setup', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-move-exercise verifies UI partial movement, replay guards and acknowledged consolidation', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  expect(documents.purchaseOrderIds).toHaveLength(0);
  expect(documents.salesOrderIds).toHaveLength(2);
  await loginToIms(page, config);
  await checkpoint(config, documents, 'move_exercising');
  try {
    const [sourceId, targetId] = documents.salesOrderIds;
    const initial = await loadAllocationFixtureSnapshot(config);
    const source = await detail(page, 'sales-orders', sourceId);
    const target = await detail(page, 'sales-orders', targetId);
    const orderSnapshot = async () => Promise.all(documents.salesOrderIds.map(async id => {
      const order = await detail(page, 'sales-orders', id);
      return { id, status: order.status, total: Number(order.total_amount), tax: Number(order.tax_amount), items: order.items.map((item: any) => ({ id: Number(item.id), variantId: String(item.variant_id), quantity: Number(item.qty_ordered), fulfilled: Number(item.qty_fulfilled), price: Number(item.unit_price) })) };
    }));
    const openMove = async () => {
      await page.goto('/ims');
      await page.getByTestId('ims-nav-__sales').click();
      await page.getByTestId('ims-nav-sales-orders').click();
      const row = page.getByTestId(`so-open-${sourceId}`).locator('xpath=ancestor::tr');
      await row.getByRole('combobox').selectOption({ label: 'Move items' }, { timeout: 15_000 });
      await row.getByRole('button', { name: 'Go' }).click();
      const dialog = page.getByRole('dialog', { name: source.so_number, exact: true });
      await expect(dialog.getByRole('spinbutton', { name: /^Quantity to move/ })).toBeVisible({ timeout: 45_000 });
      return dialog;
    };
    const chooseTarget = async (dialog: Awaited<ReturnType<typeof openMove>>) => {
      await dialog.getByRole('button', { name: 'Choose destination' }).click();
      await dialog.getByRole('radio', { name: new RegExp(`^${target.so_number}`) }).check();
      await dialog.getByRole('button', { name: 'Review move' }).click();
    };
    const dialog = await openMove();
    await dialog.getByRole('spinbutton', { name: /^Quantity to move/ }).fill('1');
    await chooseTarget(dialog);
    expect(await dialog.getByRole('checkbox').count()).toBe(0);
    const partialPending = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${sourceId}/transfers`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Move selected items' }).click();
    const partialResponse = await partialPending;
    const partial = await partialResponse.json();
    expect(partialResponse.ok(), partial.error).toBe(true);
    expect(partial.data.sourceStatus).toBe('draft');
    expect(Number(partial.data.targetOrderId)).toBe(targetId);
    const request = partialResponse.request().postDataJSON();
    const afterPartial = await orderSnapshot();
    expect(afterPartial.map(order => order.items.reduce((total: number, item: any) => total + item.quantity, 0))).toEqual([1, 3]);
    expect(afterPartial.map(order => order.total)).toEqual([config.maxDocumentTotal / 4, config.maxDocumentTotal * 3 / 4]);
    const replayResponse = await page.request.post(`/api/ims/sales-orders/${sourceId}/transfers`, { data: request });
    const replay = await replayResponse.json();
    expect(replayResponse.ok(), replay.error).toBe(true);
    expect(replay.data.replayed).toBe(true);
    expect(await orderSnapshot()).toEqual(afterPartial);
    const changedResponse = await page.request.post(`/api/ims/sales-orders/${sourceId}/transfers`, { data: { ...request, lines: [{ ...request.lines[0], quantity: 2 }] } });
    expect(changedResponse.status()).toBe(409);
    expect(await orderSnapshot()).toEqual(afterPartial);
    const staleResponse = await page.request.post(`/api/ims/sales-orders/${sourceId}/transfers`, { data: { ...request, operationKey: `${config.runId}-stale-move` } });
    expect(staleResponse.status()).toBe(409);
    expect(await orderSnapshot()).toEqual(afterPartial);
    const currentSource = await detail(page, 'sales-orders', sourceId);
    const currentTarget = await detail(page, 'sales-orders', targetId);
    const excessiveResponse = await page.request.post(`/api/ims/sales-orders/${sourceId}/transfers`, { data: {
      ...request, operationKey: `${config.runId}-excess-move`, expectedSourceUpdatedAt: currentSource.updated_at,
      expectedTargetUpdatedAt: currentTarget.updated_at, lines: [{ ...request.lines[0], quantity: 2 }],
    } });
    expect(excessiveResponse.status()).toBe(409);
    expect(await orderSnapshot()).toEqual(afterPartial);
    const consolidationDialog = await openMove();
    await chooseTarget(consolidationDialog);
    const move = consolidationDialog.getByRole('button', { name: 'Move selected items' });
    await expect(move).toBeDisabled();
    await consolidationDialog.getByRole('checkbox', { name: /^I understand .* will close/ }).check();
    const consolidatedPending = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${sourceId}/transfers`) && response.request().method() === 'POST');
    await move.click();
    const consolidatedResponse = await consolidatedPending;
    const consolidated = await consolidatedResponse.json();
    expect(consolidatedResponse.ok(), consolidated.error).toBe(true);
    expect(consolidated.data.sourceStatus).toBe('cancelled');
    const finalOrders = await orderSnapshot();
    expect(finalOrders.map(order => order.items.reduce((total: number, item: any) => total + item.quantity, 0))).toEqual([0, 4]);
    expect(finalOrders.map(order => order.total)).toEqual([0, config.maxDocumentTotal]);
    expect(finalOrders.map(order => order.tax)).toEqual([0, 0]);
    expect(finalOrders[1].items.every((item: any) => item.variantId === config.fixtureVariantId && item.fulfilled === 0 && item.price === config.maxDocumentTotal / 4)).toBe(true);
    const snapshot = await loadAllocationFixtureSnapshot(config);
    expect(snapshot).toEqual(initial);
    await checkpoint(config, documents, 'move_lifecycle_verified');
    await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'Draft SO movement', ...documents, snapshot, finalOrders,
      verified: ['UI partial move into compatible existing draft', 'exact replay', 'changed-key-payload/stale/excess rejection', 'UI acknowledgement required for full consolidation', 'empty source cancelled', 'quantity and value preserved', 'stock and cost history unchanged'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Draft SO movement', phase: 'exercise', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-protected-prepare confirms movement drafts and protects incoming supply', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  expect(documents.purchaseOrderIds.length).toBeLessThanOrEqual(2);
  expect(documents.salesOrderIds).toHaveLength(2);
  await loginToIms(page, config);
  try {
    for (const label of ['PO1', 'PO2'].slice(documents.purchaseOrderIds.length)) {
      const poId = await createOrder(page, config, 'po', label);
      documents.purchaseOrderIds.push(poId);
      await checkpoint(config, documents, `${label}_created`);
      await expect.poll(async () => (await detail(page, 'purchase-orders', poId)).status, { timeout: 45_000 }).toBe('confirmed');
    }
    for (const soId of documents.salesOrderIds) {
      const order = await detail(page, 'sales-orders', soId);
      expect(['draft', 'confirmed']).toContain(order.status);
      if (order.status === 'draft') await confirmUnsourcedSalesOrder(page, soId);
      await expect.poll(async () => (await detail(page, 'sales-orders', soId)).xero_invoice_id ?? null, { timeout: 45_000 }).not.toBeNull();
    }
    const source = await detail(page, 'sales-orders', documents.salesOrderIds[0]);
    const po = await detail(page, 'purchase-orders', documents.purchaseOrderIds[0]);
    const response = await page.request.post('/api/ims/stock-allocations', { data: { operationKey: `${config.runId}-protect-source`, soItemId: Number(source.items[0].id), poItemId: Number(po.items[0].id), quantity: 2 } });
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 4 });
    await checkpoint(config, documents, 'protected_move_ready');
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Confirmed protected SO movement', phase: 'setup', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-protected-move verifies allocation splitting and confirmed commitment conservation', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  expect(documents.purchaseOrderIds).toHaveLength(2);
  expect(documents.salesOrderIds).toHaveLength(2);
  await loginToIms(page, config);
  await checkpoint(config, documents, 'protected_move_exercising');
  try {
    const [sourceId, targetId] = documents.salesOrderIds;
    const source = await detail(page, 'sales-orders', sourceId);
    const target = await detail(page, 'sales-orders', targetId);
    expect(source.status).toBe('confirmed');
    expect(target.status).toBe('confirmed');
    const initial = await loadAllocationFixtureSnapshot(config);
    expect(initial.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 4 });
    const protectedQuantities = async () => {
      const snapshot = await loadAllocationFixtureSnapshot(config);
      expect(snapshot.stock).toEqual(initial.stock);
      expect(snapshot.movements).toEqual(initial.movements);
      return documents.salesOrderIds.map(id => snapshot.allocations.filter(row => row.state === 'active' && Number(row.so_id) === id).reduce((total, row) => total + Number(row.qty_allocated) - Number(row.qty_fulfilled), 0));
    };
    expect(await protectedQuantities()).toEqual([2, 0]);
    const openMove = async () => {
      await page.goto('/ims');
      await page.getByTestId('ims-nav-__sales').click();
      await page.getByTestId('ims-nav-sales-orders').click();
      await useCurrentSalesDates(page);
      const row = page.getByTestId(`so-open-${sourceId}`).locator('xpath=ancestor::tr');
      await row.getByRole('combobox').selectOption({ label: 'Move items' }, { timeout: 15_000 });
      await row.getByRole('button', { name: 'Go' }).click();
      const dialog = page.getByRole('dialog', { name: source.so_number, exact: true });
      await expect(dialog.getByRole('spinbutton', { name: /^Quantity to move/ })).toBeVisible({ timeout: 45_000 });
      return dialog;
    };
    for (const step of ['partial', 'remaining']) {
      const dialog = await openMove();
      await dialog.getByRole('spinbutton', { name: /^Quantity to move/ }).fill('1');
      await dialog.getByRole('spinbutton', { name: /^Protected incoming to move/ }).fill('1');
      await dialog.getByRole('button', { name: 'Choose destination' }).click();
      await dialog.getByRole('radio', { name: new RegExp(`^${target.so_number}`) }).check();
      await dialog.getByRole('button', { name: 'Review move' }).click();
      const move = dialog.getByRole('button', { name: 'Move selected items' });
      if (step === 'remaining') {
        await expect(move).toBeDisabled();
        await dialog.getByRole('checkbox', { name: /^I understand .* will close/ }).check();
      }
      const pending = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${sourceId}/transfers`) && response.request().method() === 'POST');
      await move.click();
      const response = await pending;
      const body = await response.json();
      expect(response.ok(), body.error).toBe(true);
      expect(Number(body.data.movedLines[0].allocatedIncomingQuantity)).toBe(1);
      expect(await protectedQuantities()).toEqual(step === 'partial' ? [1, 1] : [0, 2]);
      if (step === 'partial') {
        const beforeReplay = await loadAllocationFixtureSnapshot(config);
        const replayResponse = await page.request.post(`/api/ims/sales-orders/${sourceId}/transfers`, { data: response.request().postDataJSON() });
        const replay = await replayResponse.json();
        expect(replayResponse.ok(), replay.error).toBe(true);
        expect(replay.data.replayed).toBe(true);
        expect(await loadAllocationFixtureSnapshot(config)).toEqual(beforeReplay);
      }
    }
    const finalSource = await detail(page, 'sales-orders', sourceId);
    const finalTarget = await detail(page, 'sales-orders', targetId);
    expect(finalSource.status).toBe('cancelled');
    expect(finalTarget.status).toBe('confirmed');
    expect(Number(finalSource.total_amount)).toBe(0);
    expect(Number(finalTarget.total_amount)).toBe(config.maxDocumentTotal);
    await checkpoint(config, documents, 'protected_transfer_verified');
    const accounting = [];
    for (const order of [finalSource, finalTarget]) {
      const original = Number(order.id) === sourceId ? source : target;
      const remote = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${original.xero_invoice_id}`, { method: 'GET' });
      expect(remote.Invoices).toHaveLength(1);
      accounting.push({ id: Number(order.id), imsStatus: order.status, imsTotal: Number(order.total_amount), xeroStatus: remote.Invoices[0].Status, xeroTotal: Number(remote.Invoices[0].Total) });
    }
    await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'Confirmed protected SO movement', ...documents, snapshot: await loadAllocationFixtureSnapshot(config), accounting,
      verified: ['UI split and consolidate protected incoming allocations', 'allocation follows exact chosen quantity', 'partial replay adds no allocation', 'combined commitments unchanged', 'no physical movement or cost rewrite'],
      accountingMatches: accounting.every(row => row.imsStatus === 'cancelled' ? ['DELETED', 'VOIDED'].includes(row.xeroStatus) : row.imsTotal === row.xeroTotal) });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Confirmed protected SO movement', phase: 'exercise', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-protected-verify reads final transfer and original Xero accounting without repeating moves', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  await loginToIms(page, config);
  const orders = await Promise.all(documents.salesOrderIds.map(id => detail(page, 'sales-orders', id)));
  expect(orders.map(order => order.status)).toEqual(['cancelled', 'confirmed']);
  expect(orders.map(order => Number(order.total_amount))).toEqual([0, config.maxDocumentTotal]);
  const snapshot = await loadAllocationFixtureSnapshot(config);
  expect(snapshot.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 4 });
  expect(documents.salesOrderIds.map(id => snapshot.allocations.filter(row => row.state === 'active' && Number(row.so_id) === id).reduce((sum, row) => sum + Number(row.qty_allocated), 0))).toEqual([0, 2]);
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306), database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  const accounting = [];
  try {
    await connection.query('START TRANSACTION READ ONLY');
    for (const order of orders) {
      const [logs] = await connection.query<mysql.RowDataPacket[]>("SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'so_invoice' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [config.expectedBusinessId, order.id]);
      expect(logs).toHaveLength(1);
      const remote = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${logs[0].xero_id}`, { method: 'GET' });
      expect(remote.Invoices).toHaveLength(1);
      const invoice = remote.Invoices[0];
      if (order.status === 'cancelled') expect(['DELETED', 'VOIDED']).toContain(invoice.Status);
      else expect(Number(invoice.Total)).toBe(Number(order.total_amount));
      expect(Number(invoice.TotalTax)).toBe(0);
      accounting.push({ id: Number(order.id), imsStatus: order.status, imsTotal: Number(order.total_amount), xeroStatus: invoice.Status, xeroTotal: Number(invoice.Total) });
    }
  } finally { await connection.rollback(); await connection.end(); }
  await checkpoint(config, documents, 'protected_transfer_and_accounting_verified');
  await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'Confirmed protected SO movement', ...documents, snapshot, accounting, accountingMatches: true,
    verified: ['protected partial movement and consolidation', 'allocation replay adds nothing', 'commitment/physical stock conservation', 'original source Xero invoice deleted/voided', 'target Xero total matches consolidation'] });
});

test('@allocation-received-exercise verifies physical protection and release back to SO priority', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation-received');
  const documents = await recordedDocuments(config);
  expect(documents.purchaseOrderIds).toHaveLength(2);
  expect(documents.salesOrderIds).toHaveLength(2);
  await loginToIms(page, config);
  await checkpoint(config, documents, 'received_exercising');
  try {
    const [olderId, newerId] = documents.salesOrderIds;
    const poId = documents.purchaseOrderIds[0];
    const older = await detail(page, 'sales-orders', olderId);
    const newer = await detail(page, 'sales-orders', newerId);
    const po = await detail(page, 'purchase-orders', poId);
    const alternativePo = await detail(page, 'purchase-orders', documents.purchaseOrderIds[1]);
    const initial = await loadAllocationFixtureSnapshot(config);
    expect(initial.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 4 });
    expect(initial.allocations.filter(row => row.state === 'active')).toHaveLength(0);
    const allocationResponse = await page.request.post('/api/ims/stock-allocations', { data: {
      operationKey: `${config.runId}-protect-newer`, soItemId: Number(newer.items[0].id), poItemId: Number(po.items[0].id), quantity: 2,
    } });
    const allocationBody = await allocationResponse.json();
    expect(allocationResponse.ok(), allocationBody.error).toBe(true);
    const allocationId = Number(allocationBody.data.allocationId);
    documents.receivedPurchaseOrderIds = [poId];
    await checkpoint(config, documents, 'exact_receipt_authorized');
    await page.goto('/ims');
    await page.getByTestId('ims-nav-__purchasing').click();
    await page.getByTestId('ims-nav-purchase-orders').click();
    const poRow = page.getByTestId(`po-open-${poId}`).locator('xpath=ancestor::tr');
    await poRow.getByRole('combobox').selectOption('receive');
    await poRow.getByRole('button', { name: 'Go' }).click();
    await page.getByTestId('po-line-0-received').fill('2');
    await page.getByTestId('po-supplier-invoice-number').fill(`E2E-${config.runId}`);
    const receiving = page.waitForResponse(response => response.url().endsWith('/api/ims/receive/batch') && response.request().method() === 'POST', { timeout: 90_000 });
    await page.getByTestId('po-receive-complete').dispatchEvent('click');
    const receivedResponse = await receiving;
    const receivedBody = await receivedResponse.json();
    expect(receivedResponse.ok(), receivedBody.error).toBe(true);
    expect(receivedBody.success).toBe(true);
    await expect.poll(async () => (await detail(page, 'purchase-orders', poId)).status).toBe('complete');
    const received = await loadAllocationFixtureSnapshot(config);
    expect(received.stock).toEqual({ qtyOnHand: 2, qtyIncoming: 2, qtyCommitted: 4 });
    const active = received.allocations.find(row => Number(row.id) === allocationId)!;
    expect(active.state).toBe('active');
    expect(Number(active.qty_received_assigned)).toBe(2);
    expect(Number(active.qty_fulfilled)).toBe(0);
    const receiptMovements = received.movements.filter(row => !initial.movements.some(before => Number(before.id) === Number(row.id)));
    expect(receiptMovements).toHaveLength(1);
    expect(Number(receiptMovements[0].qty_change)).toBe(2);
    expect(Number(receiptMovements[0].unit_cost)).toBe(config.maxDocumentTotal / 2);
    expect(receiptMovements[0].cost_method_snapshot).toBe(config.expectedCostingMethod);
    const readiness = async () => {
      const response = await page.request.get('/api/ims/stock-availability');
      const body = await response.json();
      expect(response.ok(), body.error).toBe(true);
      return documents.salesOrderIds.map(id => body.data.find((row: any) => Number(row.so_id) === id));
    };
    const protectedRows = await readiness();
    expect(protectedRows.map(row => Number(row.readyNowQuantity))).toEqual([0, 2]);
    expect(protectedRows.map(row => Number(row.protectedReadyQuantity))).toEqual([0, 2]);
    expect(Number(protectedRows[0].protectedReadyReservedForOthers)).toBe(2);
    const shipmentResponse = await page.request.post(`/api/ims/sales-orders/${olderId}/fulfil`, { data: {
      operationKey: `${config.runId}-protected-shipment-rejection`, shipmentQuantities: [{ itemId: Number(older.items[0].id), quantity: 1 }], allowNegativeStock: true,
    } });
    const shipment = await shipmentResponse.json();
    expect(shipmentResponse.status(), shipment.error).toBe(409);
    expect(shipment.code).toBe('PROTECTED_STOCK_CONFLICT');
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(received);
    expect(Number((await detail(page, 'sales-orders', olderId)).items[0].qty_fulfilled)).toBe(0);
    await command(page, { operationKey: `${config.runId}-received-shrink`, allocationId, revision: Number(active.revision), action: 'resize', quantity: 1 }, 409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(received);
    await command(page, { operationKey: `${config.runId}-received-reassign`, allocationId, revision: Number(active.revision), action: 'reassign', poItemId: Number(alternativePo.items[0].id), reason: 'Live campaign received reassignment rejection' }, 409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(received);
    await command(page, { operationKey: `${config.runId}-release-received`, allocationId, revision: Number(active.revision), action: 'release', reason: 'Live campaign release back to ordinary priority' });
    const released = await loadAllocationFixtureSnapshot(config);
    expect(released.stock).toEqual(received.stock);
    expect(released.movements).toEqual(received.movements);
    const releasedRows = await readiness();
    expect(releasedRows.map(row => Number(row.readyNowQuantity))).toEqual([2, 0]);
    expect(releasedRows.map(row => Number(row.protectedReadyQuantity))).toEqual([0, 0]);
    const externalDocuments: { kind: string; id: number; xeroId: string }[] = [];
    for (const [kind, ids] of [['purchase-orders', documents.purchaseOrderIds], ['sales-orders', documents.salesOrderIds]] as const) {
      for (const id of ids) {
        const order = await detail(page, kind, id);
        const xeroId = String(kind === 'purchase-orders' ? order.xero_bill_id : order.xero_invoice_id);
        expect(xeroId).toMatch(/^[a-f0-9-]{36}$/i);
        const remote = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${xeroId}`, { method: 'GET' });
        expect(remote.Invoices).toHaveLength(1);
        expect(Number(remote.Invoices[0].Total)).toBe(config.maxDocumentTotal);
        expect(Number(remote.Invoices[0].TotalTax)).toBe(0);
        externalDocuments.push({ kind, id, xeroId });
      }
    }
    await checkpoint(config, documents, 'received_lifecycle_verified');
    await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'Received allocation', ...documents, allocationId, snapshot: released, externalDocuments,
      verified: ['UI two-unit receipt at captured cost', 'received stock protected for newer SO', 'older SO shipment hard-blocked even with negative override', 'received shrink/reassign rejected', 'release restores older SO priority', 'all four Xero totals and tax'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Received allocation', phase: 'exercise', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-received-compensate cancels exact unshipped demand and undoes only the recorded receipt', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation-received-compensate');
  const events = await readManifest(config.runId);
  expect(['acknowledged', 'compensation_retry_authorized']).toContain(events.at(-1)?.state);
  const documents = await recordedDocuments(config);
  expect(documents.receivedPurchaseOrderIds).toHaveLength(1);
  const externalDocuments = (events.findLast(event => event.state === 'awaiting_operator')?.details as { externalDocuments?: { kind: string; id: number; xeroId: string }[] })?.externalDocuments;
  expect(externalDocuments).toHaveLength(4);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'Received allocation', ...documents });
  try {
    for (const [kind, ids] of [['sales-orders', documents.salesOrderIds], ['purchase-orders', documents.purchaseOrderIds]] as const) {
      for (const id of ids) {
        const order = await detail(page, kind, id);
        expect(String(order.notes)).toContain(`LIVE E2E ${config.runId} ALLOCATION `);
        expect(Number(order.location_id)).toBe(config.fixtureLocationId);
        expect(order.items).toHaveLength(1);
        expect(String(order.items[0].variant_id)).toBe(config.fixtureVariantId);
        expect(Number(order.total_amount)).toBe(config.maxDocumentTotal);
        if (order.status === 'cancelled') continue;
        const undo = kind === 'purchase-orders' && documents.receivedPurchaseOrderIds!.includes(id);
        if (kind === 'sales-orders') expect(Number(order.items[0].qty_fulfilled)).toBe(0);
        else expect(Number(order.items[0].qty_received)).toBe(undo ? 2 : 0);
        const data = { operationKey: `${config.runId}-${undo ? 'undo' : 'cancel'}-${kind}-${id}`, expectedUpdatedAt: order.updated_at, ...(!undo ? { status: 'cancelled' } : {}) };
        const response = undo ? await page.request.post(`/api/ims/${kind}/${id}/undo-receipt`, { data }) : await page.request.put(`/api/ims/${kind}/${id}`, { data });
        const body = await response.json();
        expect(response.ok(), body.error).toBe(true);
        expect(body.success).toBe(true);
        expect(body.xeroWarning).toBeUndefined();
        expect((await detail(page, kind, id)).status).toBe('cancelled');
      }
    }
    const snapshot = await loadAllocationFixtureSnapshot(config);
    expect(snapshot.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
    expect(snapshot.allocations.filter(row => row.state === 'active')).toHaveLength(0);
    const externalStatuses = [];
    for (const artifact of externalDocuments!) {
      expect((artifact.kind === 'purchase-orders' ? documents.purchaseOrderIds : documents.salesOrderIds)).toContain(artifact.id);
      const remote = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${artifact.xeroId}`, { method: 'GET' });
      expect(remote.Invoices).toHaveLength(1);
      expect(['DELETED', 'VOIDED']).toContain(remote.Invoices[0].Status);
      externalStatuses.push({ kind: artifact.kind, id: artifact.id, status: remote.Invoices[0].Status });
    }
    await appendManifestState(config.runId, 'clean', { scenario: 'Received allocation', ...documents, snapshot, externalStatuses, storeCreditIssued: 0,
      permanentArtifacts: ['Cancelled unshipped SOs', 'Exact mistaken receipt and undo movements', 'Released protected allocation history', 'Deleted/voided Xero documents and audit history'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Received allocation', phase: 'compensation', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-exercise verifies incoming protection, resize, stale/replay guards, reassignment and release', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  expect(documents.purchaseOrderIds).toHaveLength(2);
  expect(documents.salesOrderIds).toHaveLength(1);
  await loginToIms(page, config);
  await checkpoint(config, documents, 'exercising');
  try {
    const soId = documents.salesOrderIds[0];
    const firstPo = await detail(page, 'purchase-orders', documents.purchaseOrderIds[0]);
    const secondPo = await detail(page, 'purchase-orders', documents.purchaseOrderIds[1]);
    const poItemId = Number(firstPo.items[0].id);
    const alternativePoItemId = Number(secondPo.items[0].id);
    const initial = await loadAllocationFixtureSnapshot(config);
    expect(initial.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 2 });
    expect(initial.allocations.filter(row => row.state === 'active')).toHaveLength(0);
    await openSalesOrder(page, soId);
    await page.getByLabel(`Incoming PO for ${config.fixtureSku}`, { exact: true }).selectOption(String(poItemId));
    await page.getByLabel(`Allocation quantity for ${config.fixtureSku}`, { exact: true }).fill('1');
    const override = page.getByLabel(`FIFO override reason for ${config.fixtureSku}`, { exact: true });
    if (await override.isVisible()) await override.fill('Live campaign first-drop selection');
    const allocatedResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/stock-allocations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Allocate', exact: true }).click();
    const allocated = await allocatedResponse;
    const allocatedBody = await allocated.json();
    expect(allocated.ok(), allocatedBody.error).toBe(true);
    let snapshot = await loadAllocationFixtureSnapshot(config);
    let active = snapshot.allocations.filter(row => row.state === 'active');
    expect(active).toHaveLength(1);
    expect(Number(active[0].qty_allocated)).toBe(1);
    expect(snapshot.stock).toEqual(initial.stock);
    expect(snapshot.movements).toEqual(initial.movements);
    const allocationId = Number(active[0].id);
    const oldRevision = Number(active[0].revision);
    const resize = { operationKey: `${config.runId}-resize`, allocationId, revision: oldRevision, action: 'resize', quantity: 2, reason: 'Live campaign resize' };
    await command(page, resize);
    const resized = await loadAllocationFixtureSnapshot(config);
    expect(Number(resized.allocations.find(row => Number(row.id) === allocationId)?.qty_allocated)).toBe(2);
    await command(page, resize);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(resized);
    await command(page, { ...resize, quantity: 1 }, 409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(resized);
    await command(page, { ...resize, operationKey: `${config.runId}-stale`, quantity: 1 }, 409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(resized);
    const currentRevision = Number(resized.allocations.find(row => Number(row.id) === allocationId)?.revision);
    await command(page, { ...resize, operationKey: `${config.runId}-too-much`, revision: currentRevision, quantity: 3 }, 409);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(resized);
    await command(page, { ...resize, operationKey: `${config.runId}-shrink`, revision: currentRevision, quantity: 1 });
    await openSalesOrder(page, soId);
    const reassignedResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/stock-allocations') && response.request().method() === 'PATCH');
    let promptIndex = 0;
    const reassignPrompt = async (dialog: import('@playwright/test').Dialog) => {
      const answer = promptIndex++ === 0 ? String(alternativePoItemId) : 'Live campaign alternate-drop reassignment';
      await dialog.accept(answer);
    };
    page.on('dialog', reassignPrompt);
    try {
      await page.getByRole('button', { name: 'Reassign', exact: true }).click();
      const response = await reassignedResponse;
      const body = await response.json();
      expect(response.ok(), body.error).toBe(true);
    } finally { page.off('dialog', reassignPrompt); }
    snapshot = await loadAllocationFixtureSnapshot(config);
    active = snapshot.allocations.filter(row => row.state === 'active');
    expect(Number(active[0].po_item_id)).toBe(alternativePoItemId);
    expect(snapshot.stock).toEqual(initial.stock);
    await openSalesOrder(page, soId);
    const promisedResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/stock-allocations') && response.request().method() === 'PATCH');
    promptIndex = 0;
    const promiseDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const promisePrompt = async (dialog: import('@playwright/test').Dialog) => { await dialog.accept(promptIndex++ === 0 ? promiseDate : 'Live campaign promise review'); };
    page.on('dialog', promisePrompt);
    try {
      await page.getByRole('button', { name: 'Promise', exact: true }).click();
      const response = await promisedResponse;
      const body = await response.json();
      expect(response.ok(), body.error).toBe(true);
    } finally { page.off('dialog', promisePrompt); }
    snapshot = await loadAllocationFixtureSnapshot(config);
    expect(snapshot.allocations.find(row => Number(row.id) === allocationId)?.promised_date).toBe(promiseDate);
    await openSalesOrder(page, soId);
    const releasedResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/stock-allocations') && response.request().method() === 'PATCH');
    page.once('dialog', dialog => dialog.accept('Live campaign protection release'));
    await page.getByRole('button', { name: 'Release', exact: true }).click();
    const released = await releasedResponse;
    const releasedBody = await released.json();
    expect(released.ok(), releasedBody.error).toBe(true);
    snapshot = await loadAllocationFixtureSnapshot(config);
    expect(snapshot.allocations.filter(row => row.state === 'active')).toHaveLength(0);
    expect(snapshot.stock).toEqual(initial.stock);
    expect(snapshot.movements).toEqual(initial.movements);
    await checkpoint(config, documents, 'mutations_verified');
    await verifyFinalAllocationArtifacts(page, config, documents, allocationId);
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Incoming allocation', phase: 'exercise', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@allocation-verify completes read-only checks after the already verified release', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  const snapshot = await loadAllocationFixtureSnapshot(config);
  const owned = snapshot.allocations.filter(row => Number(row.so_id) === documents.salesOrderIds[0]);
  expect(owned).toHaveLength(1);
  expect(owned[0].state).toBe('released');
  expect(Number(owned[0].revision)).toBe(6);
  expect(Number(owned[0].qty_allocated)).toBe(1);
  expect(Number(owned[0].po_id)).toBe(documents.purchaseOrderIds[1]);
  await loginToIms(page, config);
  await checkpoint(config, documents, 'resuming_read_only_verification');
  await verifyFinalAllocationArtifacts(page, config, documents, Number(owned[0].id));
});

test('@allocation-inspect verifies recorded artifacts before cleanup of a failed scenario', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const documents = await recordedDocuments(config);
  await loginToIms(page, config);
  for (const [kind, ids] of [['sales-orders', documents.salesOrderIds], ['purchase-orders', documents.purchaseOrderIds]] as const) {
    for (const id of ids) {
      const order = await detail(page, kind, id);
      expect(String(order.notes)).toContain(`LIVE E2E ${config.runId} ALLOCATION `);
      expect(Number(order.location_id)).toBe(config.fixtureLocationId);
      expect(order.items.every((item: any) => String(item.variant_id) === config.fixtureVariantId && Number(kind === 'sales-orders' ? item.qty_fulfilled : item.qty_received) === 0)).toBe(true);
    }
  }
  const snapshot = await loadAllocationFixtureSnapshot(config);
  expect(snapshot.stock.qtyOnHand).toBe(0);
  await checkpoint(config, documents, 'failed_scenario_artifacts_inspected');
  await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'Incoming allocation', ...documents, snapshot, fullLifecycleVerified: false });
});

test('@allocation-compensate cancels only the recorded unreceived and unshipped orders', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation-compensate');
  const events = await readManifest(config.runId);
  expect(['acknowledged', 'compensation_retry_authorized']).toContain(events.at(-1)?.state);
  const documents = await recordedDocuments(config);
  const movementCleanup = (events.findLast(event => event.state === 'awaiting_operator')?.details as { scenario?: string })?.scenario === 'Draft SO movement';
  const retainedDraftInvoices: { id: number; xeroId: string }[] = [];
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'Incoming allocation', ...documents });
  try {
    const allocations = (await loadAllocationFixtureSnapshot(config)).allocations.filter(row => row.state === 'active');
    for (const allocation of allocations) {
      expect(documents.salesOrderIds).toContain(Number(allocation.so_id));
      expect(documents.purchaseOrderIds).toContain(Number(allocation.po_id));
      expect(Number(allocation.qty_received_assigned)).toBe(0);
      expect(Number(allocation.qty_fulfilled)).toBe(0);
      await command(page, { operationKey: `${config.runId}-cleanup-release-${allocation.id}`, allocationId: Number(allocation.id), revision: Number(allocation.revision), action: 'release', reason: 'Release exact campaign protection before supported cancellation' });
    }
    for (const [kind, ids] of [['sales-orders', documents.salesOrderIds], ['purchase-orders', documents.purchaseOrderIds]] as const) {
      for (const id of ids) {
        let order = await detail(page, kind, id);
        expect(String(order.notes)).toContain(`LIVE E2E ${config.runId} ALLOCATION `);
        expect(Number(order.location_id)).toBe(config.fixtureLocationId);
        expect(order.items.every((item: any) => String(item.variant_id) === config.fixtureVariantId && Number(kind === 'sales-orders' ? item.qty_fulfilled : item.qty_received) === 0)).toBe(true);
        if (order.status === 'cancelled') continue;
        if (kind === 'sales-orders' && order.status === 'draft') {
          expect(movementCleanup).toBe(true);
          expect(documents.purchaseOrderIds).toHaveLength(0);
          expect(Number(order.customer_id)).toBe(config.fixtureCustomerId);
          expect(Number(order.total_amount)).toBeGreaterThan(0);
          expect(Number(order.total_amount)).toBeLessThanOrEqual(config.maxDocumentTotal);
          const confirmation = await page.request.put(`/api/ims/sales-orders/${id}`, { data: { status: 'confirmed', operationKey: `${config.runId}-retain-confirm-${id}`, expectedUpdatedAt: order.updated_at } });
          const confirmed = await confirmation.json();
          expect(confirmation.ok(), confirmed.error).toBe(true);
          await expect.poll(async () => {
            const latest = await detail(page, 'sales-orders', id);
            return latest.xero_invoice_id ?? null;
          }, { timeout: 45_000 }).not.toBeNull();
          order = await detail(page, 'sales-orders', id);
          expect(order.status).toBe('confirmed');
          const remote = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${order.xero_invoice_id}`, { method: 'GET' });
          expect(remote.Invoices).toHaveLength(1);
          expect(remote.Invoices[0].Status).toBe('DRAFT');
          expect(Number(remote.Invoices[0].Total)).toBe(Number(order.total_amount));
          expect(Number(remote.Invoices[0].TotalTax)).toBe(0);
          retainedDraftInvoices.push({ id, xeroId: String(order.xero_invoice_id) });
        }
        const response = await page.request.put(`/api/ims/${kind}/${id}`, { data: { status: 'cancelled', operationKey: `${config.runId}-cancel-${kind}-${id}`, expectedUpdatedAt: order.updated_at ?? null } });
        const cancelled = await response.json();
        expect(response.ok(), cancelled.error).toBe(true);
        expect(cancelled.success).toBe(true);
        expect(cancelled.xeroWarning).toBeUndefined();
        expect((await detail(page, kind, id)).status).toBe('cancelled');
      }
    }
    const snapshot = await loadAllocationFixtureSnapshot(config);
    const baseline = (events[0].details as { baseline: typeof snapshot.stock }).baseline;
    expect(snapshot.stock).toMatchObject({ qtyOnHand: baseline.qtyOnHand, qtyIncoming: baseline.qtyIncoming, qtyCommitted: baseline.qtyCommitted });
    expect(snapshot.allocations.filter(row => row.state === 'active')).toHaveLength(0);
    for (const invoice of retainedDraftInvoices) {
      const remote = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${invoice.xeroId}`, { method: 'GET' });
      expect(remote.Invoices).toHaveLength(1);
      expect(remote.Invoices[0].Status).toBe('DELETED');
    }
    await appendManifestState(config.runId, 'clean', { scenario: movementCleanup ? 'Draft SO movement' : 'Incoming allocation', ...documents, snapshot, retainedDraftInvoices, permanentArtifacts: ['Cancelled unreceived POs and unshipped SO', 'Released allocation or SO transfer history', 'Deleted Xero Draft audit history'], storeCreditIssued: 0 });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Incoming allocation', phase: 'compensation', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});