import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { verifySalesOrderAwaitingOperator, verifySalesOrderCompensation } from './support/database-preflight';

test.describe.configure({ timeout: 120_000 });

async function openSalesOrders(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('ims-nav-__orders').click();
  await page.getByTestId('ims-nav-sales-orders').click();
}

function salesOrderId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.salesOrderId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P2 sales order ID.');
}

test('@p2-create creates the isolated low-value Draft SO', async ({ page }) => {
  const config = loadLiveE2EConfig();
  let soId: number | null = null;
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('preflight_passed');
  await loginToIms(page, config);
  try {
    await openSalesOrders(page);
    await page.getByTestId('so-new').click();
    await page.getByTestId('so-customer').selectOption(String(config.fixtureCustomerId));
    await page.getByTestId('so-location').selectOption(String(config.fixtureLocationId));
    await page.getByTestId('so-notes').fill(`LIVE E2E ${config.runId} P2 - permanent audit artifact`);
    await page.getByTestId('so-tax-treatment').selectOption('no_tax');
    await page.getByTestId('so-line-0-variant').fill(config.fixtureSku);
    await page.getByTestId(`so-line-0-variant-option-${config.fixtureVariantId}`).click();
    await page.getByTestId('so-line-qty-0').fill('1');
    await page.getByTestId('so-line-price-0').fill(String(config.maxDocumentTotal));

    const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/sales-orders')
      && response.request().method() === 'POST');
    await page.getByTestId('so-create-draft').click();
    const response = await createdResponse;
    const created = await response.json() as { success?: boolean; id?: number; data?: { id?: number }; error?: string };
    expect(response.ok(), created.error).toBe(true);
    expect(created.success, created.error).toBe(true);
    soId = Number(created.id ?? created.data?.id);
    expect(soId).toBeGreaterThan(0);

    const detailResponse = await page.request.get(`/api/ims/sales-orders/${soId}`);
    const detail = await detailResponse.json();
    expect(detailResponse.ok()).toBe(true);
    expect(detail?.data?.status).toBe('draft');
    await appendManifestState(config.runId, 'p2_created', {
      scenario: 'P2',
      phase: 'draft_created',
      salesOrderId: soId,
      salesOrderNumber: detail?.data?.so_number ?? null,
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P2', phase: 'create_draft', salesOrderId: soId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

test('@p2-confirm confirms the existing SO and pauses for IMS and Xero inspection', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const soId = salesOrderId(events);
  expect(events.at(-1)?.state).toBe('p2_created');
  await loginToIms(page, config);
  try {
    await openSalesOrders(page);
    page.once('dialog', dialog => dialog.accept());
    const confirmResponse = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${soId}`)
      && response.request().method() === 'PUT');
    await page.getByTestId(`so-confirm-${soId}`).click();
    const response = await confirmResponse;
    const confirmed = await response.json() as { success?: boolean; error?: string };
    expect(response.ok(), confirmed.error).toBe(true);
    expect(confirmed.success, confirmed.error).toBe(true);

    await expect.poll(async () => {
      const detail = await (await page.request.get(`/api/ims/sales-orders/${soId}`)).json();
      return detail?.data?.xero_invoice_id ?? null;
    }, { timeout: 30_000, message: 'Confirmed SO did not receive its Xero Draft invoice ID.' }).not.toBeNull();

    const verification = await verifySalesOrderAwaitingOperator(config, soId);
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P2',
      salesOrderId: soId,
      salesOrderNumber: verification.soNumber,
      xeroInvoiceId: verification.xeroInvoiceId,
      stock: verification.stock,
      operatorChecks: [
        'IMS SO is Confirmed, unfulfilled, and commits exactly 1 unit at TEST location',
        'Xero invoice is Draft, No Tax, and totals AUD 1.00',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'p2_created', {
      scenario: 'P2', phase: 'confirm_attempt', salesOrderId: soId,
      confirmError: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

test('@p2-compensate cancels only the acknowledged unfulfilled SO and verifies baseline stock', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const soId = salesOrderId(events);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'P2', salesOrderId: soId });
  try {
    await openSalesOrders(page);
    page.once('dialog', dialog => dialog.accept());
    const cancelResponse = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${soId}`)
      && response.request().method() === 'PUT');
    await page.getByTestId(`so-cancel-${soId}`).click();
    const response = await cancelResponse;
    const cancelled = await response.json() as { success?: boolean; xeroWarning?: string; error?: string };
    expect(response.ok(), cancelled.error).toBe(true);
    expect(cancelled.success, cancelled.error).toBe(true);
    expect(cancelled.xeroWarning, 'Xero did not confirm automatic Draft deletion').toBeUndefined();

    const verification = await verifySalesOrderCompensation(config, soId);
    await appendManifestState(config.runId, 'clean', {
      scenario: 'P2',
      salesOrderId: soId,
      ...verification,
      permanentArtifacts: ['Cancelled IMS sales order and immutable activity history', 'Deleted Xero Draft invoice and Xero audit history'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P2', phase: 'compensation', salesOrderId: soId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});