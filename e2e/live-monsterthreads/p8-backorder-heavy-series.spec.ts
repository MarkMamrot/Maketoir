import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import {
  verifySalesOrderComplexSeriesCheckpoint,
  verifySalesOrderPartialCompensation,
  verifySalesOrderReplacementCompensation,
} from './support/database-preflight';

test.describe.configure({ timeout: 180_000 });

async function openSalesOrders(page: import('@playwright/test').Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Sales Orders' });
  if (await heading.isVisible().catch(() => false)) return;

  const ordersNav = page.getByTestId('ims-nav-__orders');
  if (await ordersNav.isVisible().catch(() => false)) {
    await ordersNav.click();
  }

  const salesOrdersNav = page.getByTestId('ims-nav-sales-orders');
  if (await salesOrdersNav.isVisible().catch(() => false)) {
    await salesOrdersNav.click();
  }

  await expect(heading).toBeVisible({ timeout: 30_000 });
}

function p8SourceSoId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.sourceSoId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P8 source sales order ID.');
}

function p8ReplacementSoId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.replacementSoId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P8 replacement sales order ID.');
}

test('@p8-create runs a backorder-heavy chain and checkpoints stressed stock invariants', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  expect(['preflight_passed', 'p8_created', 'blocked']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);

  let sourceSoId: number | null = null;
  let replacementSoId: number | null = null;

  try {
    const listResponse = await page.request.get('/api/ims/sales-orders');
    const list = await listResponse.json() as { success?: boolean; data?: any[]; error?: string };
    expect(listResponse.ok(), list.error).toBe(true);

    const existingSource = (Array.isArray(list.data) ? list.data : []).find(order =>
      Number(order.location_id) === config.fixtureLocationId
      && Number(order.customer_id) === config.fixtureCustomerId
      && String(order.notes ?? '').includes(`LIVE E2E ${config.runId} P8 source backorder-heavy`),
    );

    if (existingSource) {
      sourceSoId = Number(existingSource.id);
      expect(sourceSoId).toBeGreaterThan(0);
    } else {
      await openSalesOrders(page);
      await page.getByTestId('so-new').click();
      await page.getByTestId('so-customer').selectOption(String(config.fixtureCustomerId));
      await page.getByTestId('so-location').selectOption(String(config.fixtureLocationId));
      await page.getByTestId('so-notes').fill(`LIVE E2E ${config.runId} P8 source backorder-heavy`);
      await page.getByTestId('so-tax-treatment').selectOption('no_tax');
      await page.getByTestId('so-line-0-variant').fill(config.fixtureSku);
      await page.getByTestId(`so-line-0-variant-option-${config.fixtureVariantId}`).click();
      await page.getByTestId('so-line-qty-0').fill('3');
      await page.getByTestId('so-line-price-0').fill('0.3');

      const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/sales-orders')
        && response.request().method() === 'POST');
      await page.getByTestId('so-create-draft').click();
      const response = await createdResponse;
      const createdSource = await response.json() as { success?: boolean; id?: number; data?: { id?: number }; error?: string };
      expect(response.ok(), createdSource.error).toBe(true);
      expect(createdSource.success, createdSource.error).toBe(true);
      sourceSoId = Number(createdSource.id ?? createdSource.data?.id);
      expect(sourceSoId).toBeGreaterThan(0);
    }

    const sourceDetailResponse = await page.request.get(`/api/ims/sales-orders/${sourceSoId}`);
    const sourceDetail = await sourceDetailResponse.json() as { success?: boolean; data?: any; error?: string };
    expect(sourceDetailResponse.ok(), sourceDetail.error).toBe(true);

    if (String(sourceDetail?.data?.status ?? '') === 'draft') {
      const confirmSourceResponse = await page.request.put(`/api/ims/sales-orders/${sourceSoId}`, {
        data: {
          status: 'confirmed',
          operationKey: `live-e2e-${config.runId}-p8-confirm-source-${sourceSoId}-${Date.now()}`,
          expectedUpdatedAt: typeof sourceDetail?.data?.updated_at === 'string' ? sourceDetail.data.updated_at : null,
        },
      });
      const confirmedSource = await confirmSourceResponse.json() as { success?: boolean; error?: string };
      expect(confirmSourceResponse.ok(), confirmedSource.error).toBe(true);
      expect(confirmedSource.success, confirmedSource.error).toBe(true);
    }

    const sourceAfterConfirmResponse = await page.request.get(`/api/ims/sales-orders/${sourceSoId}`);
    const sourceAfterConfirm = await sourceAfterConfirmResponse.json() as { success?: boolean; data?: any; error?: string };
    expect(sourceAfterConfirmResponse.ok(), sourceAfterConfirm.error).toBe(true);

    if (String(sourceAfterConfirm?.data?.status ?? '') !== 'fulfilled') {
      const itemId = Number(sourceAfterConfirm?.data?.items?.[0]?.id);
      expect(itemId).toBeGreaterThan(0);
      const requestBody = {
        operationKey: `live-e2e-${config.runId}-p8-backorder-${sourceSoId}-${Date.now()}`,
        fulfilQuantities: [{ itemId, quantity: 1 }],
      };
      const fulfilAttempt = await page.request.post(`/api/ims/sales-orders/${sourceSoId}/backorder`, { data: requestBody });
      if (fulfilAttempt.status() === 409) {
        const retry = await page.request.post(`/api/ims/sales-orders/${sourceSoId}/backorder`, {
          data: {
            ...requestBody,
            operationKey: `live-e2e-${config.runId}-p8-backorder-retry-${sourceSoId}-${Date.now()}`,
            allowNegativeStock: true,
          },
        });
        const retryResult = await retry.json() as { success?: boolean; error?: string };
        expect(retry.ok(), retryResult.error).toBe(true);
        expect(retryResult.success, retryResult.error).toBe(true);
      } else {
        const fulfilled = await fulfilAttempt.json() as { success?: boolean; error?: string };
        expect(fulfilAttempt.ok(), fulfilled.error).toBe(true);
        expect(fulfilled.success, fulfilled.error).toBe(true);
      }
    }

    const refreshedListResponse = await page.request.get('/api/ims/sales-orders');
    const refreshedList = await refreshedListResponse.json() as { success?: boolean; data?: any[]; error?: string };
    expect(refreshedListResponse.ok(), refreshedList.error).toBe(true);

    const existingReplacement = (Array.isArray(refreshedList.data) ? refreshedList.data : []).find(order =>
      Number(order.location_id) === config.fixtureLocationId
      && Number(order.customer_id) === config.fixtureCustomerId
      && String(order.notes ?? '').includes(`LIVE E2E ${config.runId} P8 replacement backorder-heavy`),
    );

    if (existingReplacement) {
      replacementSoId = Number(existingReplacement.id);
      expect(replacementSoId).toBeGreaterThan(0);
    } else {
      const createReplacementResponse = await page.request.post(`/api/ims/sales-orders/${sourceSoId}/replacement`, { data: {} });
      const createdReplacement = await createReplacementResponse.json() as { success?: boolean; id?: number; error?: string };
      expect(createReplacementResponse.ok(), createdReplacement.error).toBe(true);
      expect(createdReplacement.success, createdReplacement.error).toBe(true);
      replacementSoId = Number(createdReplacement.id);
      expect(replacementSoId).toBeGreaterThan(0);

      const replacementDetailResponse = await page.request.get(`/api/ims/sales-orders/${replacementSoId}`);
      const replacementDetail = await replacementDetailResponse.json() as { success?: boolean; data?: any; error?: string };
      expect(replacementDetailResponse.ok(), replacementDetail.error).toBe(true);
      const tagResponse = await page.request.put(`/api/ims/sales-orders/${replacementSoId}`, {
        data: {
          notes: `LIVE E2E ${config.runId} P8 replacement backorder-heavy`,
          operationKey: `live-e2e-${config.runId}-p8-tag-replacement-${replacementSoId}-${Date.now()}`,
          expectedUpdatedAt: typeof replacementDetail?.data?.updated_at === 'string' ? replacementDetail.data.updated_at : null,
        },
      });
      const tagged = await tagResponse.json() as { success?: boolean; error?: string };
      expect(tagResponse.ok(), tagged.error).toBe(true);
      expect(tagged.success, tagged.error).toBe(true);
    }

    const replacementResponse = await page.request.get(`/api/ims/sales-orders/${replacementSoId}`);
    const replacementDetail = await replacementResponse.json() as { success?: boolean; data?: any; error?: string };
    expect(replacementResponse.ok(), replacementDetail.error).toBe(true);
    if (String(replacementDetail?.data?.status ?? '') === 'draft') {
      const confirmReplacementResponse = await page.request.put(`/api/ims/sales-orders/${replacementSoId}`, {
        data: {
          status: 'confirmed',
          operationKey: `live-e2e-${config.runId}-p8-confirm-replacement-${replacementSoId}-${Date.now()}`,
          expectedUpdatedAt: typeof replacementDetail?.data?.updated_at === 'string' ? replacementDetail.data.updated_at : null,
        },
      });
      const confirmedReplacement = await confirmReplacementResponse.json() as { success?: boolean; error?: string };
      expect(confirmReplacementResponse.ok(), confirmedReplacement.error).toBe(true);
      expect(confirmedReplacement.success, confirmedReplacement.error).toBe(true);
    }

    const verification = await verifySalesOrderComplexSeriesCheckpoint(config, Number(sourceSoId), Number(replacementSoId));
    await appendManifestState(config.runId, 'p8_created', {
      scenario: 'P8',
      sourceSoId,
      replacementSoId,
      ...verification,
      chain: ['draft', 'confirmed', 'partial_fulfilment_backorder', 'replacement_confirmed', 'backorder_stress_signature'],
    });
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P8',
      sourceSoId,
      replacementSoId,
      ...verification,
      chain: ['draft', 'confirmed', 'partial_fulfilment_backorder', 'replacement_confirmed', 'backorder_stress_signature'],
      operatorChecks: [
        'Source SO fulfilled 1 unit and backordered remainder is open',
        'Replacement SO is confirmed/backordered with no fulfilled quantity',
        'Fixture stock reflects backorder stress signature: on hand -1 and committed +3',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P8',
      phase: 'backorder_heavy_create',
      sourceSoId,
      replacementSoId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

test('@p8-compensate unwinds source/replacement/backorder chain and restores baseline', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const sourceSoId = p8SourceSoId(events);
  const replacementSoId = p8ReplacementSoId(events);
  expect(['acknowledged', 'compensation_retry_authorized']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'P8', sourceSoId, replacementSoId });

  try {
    const sourceDetailResponse = await page.request.get(`/api/ims/sales-orders/${sourceSoId}`);
    const sourceDetail = await sourceDetailResponse.json() as { success?: boolean; data?: any; error?: string };
    expect(sourceDetailResponse.ok(), sourceDetail.error).toBe(true);
    const sourceItem = sourceDetail?.data?.items?.[0];
    expect(Number(sourceItem?.id)).toBeGreaterThan(0);

    const listResponse = await page.request.get('/api/ims/sales-orders');
    const list = await listResponse.json() as { success?: boolean; data?: any[]; error?: string };
    expect(listResponse.ok(), list.error).toBe(true);
    const fixtureOpenOrders = (Array.isArray(list.data) ? list.data : []).filter(order =>
      ['draft', 'confirmed', 'backordered', 'partially_fulfilled'].includes(String(order.status))
      && Number(order.location_id) === config.fixtureLocationId
      && Number(order.customer_id) === config.fixtureCustomerId,
    );

    for (const order of fixtureOpenOrders) {
      const targetId = Number(order.id);
      if (!Number.isInteger(targetId) || targetId <= 0) continue;
      const detailResponse = await page.request.get(`/api/ims/sales-orders/${targetId}`);
      const detail = await detailResponse.json() as { success?: boolean; data?: any; error?: string };
      if (!detailResponse.ok()) continue;
      const status = String(detail?.data?.status ?? '');
      if (!['draft', 'confirmed', 'backordered', 'partially_fulfilled'].includes(status)) continue;
      if (status === 'draft') {
        const deleteResponse = await page.request.delete(`/api/ims/sales-orders/${targetId}`);
        const deleted = await deleteResponse.json() as { success?: boolean; error?: string };
        expect(deleteResponse.ok(), deleted.error).toBe(true);
        expect(deleted.success, deleted.error).toBe(true);
      } else {
        const cancelResponse = await page.request.put(`/api/ims/sales-orders/${targetId}`, {
          data: {
            status: 'cancelled',
            operationKey: `live-e2e-${config.runId}-p8-cancel-${targetId}-${Date.now()}`,
            expectedUpdatedAt: typeof detail?.data?.updated_at === 'string' ? detail.data.updated_at : null,
          },
        });
        const cancelled = await cancelResponse.json() as { success?: boolean; error?: string };
        expect(cancelResponse.ok(), cancelled.error).toBe(true);
        expect(cancelled.success, cancelled.error).toBe(true);
      }
    }

    const cnListResponse = await page.request.get('/api/ims/credit-notes');
    const cnList = await cnListResponse.json() as { success?: boolean; data?: any[]; error?: string };
    expect(cnListResponse.ok(), cnList.error).toBe(true);
    const existingComplete = (Array.isArray(cnList.data) ? cnList.data : []).find(cn =>
      Number(cn.so_id) === sourceSoId && String(cn.status) === 'complete',
    );

    if (!existingComplete) {
      const createCnResponse = await page.request.post('/api/ims/credit-notes', {
        data: {
          customer_id: Number(sourceDetail?.data?.customer_id),
          so_id: sourceSoId,
          original_so_number: String(sourceDetail?.data?.so_number ?? ''),
          location_id: Number(sourceDetail?.data?.location_id),
          cn_date: new Date().toISOString().slice(0, 10),
          reference: `LIVE E2E ${config.runId} P8 compensation`,
          tax_treatment: 'ex_tax',
          notes: `P8 compensation for ${sourceDetail?.data?.so_number ?? sourceSoId}`,
          items: [
            {
              variant_id: String(sourceItem?.variant_id ?? ''),
              code: String(sourceItem?.sku ?? ''),
              name: String(sourceItem?.product_name ?? sourceItem?.name ?? 'P8 shipped line'),
              qty: 1,
              unit_price: Number(sourceItem?.unit_price ?? 0.3),
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
      const cnId = Number(createdCn?.data?.id);
      expect(cnId).toBeGreaterThan(0);
      const completeCnResponse = await page.request.post(`/api/ims/credit-notes/${cnId}/complete`, { data: {} });
      const completedCn = await completeCnResponse.json() as { success?: boolean; error?: string };
      expect(completeCnResponse.ok(), completedCn.error).toBe(true);
      expect(completedCn.success, completedCn.error).toBe(true);
    }

    const partialComp = await verifySalesOrderPartialCompensation(config, sourceSoId);
    const replacementComp = await verifySalesOrderReplacementCompensation(config, replacementSoId);

    await appendManifestState(config.runId, 'clean', {
      scenario: 'P8',
      sourceSoId,
      replacementSoId,
      ...partialComp,
      ...replacementComp,
      permanentArtifacts: [
        'Source SO immutable history retained with completed return credit note',
        'Backorder and replacement chains cancelled/deleted with no fixture open SO work',
        'Fixture stock restored to baseline after backorder-heavy scenario unwind',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P8',
      phase: 'compensation',
      sourceSoId,
      replacementSoId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});
