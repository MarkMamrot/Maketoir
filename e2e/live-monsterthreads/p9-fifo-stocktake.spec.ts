import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { verifyLiveFifoIntegrity } from './support/fifo-database';
import { appendManifestState, readManifest } from './support/manifest-store';

test.describe.configure({ timeout: 120_000 });

function stocktakeIdFrom(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as { stocktakeId?: unknown } | null)?.stocktakeId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P9 stocktake ID.');
}

test('@p9-create applies an isolated two-unit FIFO stocktake gain', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  expect(config.expectedCostingMethod).toBe('fifo');
  expect(events.at(-1)?.state).toBe('preflight_passed');
  await loginToIms(page, config);

  let stocktakeId: number | null = null;
  try {
    const baseline = await verifyLiveFifoIntegrity(config);
    expect(baseline.stockQuantity).toBe(0);
    expect(baseline.layerQuantity).toBe(0);

    const createResponse = await page.request.post('/api/ims/stocktakes', {
      data: {
        reference: `FIFO-STOCKTAKE-${config.runId}`,
        location_id: config.fixtureLocationId,
        blank: true,
        notes: 'Live FIFO verification: apply and reverse an isolated stocktake gain.',
      },
    });
    const created = await createResponse.json() as { id?: number; error?: string };
    expect(createResponse.ok(), created.error).toBe(true);
    stocktakeId = Number(created.id);
    expect(stocktakeId).toBeGreaterThan(0);

    const addResponse = await page.request.post(`/api/ims/stocktakes/${stocktakeId}/items`, {
      data: { variant_id: config.fixtureVariantId, location_id: config.fixtureLocationId },
    });
    const added = await addResponse.json() as { item?: { id?: number; expected_qty?: number }; error?: string };
    expect(addResponse.ok(), added.error).toBe(true);
    expect(Number(added.item?.expected_qty)).toBe(0);
    const itemId = Number(added.item?.id);
    expect(itemId).toBeGreaterThan(0);

    const countResponse = await page.request.put(`/api/ims/stocktakes/${stocktakeId}`, {
      data: { action: 'bulk_update_items', items: [{ item_id: itemId, counted_qty: 2, notes: 'FIFO live verification gain' }] },
    });
    expect(countResponse.ok(), (await countResponse.json()).error).toBe(true);
    const draft = await (await page.request.get(`/api/ims/stocktakes/${stocktakeId}`)).json() as { updated_at?: string };
    const startResponse = await page.request.put(`/api/ims/stocktakes/${stocktakeId}`, {
      data: {
        action: 'change_status', status: 'in_progress',
        operationKey: `live-e2e-${config.runId}-p9-start`, expectedUpdatedAt: draft.updated_at,
      },
    });
    const started = await startResponse.json() as { status?: string; error?: string };
    expect(startResponse.ok(), started.error).toBe(true);
    expect(started.status).toBe('in_progress');

    const inProgress = await (await page.request.get(`/api/ims/stocktakes/${stocktakeId}`)).json() as { updated_at?: string };
    const applyResponse = await page.request.post(`/api/ims/stocktakes/${stocktakeId}/apply`, {
      data: { operationKey: `live-e2e-${config.runId}-p9-apply`, expectedUpdatedAt: inProgress.updated_at },
    });
    const applied = await applyResponse.json() as { status?: string; variances?: number; error?: string };
    expect(applyResponse.ok(), applied.error).toBe(true);
    expect(applied).toMatchObject({ status: 'completed', variances: 1 });

    const snapshot = await verifyLiveFifoIntegrity(config);
    expect(snapshot.stockQuantity).toBe(2);
    expect(snapshot.layerQuantity).toBe(2);
    await appendManifestState(config.runId, 'p9_created', {
      scenario: 'P9 FIFO stocktake', stocktakeId,
      stockQuantity: snapshot.stockQuantity, layerQuantity: snapshot.layerQuantity,
    });
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P9 FIFO stocktake', stocktakeId,
      operatorChecks: ['Stocktake is completed with a two-unit gain', 'FIFO source layer is active with two units remaining'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P9 FIFO stocktake', stocktakeId, error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

test('@p9-compensate reverses the isolated FIFO stocktake and restores baseline', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const stocktakeId = stocktakeIdFrom(events);
  expect(config.expectedCostingMethod).toBe('fifo');
  expect(['acknowledged', 'compensation_retry_authorized']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'P9 FIFO stocktake', stocktakeId });

  try {
    const completed = await (await page.request.get(`/api/ims/stocktakes/${stocktakeId}`)).json() as { status?: string; updated_at?: string };
    expect(completed.status).toBe('completed');
    const revertResponse = await page.request.post(`/api/ims/stocktakes/${stocktakeId}/revert`, {
      data: {
        reason: `LIVE E2E ${config.runId} completed reversal`,
        operationKey: `live-e2e-${config.runId}-p9-revert`, expectedUpdatedAt: completed.updated_at,
      },
    });
    const reverted = await revertResponse.json() as { status?: string; reverted?: number; xeroReversalStatus?: string; error?: string };
    expect(revertResponse.ok(), reverted.error).toBe(true);
    expect(reverted).toMatchObject({ status: 'reverted', reverted: 1, xeroReversalStatus: 'not_required' });

    const restored = await verifyLiveFifoIntegrity(config);
    expect(restored.stockQuantity).toBe(0);
    expect(restored.layerQuantity).toBe(0);
    await appendManifestState(config.runId, 'clean', {
      scenario: 'P9 FIFO stocktake', stocktakeId,
      stockQuantity: restored.stockQuantity, layerQuantity: restored.layerQuantity,
      permanentArtifacts: ['Reverted stocktake and immutable FIFO movement/allocation history'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P9 FIFO stocktake', phase: 'compensation', stocktakeId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});