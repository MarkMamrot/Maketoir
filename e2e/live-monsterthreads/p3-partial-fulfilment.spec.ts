import { expect, test, type Dialog } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { loadCampaignInventoryBaseline, verifySalesOrderCompensation, verifySalesOrderPartialCompensation, verifySalesOrderPartialFulfilment } from './support/database-preflight';
import { verifyLiveFifoIntegrity } from './support/fifo-database';

test.describe.configure({ timeout: 120_000 });

async function openSalesOrders(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('ims-nav-__sales').click();
  await page.getByTestId('ims-nav-sales-orders').click();
}

function p3SalesOrderId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.salesOrderId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P3 sales order ID.');
}

function p3BackorderId(events: Awaited<ReturnType<typeof readManifest>>): number | null {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.backorderSoId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
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
        && String(order.notes ?? '').includes(`LIVE E2E ${config.runId} P3`)
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
    await page.getByTestId(`so-line-0-variant-option-${config.fixtureVariantId}`).dispatchEvent('mousedown');
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

test('@p3-fulfil verifies a partial shipment or atomic no-stock rejection', async ({ page }) => {
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
    const soNumber = String(detail?.data?.so_number ?? '');
    const soStatus = String(detail?.data?.status ?? '');
    expect(soNumber).toContain('SO-');

    if (soStatus === 'fulfilled') {
      const verification = await verifySalesOrderPartialFulfilment(config, soId);
      const fifo = config.expectedCostingMethod === 'fifo' ? await verifyLiveFifoIntegrity(config) : null;
      await appendManifestState(config.runId, 'awaiting_operator', {
        scenario: 'P3',
        salesOrderId: soId,
        ...verification,
        fifo,
        operatorChecks: [
          'IMS source SO is fulfilled for the shipped unit and the remainder is parked on a backorder child',
          'Xero invoice is authorised for the shipped amount',
          config.expectedCostingMethod === 'fifo'
            ? 'FIFO stock and active layers both decreased by the shipped unit'
            : 'Stock decreased by the shipped unit under Average Cost',
        ],
      });
      return;
    }

    await openSalesOrders(page);
    await expect(page.getByTestId(`so-open-${soId}`)).toBeVisible();
    const soRow = page.getByTestId(`so-open-${soId}`).locator('xpath=ancestor::tr');

    if (soStatus === 'draft') {
      const handleConfirmationDialog = (dialog: Dialog) => dialog.accept();
      page.once('dialog', handleConfirmationDialog);
      const confirmResponse = page.waitForResponse(response =>
        (response.url().endsWith(`/api/ims/sales-orders/${soId}`) && response.request().method() === 'PUT')
        || (response.url().endsWith(`/api/ims/sales-orders/${soId}/sourcing`) && response.request().method() === 'POST'),
      { timeout: 90_000 });
      await soRow.getByRole('combobox').selectOption('confirm');
      await soRow.getByRole('button', { name: 'Go' }).click();
      const baseline = (events[0]?.details as { baseline?: { qtyOnHand: number; qtyCommitted: number } })?.baseline;
      expect(baseline).toBeDefined();
      const unsourcedQuantity = Math.max(0, 2 - (Number(baseline?.qtyOnHand) - Number(baseline?.qtyCommitted)));
      if (unsourcedQuantity > 0) {
        await expect(page.getByRole('heading', { name: /^Stock sourcing/ })).toBeVisible({ timeout: 45_000 });
        await expect(page.getByText('No eligible confirmed incoming purchase order.', { exact: true })).toBeVisible();
        const confirmUnsourced = page.getByRole('button', { name: 'Confirm with Unsourced Quantity', exact: true });
        await expect(confirmUnsourced).toBeDisabled();
        await page.getByRole('checkbox', { name: new RegExp(`^Leave ${unsourcedQuantity} unsourced\\.`) }).check();
        await expect(confirmUnsourced).toBeEnabled();
        await confirmUnsourced.click();
      }
      const confirmResult = await confirmResponse;
      const confirmed = await confirmResult.json() as { success?: boolean; error?: string };
      expect(confirmResult.ok(), confirmed.error).toBe(true);
      expect(confirmed.success, confirmed.error).toBe(true);
      page.off('dialog', handleConfirmationDialog);
      await expect(soRow.getByRole('combobox')).toHaveValue('fulfill');
    }

    await soRow.getByRole('combobox').selectOption('fulfill');
    await soRow.getByRole('button', { name: 'Go' }).click();

    await expect(page.getByTestId('so-fulfil-modal')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('so-fulfil-mode-backorder').check();
    await page.getByTestId(`so-fulfil-qty-${itemId}`).fill('1');

    const beforeAttempt = await loadCampaignInventoryBaseline(config);
    const baseline = (events[0]?.details as { baseline?: { qtyOnHand: number } })?.baseline;
    const expectsNoStockRejection = config.expectedCostingMethod === 'average_cost' && Number(baseline?.qtyOnHand) < 1;
    const declinedNegativeStock = expectsNoStockRejection
      ? page.waitForEvent('dialog').then(async dialog => {
        const message = dialog.message();
        await dialog.dismiss();
        expect(message).toContain('Continue and allow negative stock?');
      })
      : null;
    const fulfilResponse = page.waitForResponse(response => response.url().includes('/api/ims/sales-orders/')
      && response.url().endsWith('/backorder')
      && response.request().method() === 'POST');
    await page.getByTestId('so-fulfil-confirm').click();
    const response = await fulfilResponse;
    const fulfilled = await response.json() as { success?: boolean; error?: string; data?: any };
    if (expectsNoStockRejection) {
      await declinedNegativeStock;
      await expect(page.getByTestId('so-fulfil-confirm')).toBeEnabled();
      expect(response.status()).toBe(409);
      expect(fulfilled.success).toBe(false);
      expect(fulfilled.error).toMatch(/enough stock on hand/i);
      const unchanged = await (await page.request.get(`/api/ims/sales-orders/${soId}`)).json();
      expect(unchanged.data.status).toBe('confirmed');
      expect(unchanged.data.items).toHaveLength(1);
      expect(Number(unchanged.data.items[0].qty_ordered)).toBe(2);
      expect(Number(unchanged.data.items[0].qty_fulfilled)).toBe(0);
      const afterAttempt = await loadCampaignInventoryBaseline(config);
      expect(afterAttempt).toEqual(beforeAttempt);
      const invoiceResponse = await page.request.get(`/api/ims/xero/invoice-details?soId=${soId}`);
      expect(invoiceResponse.ok()).toBe(true);
      const invoice = await invoiceResponse.json();
      expect(invoice.status).toBe('DRAFT');
      expect(Number(invoice.total)).toBe(1);
      await appendManifestState(config.runId, 'awaiting_operator', {
        scenario: 'P3 no-stock rejection',
        phase: 'no_stock_rejection_verified',
        salesOrderId: soId,
        salesOrderNumber: soNumber,
        beforeAttempt,
        afterAttempt,
        backorderSoId: null,
        operatorChecks: ['SO remains Confirmed with 2 committed and 0 fulfilled', 'Xero invoice remains Draft for AUD 1.00', 'Stock and costing history were unchanged by rejected shipment'],
      });
      return;
    }
    expect(response.ok(), fulfilled.error).toBe(true);
    expect(fulfilled.success, fulfilled.error).toBe(true);

    const verification = await verifySalesOrderPartialFulfilment(config, soId);
    const fifo = config.expectedCostingMethod === 'fifo' ? await verifyLiveFifoIntegrity(config) : null;
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P3',
      salesOrderId: soId,
      ...verification,
      fifo,
      operatorChecks: [
        'IMS source SO is fulfilled for the shipped unit and the remainder is parked on a backorder child',
        'Xero invoice is authorised for the shipped amount',
        config.expectedCostingMethod === 'fifo'
          ? 'FIFO stock and active layers both decreased by the shipped unit'
          : 'Stock decreased by the shipped unit under Average Cost',
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

test('@p3-inspect reads back the authorised shipped amount from Xero', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const soId = p3SalesOrderId(events);
  expect(events.at(-1)?.state).toBe('awaiting_operator');
  await loginToIms(page, config);

  const response = await page.request.get(`/api/ims/xero/invoice-details?soId=${soId}`);
  const invoice = await response.json() as {
    success?: boolean;
    invoiceNumber?: string;
    total?: number;
    taxTotal?: number;
    status?: string;
    error?: string;
  };
  expect(response.ok(), invoice.error).toBe(true);
  expect(invoice.success, invoice.error).toBe(true);
  expect(invoice.status).toBe('AUTHORISED');
  expect(Number(invoice.total)).toBe(0.5);
  expect(Number(invoice.taxTotal)).toBe(0);

  await appendManifestState(config.runId, 'awaiting_operator', {
    scenario: 'P3',
    phase: 'xero_authorised_verified',
    salesOrderId: soId,
    invoiceNumber: invoice.invoiceNumber ?? null,
    xeroStatus: invoice.status,
    xeroTotal: Number(invoice.total),
    xeroTaxTotal: Number(invoice.taxTotal),
  });
});

test('@p3-compensate resolves the partial fulfilment with return credit and closes fixture open work', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const soId = p3SalesOrderId(events);
  const expectedBackorderId = p3BackorderId(events);
  expect(['acknowledged', 'compensation_retry_authorized']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'P3', salesOrderId: soId });
  try {
    const sourceDetailResponse = await page.request.get(`/api/ims/sales-orders/${soId}`);
    const sourceDetail = await sourceDetailResponse.json() as { success?: boolean; data?: any; error?: string };
    expect(sourceDetailResponse.ok(), sourceDetail.error).toBe(true);
    const sourceItem = sourceDetail?.data?.items?.[0];
    expect(Number(sourceItem?.id)).toBeGreaterThan(0);

    const latestCheckpoint = events.findLast(event => event.state === 'awaiting_operator');
    if ((latestCheckpoint?.details as { phase?: string })?.phase === 'no_stock_rejection_verified') {
      expect(sourceDetail.data.status).toBe('confirmed');
      expect(Number(sourceItem.qty_fulfilled)).toBe(0);
      const cancelResponse = await page.request.put(`/api/ims/sales-orders/${soId}`, {
        data: {
          status: 'cancelled',
          operationKey: `live-e2e-${config.runId}-no-stock-cancel`,
          expectedUpdatedAt: sourceDetail.data.updated_at ?? null,
        },
      });
      const cancelled = await cancelResponse.json();
      expect(cancelResponse.ok(), cancelled.error).toBe(true);
      expect(cancelled.success).toBe(true);
      expect(cancelled.xeroWarning).toBeUndefined();
      const verification = await verifySalesOrderCompensation(config, soId);
      await appendManifestState(config.runId, 'clean', {
        scenario: 'P3 no-stock rejection', salesOrderId: soId, ...verification,
        successfulPartialShipmentTested: false,
        permanentArtifacts: ['Cancelled unfulfilled SO and deleted Xero Draft audit history'],
      });
      return;
    }

    expect(expectedBackorderId).not.toBeNull();
    expect(expectedBackorderId).not.toBe(soId);
    const cancellableIds = [Number(expectedBackorderId)];
    for (const targetId of cancellableIds) {
      const detailResponse = await page.request.get(`/api/ims/sales-orders/${targetId}`);
      const detail = await detailResponse.json() as { success?: boolean; data?: any; error?: string };
      expect(detailResponse.ok()).toBe(true);
      expect(Number(detail.data?.customer_id)).toBe(config.fixtureCustomerId);
      expect(Number(detail.data?.location_id)).toBe(config.fixtureLocationId);
      const status = String(detail?.data?.status ?? '');
      if (!['draft', 'confirmed', 'backordered', 'partially_fulfilled'].includes(status)) continue;
      if (status === 'draft') {
        const deleteResponse = await page.request.delete(`/api/ims/sales-orders/${targetId}`);
        const deleted = await deleteResponse.json() as { success?: boolean; error?: string };
        expect(deleteResponse.ok(), deleted.error).toBe(true);
        expect(deleted.success, deleted.error).toBe(true);
        continue;
      }
      const cancelResponse = await page.request.put(`/api/ims/sales-orders/${targetId}`, {
        data: {
          status: 'cancelled',
          operationKey: `live-e2e-${config.runId}-p3-compensate-cancel-${targetId}-${Date.now()}`,
          expectedUpdatedAt: typeof detail?.data?.updated_at === 'string' ? detail.data.updated_at : null,
        },
      });
      const cancelled = await cancelResponse.json() as { success?: boolean; error?: string };
      expect(cancelResponse.ok(), cancelled.error).toBe(true);
      expect(cancelled.success, cancelled.error).toBe(true);
    }

    const cnListResponse = await page.request.get('/api/ims/credit-notes');
    const cnList = await cnListResponse.json() as { success?: boolean; data?: any[]; error?: string };
    expect(cnListResponse.ok(), cnList.error).toBe(true);
    const existingComplete = (Array.isArray(cnList.data) ? cnList.data : []).find(cn =>
      Number(cn.so_id) === soId && String(cn.status) === 'complete',
    );

    if (!existingComplete) {
      const existingDraft = (Array.isArray(cnList.data) ? cnList.data : []).find(cn =>
        Number(cn.so_id) === soId && String(cn.status) === 'draft',
      );
      let cnId = Number(existingDraft?.id);
      if (!Number.isInteger(cnId) || cnId <= 0) {
        const createCnResponse = await page.request.post('/api/ims/credit-notes', {
          data: {
            customer_id: Number(sourceDetail?.data?.customer_id),
            so_id: soId,
            original_so_number: String(sourceDetail?.data?.so_number ?? ''),
            location_id: Number(sourceDetail?.data?.location_id),
            cn_date: new Date().toISOString().slice(0, 10),
            reference: `LIVE E2E ${config.runId} P3 compensation`,
            tax_treatment: 'ex_tax',
            notes: `P3 compensation for ${sourceDetail?.data?.so_number ?? soId}`,
            items: [
              {
                variant_id: String(sourceItem?.variant_id ?? ''),
                code: String(sourceItem?.sku ?? ''),
                name: String(sourceItem?.product_name ?? sourceItem?.name ?? 'P3 shipped line'),
                qty: 1,
                unit_price: Number(sourceItem?.unit_price ?? 0.5),
                price_basis: 'custom',
                restock: true,
                source_so_item_id: Number(sourceItem?.id),
                tax_rate: 0,
              },
            ],
          },
        });
        const createdCn = await createCnResponse.json() as { success?: boolean; data?: any; error?: string };
        expect(createCnResponse.ok(), createdCn.error).toBe(true);
        expect(createdCn.success, createdCn.error).toBe(true);
        cnId = Number(createdCn?.data?.id);
      }
      expect(cnId).toBeGreaterThan(0);
      const completeCnResponse = await page.request.post(`/api/ims/credit-notes/${cnId}/complete`, {
        data: { operationKey: `live-e2e-${config.runId}-p3-complete-cn-${cnId}` },
      });
      const completedCn = await completeCnResponse.json() as { success?: boolean; error?: string };
      expect(completeCnResponse.ok(), completedCn.error).toBe(true);
      expect(completedCn.success, completedCn.error).toBe(true);
    }

    const verification = await verifySalesOrderPartialCompensation(config, soId);
    const fifo = config.expectedCostingMethod === 'fifo' ? await verifyLiveFifoIntegrity(config) : null;
    await appendManifestState(config.runId, 'clean', {
      scenario: 'P3',
      salesOrderId: soId,
      expectedBackorderId,
      ...verification,
      fifo,
      permanentArtifacts: [
        'Fulfilled source SO remains immutable for shipped quantity history',
        'Backorder child is cancelled and open fixture sales-order work is closed',
        'Manual customer return credit note is completed and restocks shipped quantity',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P3', phase: 'compensation', salesOrderId: soId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});