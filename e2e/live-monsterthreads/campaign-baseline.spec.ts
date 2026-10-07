import { expect, test } from '@playwright/test';

import type { InventoryCostSwitchPreview } from '../../src/lib/ims/costing/inventoryCostSwitch';
import { assertPreflightIdentity, loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { loadCampaignInventoryBaseline } from './support/database-preflight';
import { appendManifestState } from './support/manifest-store';

test.describe.configure({ timeout: 180_000 });

test('@campaign-baseline records stock, historical costs and transition blockers without changing inventory', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('preflight');
  try {
    await loginToIms(page, config);
    const identityResponse = await page.request.get('/api/user/me');
    expect(identityResponse.ok()).toBe(true);
    assertPreflightIdentity(config, await identityResponse.json());
    await appendManifestState(config.runId, 'preflight_passed', { scenario: 'campaign-baseline', readOnly: true });

    const before = await loadCampaignInventoryBaseline(config);
    const targetMethod = config.expectedCostingMethod === 'fifo' ? 'average_cost' : 'fifo';
    await page.getByTestId('ims-settings-open').click();
    const panel = page.getByTestId('inventory-costing-settings');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('inventory-costing-current-method'))
      .toHaveText(config.expectedCostingMethod === 'fifo' ? 'FIFO' : 'Average Cost');

    const response = await page.request.get(`/api/ims/settings/inventory-costing?targetMethod=${targetMethod}`);
    expect(response.ok()).toBe(true);
    const body = await response.json() as { success: boolean; preview: InventoryCostSwitchPreview };
    expect(body.success).toBe(true);
    expect(body.preview).toMatchObject({
      currentMethod: config.expectedCostingMethod,
      targetMethod,
      revision: before.revision,
      stockRowCount: before.stockRowCount,
      positiveStockRowCount: before.positiveStockRowCount,
    });
    expect(body.preview.totalQuantity).toBeCloseTo(before.positiveQuantity, 4);
    expect(body.preview.totalValue).toBeCloseTo(config.expectedCostingMethod === 'fifo'
      ? before.activeLayerValue : before.averageStockValue, 2);
    expect(Array.isArray(body.preview.blockers)).toBe(true);
    expect(Array.isArray(body.preview.warnings)).toBe(true);
    await expect(panel.getByTestId('inventory-costing-switch')).toBeDisabled();
    const after = await loadCampaignInventoryBaseline(config);
    expect(after).toEqual(before);

    await appendManifestState(config.runId, 'campaign_baseline_recorded', {
      before,
      after,
      targetMethod,
      transitionBlockers: body.preview.blockers,
      transitionWarnings: body.preview.warnings,
      mutatingCampaignAuthorized: false,
    });
    await page.screenshot({ path: test.info().outputPath('inventory-costing-baseline.png'), fullPage: true });
    await appendManifestState(config.runId, 'clean', { readOnly: true, stockAndHistoricalCostsUnchanged: true });
  } catch {
    await appendManifestState(config.runId, 'blocked', {
      scenario: 'campaign-baseline',
      readOnly: true,
      reason: 'Baseline assertions failed; inspect the local Playwright report before proceeding.',
    }).catch(() => {});
    throw new Error('Campaign baseline failed; inventory mutation remains blocked. Inspect the local Playwright report.');
  }
});