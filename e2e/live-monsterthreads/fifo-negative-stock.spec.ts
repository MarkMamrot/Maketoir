import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { loadNegativeStockPositions } from './support/fifo-database';
import { appendManifestState, readManifest } from './support/manifest-store';

test.describe.configure({ timeout: 300_000 });

test('@fifo-reconcile-negative creates auditable stocktakes that bring negative sandbox positions to zero', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  expect(config.expectedCostingMethod).toBe('average_cost');
  expect(['preflight_passed', 'blocked']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);

  const before = await loadNegativeStockPositions(config);
  if (before.length === 0) throw new Error('Live E2E blocked: no negative stock positions require reconciliation.');
  const byLocation = Map.groupBy(before, position => position.locationId);
  const priorStocktakeIds = events.flatMap(event => {
    const ids = (event.details as { stocktakeIds?: unknown } | null)?.stocktakeIds;
    return Array.isArray(ids) ? ids.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
  });
  const stocktakeIds: number[] = [...new Set(priorStocktakeIds)];
  try {
    for (const [locationId, positions] of byLocation) {
      const reference = `FIFO-PREP-${config.runId}-L${locationId}`;
      const listResponse = await page.request.get('/api/ims/stocktakes');
      const list = await listResponse.json() as Array<{ id: number; reference: string; location_id: number; status: string }>;
      expect(listResponse.ok()).toBe(true);
      const existing = Array.isArray(list)
        ? list.find(stocktake => stocktake.reference === reference && Number(stocktake.location_id) === locationId)
        : null;
      let stocktakeId = Number(existing?.id);
      if (!Number.isInteger(stocktakeId) || stocktakeId <= 0) {
        const createResponse = await page.request.post('/api/ims/stocktakes', {
          data: {
            reference,
            location_id: locationId,
            blank: true,
            notes: 'Approved sandbox correction: bring negative stock positions to zero before FIFO activation.',
          },
        });
        const created = await createResponse.json() as { id?: number; error?: string };
        expect(createResponse.ok(), created.error).toBe(true);
        stocktakeId = Number(created.id);
        expect(stocktakeId).toBeGreaterThan(0);
        stocktakeIds.push(stocktakeId);
      }

      const existingDetailResponse = await page.request.get(`/api/ims/stocktakes/${stocktakeId}`);
      const existingDetail = await existingDetailResponse.json() as { status?: string; items?: Array<{ id: number; variant_id: string }>; updated_at?: string; error?: string };
      expect(existingDetailResponse.ok(), existingDetail.error).toBe(true);
      const existingItems = new Map((existingDetail.items ?? []).map(item => [String(item.variant_id), item]));

      const itemUpdates: Array<{ item_id: number; counted_qty: number; notes: string }> = [];
      for (const position of positions) {
        let item = existingItems.get(position.variantId);
        if (!item) {
          const addResponse = await page.request.post(`/api/ims/stocktakes/${stocktakeId}/items`, {
            data: { variant_id: position.variantId, location_id: locationId },
          });
          const added = await addResponse.json() as { item?: { id?: number; expected_qty?: number; variant_id?: string }; error?: string };
          expect(addResponse.ok(), added.error).toBe(true);
          expect(Number(added.item?.expected_qty)).toBe(position.quantity);
          item = { id: Number(added.item?.id), variant_id: String(added.item?.variant_id ?? position.variantId) };
        }
        itemUpdates.push({
          item_id: Number(item.id),
          counted_qty: 0,
          notes: `FIFO activation preparation; previous quantity ${position.quantity}`,
        });
      }

      const updateResponse = await page.request.put(`/api/ims/stocktakes/${stocktakeId}`, {
        data: { action: 'bulk_update_items', items: itemUpdates },
      });
      expect(updateResponse.ok(), (await updateResponse.json()).error).toBe(true);
      const detailResponse = await page.request.get(`/api/ims/stocktakes/${stocktakeId}`);
      const detail = await detailResponse.json() as { updated_at?: string; error?: string };
      expect(detailResponse.ok(), detail.error).toBe(true);

      let expectedUpdatedAt = detail.updated_at;
      if (existingDetail.status === 'draft') {
        const startResponse = await page.request.put(`/api/ims/stocktakes/${stocktakeId}`, {
          data: {
            action: 'change_status',
            status: 'in_progress',
            operationKey: `live-e2e-${config.runId}-negative-stock-start-${stocktakeId}`,
            expectedUpdatedAt: detail.updated_at,
          },
        });
        const started = await startResponse.json() as { status?: string; error?: string };
        expect(startResponse.ok(), started.error).toBe(true);
        expect(started.status).toBe('in_progress');
        const startedDetailResponse = await page.request.get(`/api/ims/stocktakes/${stocktakeId}`);
        const startedDetail = await startedDetailResponse.json() as { updated_at?: string; error?: string };
        expect(startedDetailResponse.ok(), startedDetail.error).toBe(true);
        expectedUpdatedAt = startedDetail.updated_at;
      } else {
        expect(existingDetail.status).toBe('in_progress');
      }

      const applyResponse = await page.request.post(`/api/ims/stocktakes/${stocktakeId}/apply`, {
        data: {
          operationKey: `live-e2e-${config.runId}-negative-stock-${stocktakeId}`,
          expectedUpdatedAt,
        },
      });
      const applied = await applyResponse.json() as { status?: string; variances?: number; error?: string };
      expect(applyResponse.ok(), applied.error).toBe(true);
      expect(applied.status).toBe('completed');
      expect(Number(applied.variances)).toBe(positions.length);
    }

    const remaining = await loadNegativeStockPositions(config);
    expect(remaining).toEqual([]);
    await appendManifestState(config.runId, 'fifo_negative_stock_reconciled', {
      correctedPositionCount: before.length,
      affectedLocationCount: byLocation.size,
      stocktakeIds,
    });
    await appendManifestState(config.runId, 'clean', { remainingNegativePositions: 0, stocktakeIds });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'FIFO negative stock reconciliation',
      stocktakeIds,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});