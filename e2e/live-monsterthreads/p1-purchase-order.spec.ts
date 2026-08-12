import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { verifyPurchaseOrderCompensation } from './support/database-preflight';

test.describe.configure({ timeout: 120_000 });

async function openPurchaseOrders(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('ims-nav-__orders').click();
  await page.getByTestId('ims-nav-purchase-orders').click();
}

function purchaseOrderId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.purchaseOrderId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P1 purchase order ID.');
}

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
    await page.getByTestId(`po-receive-${poId}`).last().click();
    await page.getByTestId('po-line-0-received').fill('1');
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
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P1',
      purchaseOrderId: poId,
      purchaseOrderNumber: detail?.data?.po_number ?? null,
      xeroBillId: detail?.data?.xero_bill_id ?? null,
      operatorChecks: ['IMS PO is complete with quantity 1 received', 'Xero bill exists and matches the low-value PO'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'p1_created', { scenario: 'P1', phase: 'receive_attempt', purchaseOrderId: poId, receiveError: error instanceof Error ? error.message : String(error) }).catch(() => {});
    throw error;
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
    await appendManifestState(config.runId, 'clean', {
      scenario: 'P1',
      purchaseOrderId: poId,
      ...verification,
      permanentArtifacts: ['Cancelled IMS purchase order and immutable activity/stock history', 'Voided Xero bill and Xero audit history'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'P1', phase: 'compensation', purchaseOrderId: poId, error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    throw error;
  }
});