import { expect, test } from '@playwright/test';
import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { verifyLiveFifoIntegrity } from './support/fifo-database';
import { appendManifestState, readManifest } from './support/manifest-store';
import { loadCampaignInventoryBaseline } from './support/database-preflight';

test.describe.configure({ timeout: 600_000 });

test('@fifo-activate switches the sandbox to FIFO exactly once and verifies opening layers', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
  const recordedActivation = [...events].reverse().find(event => event.state === 'fifo_activated');
  if (events.at(-1)?.state === 'blocked' && recordedActivation) {
    expect(config.expectedCostingMethod).toBe('fifo');
    const epochId = Number((recordedActivation.details as { epochId?: unknown } | null)?.epochId);
    expect(epochId).toBeGreaterThan(0);
    const snapshot = await verifyLiveFifoIntegrity(config);
    expect(snapshot.activeEpochId).toBe(epochId);
    await appendManifestState(config.runId, 'fifo_activated', { epochId, verificationResumed: true });
    await appendManifestState(config.runId, 'clean', {
      costingMethod: snapshot.method,
      activeEpochId: snapshot.activeEpochId,
      permanentArtifacts: ['FIFO costing epoch and opening cost layers'],
    });
    return;
  }
  expect(config.expectedCostingMethod).toBe('average_cost');
  expect(events.at(-1)?.state).toBe('preflight_passed');
  await loginToIms(page, config);

  try {
    await page.getByTestId('ims-settings-open').click();
    const panel = page.getByTestId('inventory-costing-settings');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('inventory-costing-current-method')).toHaveText('Average Cost');

    const previewResponse = await page.request.get('/api/ims/settings/inventory-costing?targetMethod=fifo');
    const previewBody = await previewResponse.json() as { success?: boolean; preview?: any; error?: string };
    expect(previewResponse.ok(), previewBody.error).toBe(true);
    expect(previewBody.preview).toMatchObject({ currentMethod: 'average_cost', targetMethod: 'fifo' });
    const blockers = Array.isArray(previewBody.preview.blockers) ? previewBody.preview.blockers.map(String) : [];
    if (blockers.length > 0) {
      throw new Error(`FIFO activation preview is blocked: ${blockers.join(' ')}`);
    }

    await page.locator('#inventory-costing-reason').fill(`LIVE E2E ${config.runId} one-time FIFO activation`);
    await page.locator('#inventory-costing-confirmation').fill('FIFO');
    const switchResponse = page.waitForResponse(response => response.url().endsWith('/api/ims/settings/inventory-costing')
      && response.request().method() === 'POST');
    await panel.getByTestId('inventory-costing-switch').click();
    const response = await switchResponse;
    const switched = await response.json() as { success?: boolean; epochId?: number; replayed?: boolean; error?: string };
    expect(response.ok(), switched.error).toBe(true);
    expect(switched.success, switched.error).toBe(true);
    expect(switched.replayed).toBe(false);
    expect(Number(switched.epochId)).toBeGreaterThan(0);

    await appendManifestState(config.runId, 'fifo_activated', {
      epochId: Number(switched.epochId),
      openingQuantity: Number(previewBody.preview.totalQuantity),
      openingValue: Number(previewBody.preview.totalValue),
    });
    const snapshot = await verifyLiveFifoIntegrity(config);
    expect(snapshot.activeEpochId).toBe(Number(switched.epochId));
    await appendManifestState(config.runId, 'clean', {
      costingMethod: snapshot.method,
      activeEpochId: snapshot.activeEpochId,
      permanentArtifacts: ['FIFO costing epoch and opening cost layers'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'FIFO activation',
      phase: 'preview_or_switch',
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
});

async function switchOracle(config: ReturnType<typeof loadLiveE2EConfig>) {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  });
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const schema = connection.escapeId(config.expectedImsSchema);
    const [epochs] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, method, status, operation_key FROM ${schema}.ims_inventory_cost_epochs WHERE business_id = ? ORDER BY id`,
      [config.expectedBusinessId],
    );
    const [quantities] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT variant_id, location_id, qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? ORDER BY variant_id, location_id`, [config.expectedBusinessId],
    );
    const [layers] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, epoch_id, remaining_quantity, unit_cost FROM ${schema}.ims_fifo_cost_layers WHERE business_id = ? ORDER BY id`,
      [config.expectedBusinessId],
    );
    return { epochs, layers, quantityFingerprint: createHash('sha256').update(JSON.stringify(quantities)).digest('hex') };
  } finally {
    await connection.rollback();
    await connection.end();
  }
}

test('@cost-switch verifies a prospective method transition, replay and unchanged historical costs', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('cost-switch');
  const target = process.env.LIVE_E2E_TARGET_COSTING_METHOD;
  expect(['average_cost', 'fifo']).toContain(target);
  const targetMethod = target as 'average_cost' | 'fifo';
  const events = await readManifest(config.runId);
  const recorded = events.findLast(event => event.state === 'costing_switched')?.details as {
    before: Awaited<ReturnType<typeof loadCampaignInventoryBaseline>>;
    oracle: Awaited<ReturnType<typeof switchOracle>>;
    request: { targetMethod: string; expectedRevision: number; operationKey: string; reason: string };
    epochId?: number;
  } | undefined;
  if (!recorded) expect(events.at(-1)?.state).toBe('preflight_passed');
  const before = recorded?.before ?? await loadCampaignInventoryBaseline(config);
  const oracle = recorded?.oracle ?? await switchOracle(config);
  expect(targetMethod).not.toBe(before.method);
  const request = recorded?.request ?? {
    targetMethod, expectedRevision: before.revision, operationKey: `${config.runId}:cost-switch:${targetMethod}`,
    reason: `LIVE E2E ${config.runId} prospective costing transition`,
  };
  expect(request.targetMethod).toBe(targetMethod);
  await loginToIms(page, config);
  try {
    if (!recorded) {
      const previewResponse = await page.request.get(`/api/ims/settings/inventory-costing?targetMethod=${targetMethod}`);
      const preview = await previewResponse.json();
      expect(previewResponse.ok(), preview.error).toBe(true);
      expect(preview.preview).toMatchObject({ currentMethod: before.method, targetMethod, revision: before.revision });
      expect(preview.preview.blockers, 'No automatic reconciliation or cost repair is permitted.').toEqual([]);
      await appendManifestState(config.runId, 'costing_switched', { phase: 'request_prepared', before, oracle, request });
    } else {
      const current = await switchOracle(config);
      const matching = current.epochs.filter(epoch => epoch.operation_key === request.operationKey);
      expect(matching).toHaveLength(1);
      expect(matching[0].method).toBe(targetMethod);
      expect(matching[0].status).toBe('active');
    }
    const response = await page.request.post('/api/ims/settings/inventory-costing', { data: request });
    const switched = await response.json();
    expect(response.ok(), switched.error).toBe(true);
    expect(switched.success).toBe(true);
    expect(switched.replayed).toBe(Boolean(recorded));
    const epochId = Number(switched.epochId);
    expect(epochId).toBeGreaterThan(Number(before.epochId));
    await appendManifestState(config.runId, 'costing_switched', { phase: 'committed', before, oracle, request, epochId });
    const after = await loadCampaignInventoryBaseline({ ...config, expectedCostingMethod: targetMethod });
    const afterOracle = await switchOracle(config);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.epochId).toBe(epochId);
    expect(after.historicalMovementCount).toBe(before.historicalMovementCount);
    expect(after.movementCostFingerprint).toBe(before.movementCostFingerprint);
    expect(afterOracle.quantityFingerprint).toBe(oracle.quantityFingerprint);
    expect(afterOracle.epochs).toHaveLength(oracle.epochs.length + 1);
    expect(afterOracle.epochs.filter(epoch => epoch.status === 'active').map(epoch => Number(epoch.id))).toEqual([epochId]);
    expect(afterOracle.layers.filter(layer => Number(layer.epoch_id) !== epochId)).toEqual(oracle.layers);
    const replay = await page.request.post('/api/ims/settings/inventory-costing', { data: request });
    expect(replay.ok()).toBe(true);
    expect(await replay.json()).toMatchObject({ success: true, epochId, replayed: true });
    const changed = await page.request.post('/api/ims/settings/inventory-costing', { data: { ...request, reason: `${request.reason} changed` } });
    expect(changed.status()).toBe(409);
    const stale = await page.request.post('/api/ims/settings/inventory-costing', { data: {
      ...request, operationKey: `${request.operationKey}:stale`, targetMethod: before.method,
    } });
    expect(stale.status()).toBe(409);
    expect(await loadCampaignInventoryBaseline({ ...config, expectedCostingMethod: targetMethod })).toEqual(after);
    expect(await switchOracle(config)).toEqual(afterOracle);
    const fifo = targetMethod === 'fifo' ? await verifyLiveFifoIntegrity({ ...config, expectedCostingMethod: 'fifo' }) : null;
    await appendManifestState(config.runId, 'clean', {
      scenario: 'Prospective costing transition', fromMethod: before.method, targetMethod, epochId, fifo,
      historicalMovementCostsUnchanged: true, stockQuantitiesUnchanged: true,
      permanentArtifacts: ['Prospective valuation epoch; prior epochs and historical movement costs retained'],
    });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { scenario: 'Prospective costing transition', request,
      error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    throw error;
  }
});