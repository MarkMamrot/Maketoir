import 'dotenv/config';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { query } from '../src/services/MySQLService';
import { runImsForBusiness } from '../src/lib/db/BusinessRegistry';
import { imsQuery } from '../src/services/IMSMySQLService';

async function main() {
  const businesses = await query<any>("SELECT business_id FROM businesses WHERE ims_db_name = 'readyedu_MonsterthreadsSandboxIMS' AND deleted_at IS NULL");
  assert.equal(businesses.length, 1);
  const businessId = businesses[0].business_id;
  const device = await runImsForBusiness(businessId, async () => {
    const registers = await imsQuery<any>(`SELECT register.id AS register_id, register.name AS register_name, location.id AS location_id, location.name AS location_name
      FROM pos_registers register JOIN ims_locations location ON location.id = register.location_id
      WHERE location.business_id = ? AND register.is_active = 1 ORDER BY register.id LIMIT 1`, [businessId]);
    assert.ok(registers[0], 'Sandbox register required');
    return { business_id: businessId, ...registers[0] };
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const refundProbe = process.argv.includes('--refund');
    if (refundProbe) await context.route(/\/api\/pos\/laybys(?:\?.*)?$/, async route => {
      if (route.request().method() !== 'GET') { await route.abort(); return; }
      await route.fulfill({ json: { laybys: [{ id: 10, customer_name: 'Refund UI check', total: 129.95, paid_total: 26, fee_percent: 0, retained_fee: 0, layby_state: 'active', accounting_status: 'posted' }] } });
    });
    const page = await context.newPage();
    await context.route(/\/api\/(xero|pos\/xero|pos\/eod)/, async route => {
      if (route.request().method() !== 'GET') await route.abort(); else await route.continue();
    });
    const login = await context.request.post('http://localhost:3012/api/auth/login', { data: { email: process.env.LIVE_E2E_ADMIN_EMAIL, password: process.env.LIVE_E2E_ADMIN_PASSWORD, destination: 'ims' } });
    const loginData = await login.json();
    assert.ok(login.ok() && loginData.success && !loginData.requiresMfa, 'Sandbox authentication was not completed');
    const identity = await context.request.get('http://localhost:3012/api/user/me');
    assert.equal((await identity.json()).businessId, businessId, 'Browser must be authenticated to the exact sandbox');
    await page.addInitScript(config => localStorage.setItem('pos_device_config', JSON.stringify(config)), device);
    await page.goto('http://localhost:3012/pos');
    await page.getByRole('button', { name: 'Continue Session', exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Continue Session', exact: true }).click();
    await page.getByRole('button', { name: 'More options', exact: true }).waitFor({ timeout: 20000 }).catch(async error => {
      await page.screenshot({ path: 'tmp/laybys-browser-blocker.png', fullPage: true });
      console.log('Browser state:', JSON.stringify({ url: page.url(), headings: await page.locator('h1,h2').allTextContents(), buttons: (await page.locator('button').allTextContents()).slice(0, 15) }));
      throw error;
    });
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('button', { name: 'Laybys', exact: true }).click();
    await page.getByRole('heading', { name: 'Laybys', exact: true }).waitFor();
    const loaded = await page.evaluate(async () => { const response = await fetch('/api/pos/laybys'); return { status: response.status, count: (await response.json()).laybys?.length }; });
    assert.equal(loaded.status, 200, 'Assigned admin POS cookie must pass the real layby route');
    await page.screenshot({ path: 'tmp/laybys-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Layby screen must not overflow on mobile');
    await page.screenshot({ path: 'tmp/laybys-mobile.png', fullPage: true });
    if (refundProbe) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'Cancel layby', exact: true }).click();
      await page.getByRole('button', { name: 'Refund and cancel', exact: true }).click();
      await page.getByRole('heading', { name: /Refund/ }).waitFor();
      await page.getByRole('button', { name: 'Cash', exact: true }).click();
      await page.screenshot({ path: 'tmp/layby-refund-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Refund screen must not overflow on mobile');
      await page.screenshot({ path: 'tmp/layby-refund-mobile.png', fullPage: true });
      console.log('PASS: populated cancellation opens the shared cash/card refund dialog on desktop/mobile; no refund issued or recorded.');
      return;
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const branchSettings = page.waitForResponse(response => response.url().includes('/api/pos/settings/location?location_id=') && response.request().method() === 'GET');
    await page.goto('http://localhost:3012/ims#settings-pos');
    await page.getByRole('heading', { name: 'Point of Sale Settings', exact: true }).waitFor();
    const fee = page.getByRole('spinbutton', { name: 'Layby cancellation fee percentage' });
    if (!await fee.isVisible()) await page.getByText(/^\u{1F9FE} Orders$/u).click();
    await fee.waitFor();
    await page.getByRole('combobox', { name: 'Layby fee branch' }).waitFor();
    await page.waitForFunction(() => Boolean(document.querySelector<HTMLSelectElement>('[aria-label="Layby fee branch"]')?.value));
    assert.ok((await branchSettings).ok(), 'Selected sandbox branch settings must load successfully');
    assert.equal(await fee.inputValue(), '0', 'Sandbox branch fee must retain the zero default');
    await page.screenshot({ path: 'tmp/layby-fee-desktop.png', fullPage: true });
    console.log(`PASS: authenticated sandbox desktop/mobile layby workspace, real API (${loaded.count} existing laybys), no monetary/provider requests.`);
  } finally { await browser.close(); }
}
main().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });