import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { verifySalesOrderPartialFulfilment } from './support/database-preflight';

test.describe.configure({ timeout: 120_000 });

async function openSalesOrders(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('ims-nav-__orders').click();
  await page.getByTestId('ims-nav-sales-orders').click();
}

function p3SalesOrderId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.salesOrderId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P3 sales order ID.');
}

test('@p3-create creates the isolated two-unit Draft SO for partial fulfilment', async ({ page }) => {
  const config = loadLiveE2EConfig();
  let soId: number | null = null;
  const events = await readManifest(config.runId);
  expect(['preflight_passed', 'blocked']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);
  try {
    const listResponse = await page.request.get('/api/ims/sales-orders');
    const list = await listResponse.json() as { success?: boolean; data?: any[] };
    const existing = Array.isArray(list?.data)
      ? list.data.find(order => ['draft', 'confirmed'].includes(String(order.status))
        && Number(order.location_id) === config.fixtureLocationId
        && Number(order.customer_id) === config.fixtureCustomerId
        && Number(order.qty_ordered ?? 0) === 2)
      : null;
    if (existing) {
      soId = Number(existing.id);
      expect(soId).toBeGreaterThan(0);
      await appendManifestState(config.runId, 'p3_created', {
        scenario: 'P3',
        phase: 'draft_reused',
        salesOrderId: soId,
        salesOrderNumber: existing.so_number ?? null,
      });
      return;
    }

    await openSalesOrders(page);
    await page.getByTestId('so-new').click();
    await page.getByTestId('so-customer').selectOption(String(config.fixtureCustomerId));
    await page.getByTestId('so-location').selectOption(String(config.fixtureLocationId));
    await page.getByTestId('so-notes').fill(`LIVE E2E ${config.runId} P3 - partial fulfilment/backorder`);
    await page.getByTestId('so-tax-treatment').selectOption('no_tax');
    await page.getByTestId('so-line-0-variant').fill(config.fixtureSku);
    await page.getByTestId(`so-line-0-variant-option-${config.fixtureVariantId}`).click();
    await page.getByTestId('so-line-qty-0').fill('2');
    await page.getByTestId('so-line-price-0').fill('0.5');

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
    await appendManifestState(config.runId, 'p3_created', {
      scenario: 'P3',
      phase: 'draft_created',
      salesOrderId: soId,
      salesOrderNumber: detail?.data?.so_number ?? null,
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P3', phase: 'create_draft', salesOrderId: soId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

test('@p3-fulfil ships one unit and backorders the remainder', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const soId = p3SalesOrderId(events);
  expect(events.at(-1)?.state).toBe('p3_created');
  await loginToIms(page, config);
  try {
    const detailResponse = await page.request.get(`/api/ims/sales-orders/${soId}`);
    const detail = await detailResponse.json() as { success?: boolean; data?: any };
    expect(detailResponse.ok()).toBe(true);
    const itemId = Number(detail?.data?.items?.[0]?.id);
    expect(itemId).toBeGreaterThan(0);

    await openSalesOrders(page);

    const confirmButton = page.getByTestId(`so-confirm-${soId}`);
    await expect(confirmButton).toBeVisible();
    if (await confirmButton.isVisible()) {
      page.once('dialog', dialog => dialog.accept());
      const confirmResponse = page.waitForResponse(response => response.url().endsWith(`/api/ims/sales-orders/${soId}`)
        && response.request().method() === 'PUT');
      await confirmButton.click();
      const confirmResult = await confirmResponse;
      const confirmed = await confirmResult.json() as { success?: boolean; error?: string };
      expect(confirmResult.ok(), confirmed.error).toBe(true);
      expect(confirmed.success, confirmed.error).toBe(true);
      await expect(page.getByTestId(`so-fulfil-${soId}`)).toBeVisible();
    }

    const fulfilButton = page.getByTestId(`so-fulfil-${soId}`);
    await expect(fulfilButton).toBeVisible();
    await fulfilButton.click();

    await expect(page.getByTestId('so-fulfil-modal')).toBeVisible();
    await page.getByTestId('so-fulfil-mode-backorder').check();
    await page.getByTestId(`so-fulfil-qty-${itemId}`).fill('1');

    page.once('dialog', dialog => dialog.accept());
    const fulfilResponse = page.waitForResponse(response => response.url().includes('/api/ims/sales-orders/')
      && response.url().endsWith('/backorder')
      && response.request().method() === 'POST');
    await page.getByTestId('so-fulfil-confirm').click();
    const response = await fulfilResponse;
    const fulfilled = await response.json() as { success?: boolean; error?: string; data?: any };
    expect(response.ok(), fulfilled.error).toBe(true);
    expect(fulfilled.success, fulfilled.error).toBe(true);

    const verification = await verifySalesOrderPartialFulfilment(config, soId);
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P3',
      salesOrderId: soId,
      ...verification,
      operatorChecks: [
        'IMS source SO is fulfilled for the shipped unit and the remainder is parked on a backorder child',
        'Xero invoice is authorised for the shipped amount',
        'Stock is now negative by the shipped unit because the fixture started at zero',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'p3_created', {
      scenario: 'P3', phase: 'fulfil_attempt', salesOrderId: soId,
      fulfilError: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});