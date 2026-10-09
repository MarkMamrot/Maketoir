import { expect, test, type Page } from '@playwright/test';

import { loadLiveE2EConfig, type LiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { loadAllocationFixtureSnapshot } from './support/database-preflight';

test.describe.configure({ timeout: 360_000 });

type Documents = { purchaseOrderIds: number[]; salesOrderIds: number[] };

async function recordedDocuments(config: LiveE2EConfig): Promise<Documents> {
  const events = await readManifest(config.runId);
  const details = events.findLast(event => event.state === 'allocation_created')?.details as Documents | undefined;
  return { purchaseOrderIds: [...(details?.purchaseOrderIds ?? [])], salesOrderIds: [...(details?.salesOrderIds ?? [])] };
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

async function createOrder(page: Page, config: LiveE2EConfig, kind: 'po' | 'so', label: string) {
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
  await page.getByTestId(kind === 'po' ? 'po-line-0-unit-cost' : 'so-line-price-0').fill(String(config.maxDocumentTotal / 2));
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
    }
    const soId = await createOrder(page, config, 'so', 'SO1');
    documents.salesOrderIds.push(soId);
    await checkpoint(config, documents, 'SO1_draft_created');
    await page.goto('/ims');
    await page.getByTestId('ims-nav-__sales').click();
    await page.getByTestId('ims-nav-sales-orders').click();
    const row = page.getByTestId(`so-open-${soId}`).locator('xpath=ancestor::tr');
    const pending = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${soId}/sourcing`) && response.request().method() === 'POST', { timeout: 90_000 });
    await row.getByRole('combobox').selectOption('confirm');
    await row.getByRole('button', { name: 'Go' }).click();
    await expect(page.getByRole('heading', { name: /^Stock sourcing/ })).toBeVisible({ timeout: 45_000 });
    const quantities = page.getByRole('spinbutton', { name: /^Quantity from / });
    await expect(quantities).toHaveCount(2);
    for (const input of await quantities.all()) await input.fill('0');
    const confirm = page.getByRole('button', { name: 'Confirm with Unsourced Quantity', exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByRole('checkbox', { name: /^Leave 2 unsourced\./ }).check();
    await confirm.click();
    const response = await pending;
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    expect(body.success).toBe(true);
    const snapshot = await loadAllocationFixtureSnapshot(config);
    expect(snapshot.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 4, qtyCommitted: 2 });
    expect(snapshot.allocations.filter(allocation => allocation.state === 'active')).toHaveLength(0);
    await checkpoint(config, documents, 'documents_ready');
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Incoming allocation', phase: 'setup', ...documents, error: error instanceof Error ? error.message : String(error) });
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
    const availabilityResponse = await page.request.get('/api/ims/stock-availability');
    const availability = await availabilityResponse.json();
    expect(availabilityResponse.ok()).toBe(true);
    const demand = availability.rows.filter((row: any) => Number(row.so_id) === soId);
    expect(demand).toHaveLength(1);
    expect(Number(demand[0].readiness.readyNowQuantity)).toBe(0);
    expect(Number(demand[0].readiness.unsourcedQuantity)).toBe(2);
    for (const poId of documents.purchaseOrderIds) {
      const billResponse = await page.request.get(`/api/ims/xero/bill-details?poId=${poId}`);
      const bill = await billResponse.json();
      expect(billResponse.ok(), bill.error).toBe(true);
      expect(bill.status).toBe('DRAFT');
      expect(Number(bill.total)).toBe(config.maxDocumentTotal);
      expect(Number(bill.taxTotal)).toBe(0);
    }
    const invoiceResponse = await page.request.get(`/api/ims/xero/invoice-details?soId=${soId}`);
    const invoice = await invoiceResponse.json();
    expect(invoiceResponse.ok(), invoice.error).toBe(true);
    expect(invoice.status).toBe('DRAFT');
    expect(Number(invoice.total)).toBe(config.maxDocumentTotal);
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'Incoming allocation', ...documents, allocationId, snapshot,
      verified: ['UI allocate/reassign/promise/release', 'API resize up/down', 'same-key replay', 'changed-payload/stale/over-demand rejection', 'incoming never becomes physical stock', 'committed demand unchanged', 'Xero Draft totals'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Incoming allocation', phase: 'exercise', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
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
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'Incoming allocation', ...documents });
  try {
    for (const [kind, ids] of [['sales-orders', documents.salesOrderIds], ['purchase-orders', documents.purchaseOrderIds]] as const) {
      for (const id of ids) {
        const order = await detail(page, kind, id);
        expect(String(order.notes)).toContain(`LIVE E2E ${config.runId} ALLOCATION `);
        expect(Number(order.location_id)).toBe(config.fixtureLocationId);
        expect(order.items.every((item: any) => String(item.variant_id) === config.fixtureVariantId && Number(kind === 'sales-orders' ? item.qty_fulfilled : item.qty_received) === 0)).toBe(true);
        if (order.status === 'cancelled') continue;
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
    await appendManifestState(config.runId, 'clean', { scenario: 'Incoming allocation', ...documents, snapshot, permanentArtifacts: ['Cancelled unreceived POs and unshipped SO', 'Released allocation history', 'Deleted Xero Draft audit history'], storeCreditIssued: 0 });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Incoming allocation', phase: 'compensation', ...documents, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});