import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { verifyLiveFifoIntegrity } from './support/fifo-database';
import { appendManifestState, readManifest } from './support/manifest-store';

test.describe.configure({ timeout: 120_000 });

test('@fifo-activate switches the sandbox to FIFO exactly once and verifies opening layers', async ({ page }) => {
  const config = loadLiveE2EConfig();
  const events = await readManifest(config.runId);
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