import { expect, test } from '@playwright/test';

import { assertPreflightIdentity, loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { appendManifestState } from './support/manifest-store';

test.describe.configure({ timeout: 120_000 });

test('@preflight authenticates only the expected Monsterthreads Admin through the real login UI', async ({ page }) => {
  const config = loadLiveE2EConfig();

  await loginToIms(page, config);

  const response = await page.request.get('/api/user/me');
  expect(response.ok()).toBe(true);
  const identity = await response.json() as { businessId?: string; tier?: string };
  assertPreflightIdentity(config, identity);

  const shopifyResponse = await page.request.get('/api/ims/shopify/status');
  expect(shopifyResponse.ok()).toBe(true);
  const shopify = await shopifyResponse.json() as { connected?: boolean; shop_domain?: string };
  expect(shopify.connected).toBe(true);
  expect(shopify.shop_domain).toBe(config.expectedShopifyShop);

  const xeroResponse = await page.request.get(`/api/xero/status?databaseId=${encodeURIComponent(config.expectedBusinessId)}`);
  expect(xeroResponse.ok()).toBe(true);
  const xero = await xeroResponse.json() as { connected?: boolean; tenantId?: string };
  expect(xero.connected).toBe(true);
  expect(xero.tenantId).toBe(config.expectedXeroTenantId);

  await expect(page.getByText('Solvantis').first()).toBeVisible();
  await appendManifestState(config.runId, 'preflight_passed', {
    authenticatedBusinessId: identity.businessId,
    authenticatedTier: identity.tier,
    shopifyShop: shopify.shop_domain,
    xeroTenantId: xero.tenantId,
  });
});