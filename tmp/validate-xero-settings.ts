import 'dotenv/config';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { query } from '../src/services/MySQLService';

async function main() {
  const businesses = await query<any>("SELECT business_id FROM businesses WHERE ims_db_name = 'readyedu_MonsterthreadsSandboxIMS' AND deleted_at IS NULL");
  assert.equal(businesses.length, 1);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post('http://localhost:3012/api/auth/login', { data: { email: process.env.LIVE_E2E_ADMIN_EMAIL, password: process.env.LIVE_E2E_ADMIN_PASSWORD, destination: 'ims' } });
    assert.ok(login.ok() && (await login.json()).success, 'Sandbox login required');
    const identity = await context.request.get('http://localhost:3012/api/user/me');
    assert.equal((await identity.json()).businessId, businesses[0].business_id, 'Exact sandbox tenant required');
    const settingsResponse = await context.request.get('http://localhost:3012/api/ims/settings');
    const settings = await settingsResponse.json();
    assert.ok(settingsResponse.ok() && settings.capabilities.xeroAccountingEnabled, 'Sandbox Xero capability must already be enabled');
    const initialEnabled = ['true', '1'].includes(String(settings.data.advisor_xero_payouts_enabled ?? '').toLowerCase());
    let savedValue: string | null = null;
    await context.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') await route.abort(); else await route.continue();
    });
    await context.route('**/api/ims/settings', async route => {
      if (route.request().method() === 'PUT') {
        const updates = route.request().postDataJSON().settings;
        assert.deepEqual(Object.keys(updates), ['advisor_xero_payouts_enabled']);
        savedValue = updates.advisor_xero_payouts_enabled;
        await route.fulfill({ json: { success: true } });
      } else {
        const response = await route.fetch();
        const body = await response.json();
        if (savedValue !== null) body.data.advisor_xero_payouts_enabled = savedValue;
        await route.fulfill({ response, json: body });
      }
    });
    const page = await context.newPage();
    const errors: string[] = [];
    const missingResources = new Set<string>();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() === 404) missingResources.add(new URL(response.url()).pathname); });
    await page.goto('http://localhost:3012/ims#settings-xero');
    await page.getByRole('heading', { name: 'Xero Access', exact: true }).waitFor();
    const checkbox = page.getByRole('checkbox', { name: /Advisors.*Shopify payouts/i });
    if (initialEnabled) await expect(checkbox).toBeChecked(); else await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    if (initialEnabled) await expect(checkbox).not.toBeChecked(); else await expect(checkbox).toBeChecked();
    await expect.poll(() => savedValue).toBe(initialEnabled ? 'false' : 'true');
    await page.screenshot({ path: 'tmp/xero-settings-desktop.png', fullPage: true });
    const accountsLoaded = page.waitForResponse(response => response.url().includes('/api/xero/accounts?') && response.request().method() === 'GET');
    await page.getByRole('button', { name: 'Open Accounts & Tracking', exact: true }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#xero/setup/ledger');
    await page.getByText('Accounts & Tracking', { exact: true }).first().waitFor();
    assert.ok((await accountsLoaded).ok(), 'Xero accounts request must succeed');
    await page.getByText('Layby Deposits', { exact: true }).waitFor();
    await page.screenshot({ path: 'tmp/xero-accounts-desktop.png', fullPage: true });
    assert.deepEqual(errors, [], 'Xero navigation must not raise browser exceptions');
    console.log('PASS: authenticated Xero settings, saved-value initialization, intercepted checkbox save and Accounts & Tracking navigation; no real writes.');
    console.log('404 resources:', JSON.stringify([...missingResources]));
  } finally { await browser.close(); }
}
main().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });