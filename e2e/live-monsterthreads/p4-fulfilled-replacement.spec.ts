import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState, readManifest } from './support/manifest-store';
import { verifySalesOrderReplacementCompensation, verifySalesOrderReplacementDraft } from './support/database-preflight';

test.describe.configure({ timeout: 120_000 });

function p4ReplacementSoId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.replacementSoId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P4 replacement sales order ID.');
}

function p4SourceSoId(events: Awaited<ReturnType<typeof readManifest>>): number {
  for (const event of [...events].reverse()) {
    const value = Number((event.details as any)?.sourceSoId);
    if (Number.isInteger(value) && value > 0) return value;
  }
  throw new Error('Live E2E blocked: manifest does not contain the P4 source sales order ID.');
}

test('@p4-create creates a replacement draft from a fulfilled SO and pauses for inspection', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  expect(['preflight_passed', 'p4_created']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);

  let sourceSoId: number | null = null;
  let replacementSoId: number | null = null;
  try {
    const listResponse = await page.request.get('/api/ims/sales-orders');
    const list = await listResponse.json() as { success?: boolean; data?: any[]; error?: string };
    expect(listResponse.ok(), list.error).toBe(true);

    const replacementCandidate = (Array.isArray(list.data) ? list.data : []).find(order =>
      ['draft', 'confirmed'].includes(String(order.status))
      && Number(order.location_id) === config.fixtureLocationId
      && Number(order.customer_id) === config.fixtureCustomerId
      && String(order.notes ?? '').includes(`LIVE E2E ${config.runId} P4 replacement`),
    );

    if (replacementCandidate) {
      replacementSoId = Number(replacementCandidate.id);
      const detailResponse = await page.request.get(`/api/ims/sales-orders/${replacementSoId}`);
      const detail = await detailResponse.json() as { success?: boolean; data?: any; error?: string };
      expect(detailResponse.ok(), detail.error).toBe(true);
      sourceSoId = Number(detail?.data?.replacement_of_so_id ?? 0);
      expect(sourceSoId).toBeGreaterThan(0);
    } else {
      const sourceCandidate = (Array.isArray(list.data) ? list.data : []).find(order =>
        String(order.status) === 'fulfilled'
        && Number(order.location_id) === config.fixtureLocationId
        && Number(order.customer_id) === config.fixtureCustomerId,
      );
      if (!sourceCandidate) {
        throw new Error('Live E2E blocked: no fulfilled fixture SO was found for P4 replacement.');
      }
      sourceSoId = Number(sourceCandidate.id);
      expect(sourceSoId).toBeGreaterThan(0);

      const createResponse = await page.request.post(`/api/ims/sales-orders/${sourceSoId}/replacement`, { data: {} });
      const created = await createResponse.json() as { success?: boolean; id?: number; error?: string };
      expect(createResponse.ok(), created.error).toBe(true);
      expect(created.success, created.error).toBe(true);
      replacementSoId = Number(created.id);
      expect(replacementSoId).toBeGreaterThan(0);

      const replacementDetailResponse = await page.request.get(`/api/ims/sales-orders/${replacementSoId}`);
      const replacementDetail = await replacementDetailResponse.json() as { success?: boolean; data?: any; error?: string };
      expect(replacementDetailResponse.ok(), replacementDetail.error).toBe(true);
      const updatedAt = typeof replacementDetail?.data?.updated_at === 'string' ? replacementDetail.data.updated_at : null;
      const tagResponse = await page.request.put(`/api/ims/sales-orders/${replacementSoId}`, {
        data: {
          notes: `LIVE E2E ${config.runId} P4 replacement`,
          operationKey: `live-e2e-${config.runId}-p4-tag-${replacementSoId}-${Date.now()}`,
          expectedUpdatedAt: updatedAt,
        },
      });
      const tagged = await tagResponse.json() as { success?: boolean; error?: string };
      expect(tagResponse.ok(), tagged.error).toBe(true);
      expect(tagged.success, tagged.error).toBe(true);
    }

    const verification = await verifySalesOrderReplacementDraft(config, Number(sourceSoId), Number(replacementSoId));
    await appendManifestState(config.runId, 'p4_created', {
      scenario: 'P4',
      sourceSoId,
      replacementSoId,
      ...verification,
    });
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'P4',
      sourceSoId,
      replacementSoId,
      ...verification,
      operatorChecks: [
        'Source fulfilled SO remains immutable and untouched',
        'Replacement draft exists with no fulfilled quantity and no Xero invoice link',
        'Fixture stock stays exactly at preflight baseline',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P4',
      phase: 'create_replacement',
      sourceSoId,
      replacementSoId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

test('@p4-compensate removes the replacement draft and verifies baseline is unchanged', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const replacementSoId = p4ReplacementSoId(events);
  const sourceSoId = p4SourceSoId(events);
  expect(['acknowledged', 'compensation_retry_authorized']).toContain(events.at(-1)?.state);
  await loginToIms(page, config);
  await appendManifestState(config.runId, 'compensating', { scenario: 'P4', sourceSoId, replacementSoId });

  try {
    const detailResponse = await page.request.get(`/api/ims/sales-orders/${replacementSoId}`);
    const detail = await detailResponse.json() as { success?: boolean; data?: any; error?: string };
    if (detailResponse.ok() && detail?.data) {
      const status = String(detail.data.status ?? '');
      if (status === 'draft') {
        const deleteResponse = await page.request.delete(`/api/ims/sales-orders/${replacementSoId}`);
        const deleted = await deleteResponse.json() as { success?: boolean; error?: string };
        expect(deleteResponse.ok(), deleted.error).toBe(true);
        expect(deleted.success, deleted.error).toBe(true);
      } else if (['confirmed', 'backordered', 'partially_fulfilled'].includes(status)) {
        const cancelResponse = await page.request.put(`/api/ims/sales-orders/${replacementSoId}`, {
          data: {
            status: 'cancelled',
            operationKey: `live-e2e-${config.runId}-p4-cancel-${replacementSoId}-${Date.now()}`,
            expectedUpdatedAt: typeof detail.data.updated_at === 'string' ? detail.data.updated_at : null,
          },
        });
        const cancelled = await cancelResponse.json() as { success?: boolean; error?: string };
        expect(cancelResponse.ok(), cancelled.error).toBe(true);
        expect(cancelled.success, cancelled.error).toBe(true);
      }
    }

    const verification = await verifySalesOrderReplacementCompensation(config, replacementSoId);
    await appendManifestState(config.runId, 'clean', {
      scenario: 'P4',
      sourceSoId,
      replacementSoId,
      ...verification,
      permanentArtifacts: [
        'Source fulfilled SO remains immutable with original shipment history',
        'Temporary replacement draft was removed/cancelled without stock mutation',
      ],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'P4',
      phase: 'compensation',
      sourceSoId,
      replacementSoId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});
