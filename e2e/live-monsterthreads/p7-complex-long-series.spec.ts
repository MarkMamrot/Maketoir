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
  await page.getByTestId('ims-nav-__orders').click();
  await page.getByTestId('ims-nav-sales-orders').click();
}

function p7SourceSoId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.sourceSoId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P7 source sales order ID.');
}

function p7ReplacementSoId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.replacementSoId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P7 replacement sales order ID.');
}

test('@p7-create runs a long chain: draft -> confirm -> partial fulfil/backorder -> replacement confirm -> checkpoint', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  expect(['preflight_passed', 'p7_created', 'blocked']).toContain(events.at(-1)?.state);
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
      && String(order.notes ?? '').includes(`LIVE E2E ${config.runId} P7 source complex-chain`),
    );

    if (existingSource) {
      sourceSoId = Number(existingSource.id);
      expect(sourceSoId).toBeGreaterThan(0);
    } else {
      await openSalesOrders(page);
      await page.getByTestId('so-new').click();
      await page.getByTestId('so-customer').selectOption(String(config.fixtureCustomerId));
      await page.getByTestId('so-location').selectOption(String(config.fixtureLocationId));
      await page.getByTestId('so-notes').fill(`LIVE E2E ${config.runId} P7 source complex-chain`);
      await page.getByTestId('so-tax-treatment').selectOption('no_tax');
      await page.getByTestId('so-line-0-variant').fill(config.fixtureSku);
      await page.getByTestId(`so-line-0-variant-option-${config.fixtureVariantId}`).click();
      await page.getByTestId('so-line-qty-0').fill('3');
      await page.getByTestId('so-line-price-0').fill('0.3');

      const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/sales-orders')
        && response.request().method() === 'POST');
      await page.getByTestId('so-create-draft').click();
      const response = await createdResponse;
      const created = await response.json() as { success?: boolean; id?: number; data?: { id?: number }; error?: string };
      expect(response.ok(), created.error).toBe(true);
      expect(created.success, created.error).toBe(true);
      sourceSoId = Number(created.id ?? created.data?.id);
      expect(sourceSoId).toBeGreaterThan(0);
    }

    const sourceDetailResponse = await page.request.get(`/api/ims/sales-orders/${sourceSoId}`);
    const sourceDetail = await sourceDetailResponse.json() as { success?: boolean; data?: any; error?: string };
    expect(sourceDetailResponse.ok(), sourceDetail.error).toBe(true);

    const sourceStatus = String(sourceDetail?.data?.status ?? '');
    if (sourceStatus === 'draft') {
      const confirmResponse = await page.request.put(`/api/ims/sales-orders/${sourceSoId}`, {
        data: {
          status: 'confirmed',
          operationKey: `live-e2e-${config.runId}-p7-confirm-source-${sourceSoId}-${Date.now()}`,
          expectedUpdatedAt: typeof sourceDetail?.data?.updated_at === 'string' ? sourceDetail.data.updated_at : null,
        },
      });
      const confirmed = await confirmResponse.json() as { success?: boolean; error?: string };
      expect(confirmResponse.ok(), confirmed.error).toBe(true);
      expect(confirmed.success, confirmed.error).toBe(true);
    }

    const sourceAfterConfirmResponse = await page.request.get(`/api/ims/sales-orders/${sourceSoId}`);
    const sourceAfterConfirm = await sourceAfterConfirmResponse.json() as { success?: boolean; data?: any; error?: string };
    expect(sourceAfterConfirmResponse.ok(), sourceAfterConfirm.error).toBe(true);

    if (String(sourceAfterConfirm?.data?.status ?? '') !== 'fulfilled') {
      const itemId = Number(sourceAfterConfirm?.data?.items?.[0]?.id);
      expect(itemId).toBeGreaterThan(0);

      await openSalesOrders(page);
      await expect(page.getByTestId(`so-open-${sourceSoId}`)).toBeVisible();
      await page.getByTestId(`so-fulfil-${sourceSoId}`).click();
      await expect(page.getByTestId('so-fulfil-modal')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('so-fulfil-mode-backorder').check();
      await page.getByTestId(`so-fulfil-qty-${itemId}`).fill('1');

      page.once('dialog', dialog => dialog.accept());
      const fulfilResponse = page.waitForResponse(response => response.url().includes('/api/ims/sales-orders/')
        && response.url().endsWith('/backorder')
        && response.request().method() === 'POST'
        && response.status() === 200);
      await page.getByTestId('so-fulfil-confirm').click();
      const fulfilledResponse = await fulfilResponse;
      const fulfilled = await fulfilledResponse.json() as { success?: boolean; error?: string };
      expect(fulfilledResponse.ok(), fulfilled.error).toBe(true);
      expect(fulfilled.success, fulfilled.error).toBe(true);
    }

    const refreshedListResponse = await page.request.get('/api/ims/sales-orders');
    const refreshedList = await refreshedListResponse.json() as { success?: boolean; data?: any[]; error?: string };
    expect(refreshedListResponse.ok(), refreshedList.error).toBe(true);

    const existingReplacement = (Array.isArray(refreshedList.data) ? refreshedList.data : []).find(order =>
      Number(order.location_id) === config.fixtureLocationId
      && Number(order.customer_id) === config.fixtureCustomerId
      && String(order.notes ?? '').includes(`LIVE E2E ${config.runId} P7 replacement complex-chain`),
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
          notes: `LIVE E2E ${config.runId} P7 replacement complex-chain`,
          operationKey: `live-e2e-${config.runId}-p7-tag-replacement-${replacementSoId}-${Date.now()}`,
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
    const replacementStatus = String(replacementDetail?.data?.status ?? '');
    if (replacementStatus === 'draft') {
      const confirmReplacementResponse = await page.request.put(`/api/ims/sales-orders/${replacementSoId}`, {
        data: {
          status: 'confirmed',
          operationKey: `live-e2e-${config.runId}-p7-confirm-replacement-${replacementSoId}-${Date.now()}`,
          expectedUpdatedAt: typeof replacementDetail?.data?.updated_at === 'string' ? replacementDetail.data.updated_at : null,
        },
      });
      const confirmedReplacement = await confirmReplacementResponse.json() as { success?: boolean; error?: string };
      expect(confirmReplacementResponse.ok(), confirmedReplacement.error).toBe(true);
      expect(confirmedReplacement.success, confirmedReplacement.error).toBe(true);
    }

    const verification = await verifySalesOrderComplexSeriesCheckpoint(config, Number(sourceSoId), Number(replacementSoId));
    await appendManifestState(config.runId, 'p7_created', {
      scenario: 'P7',
      sourceSoId,
      replacementSoId,
      ...verification,
      chain: ['draft', 'confirmed', 'partial_fulfilment_backorder', 'replacement_confirmed'],
    });
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P7',
      sourceSoId,
      replacementSoId,
      ...verification,
      chain: ['draft', 'confirmed', 'partial_fulfilment_backorder', 'replacement_confirmed'],
      operatorChecks: [
        'Source SO is fulfilled for 1/3 units with an open backorder child for 2 units',
        'Replacement SO exists and is confirmed/backordered with no fulfilled quantity',
        'Fixture stock signature is stressed: on hand -1 and committed +3',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P7',
      phase: 'complex_chain_create',
      sourceSoId,
      replacementSoId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

test('@p7-compensate unwinds all open fixture sales orders and restocks shipped quantity to baseline', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const sourceSoId = p7SourceSoId(events);
  const replacementSoId = p7ReplacementSoId(events);
  expect(['acknowledged', 'compensation_retry_authorized']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'P7', sourceSoId, replacementSoId });

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
            operationKey: `live-e2e-${config.runId}-p7-cancel-${targetId}-${Date.now()}`,
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
          reference: `LIVE E2E ${config.runId} P7 compensation`,
          tax_treatment: 'ex_tax',
          notes: `P7 compensation for ${sourceDetail?.data?.so_number ?? sourceSoId}`,
          items: [
            {
              variant_id: String(sourceItem?.variant_id ?? ''),
              code: String(sourceItem?.sku ?? ''),
              name: String(sourceItem?.product_name ?? sourceItem?.name ?? 'P7 shipped line'),
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
      scenario: 'P7',
      sourceSoId,
      replacementSoId,
      ...partialComp,
      ...replacementComp,
      permanentArtifacts: [
        'Source SO remains immutable with shipped history and matching completed return credit note',
        'Backorder and replacement chains are cancelled/deleted with no fixture open SO work remaining',
        'Fixture stock fully restored to preflight baseline after multi-step unwind',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P7',
      phase: 'compensation',
      sourceSoId,
      replacementSoId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});
