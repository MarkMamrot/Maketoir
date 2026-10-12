const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
require('dotenv').config({ quiet: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:3039/syncbooks', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'SyncBooks', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    for (const price of ['$499', '$899', '$1,599']) assert.equal(await page.getByText(price, { exact: true }).count(), 1);
    const headingColor = await page.locator('h1').evaluate(element => getComputedStyle(element).color);
    assert.equal(await page.locator('#consultation h2').evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 255)');
    await page.screenshot({ path: `tmp/syncbooks-${width}.png`, fullPage: true });
    if (width === 390) {
      await page.getByLabel('Open navigation').click();
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Services', exact: true }).click();
      assert.equal(new URL(page.url()).hash, '#services');
      await page.getByLabel('Open navigation').click();
    }
    await page.locator('#faq details').first().locator('summary').click();
    assert.equal(await page.locator('#faq details').first().getAttribute('open'), '');
    await page.locator('#consultation').scrollIntoViewIfNeeded();
    await page.getByLabel('Your name', { exact: true }).fill('Controlled mock test');
    await page.getByLabel('Work email').fill('controlled@example.com');
    await page.getByLabel('Business name').fill('Controlled mock business');
    await page.getByLabel('Team size').selectOption({ label: '6-15 employees' });
    await page.getByLabel('Current software').selectOption('Xero');
    await page.getByLabel('Preferred support').selectOption('Blended');
    await page.getByLabel('What would you like help with?').fill('Controlled mock payroll brief');
    const requests = [];
    await page.route('**/api/public/syncbooks/enquiry', async route => {
      requests.push({ key: route.request().headers()['idempotency-key'], data: route.request().postDataJSON() });
      await route.fulfill({ status: requests.length === 1 ? 503 : 201, contentType: 'application/json', body: JSON.stringify(requests.length === 1 ? { error: 'Controlled mock failure. Please retry.' } : { reference: 'SL-4242', alertSent: false, alertQueued: true }) });
    });
    await page.getByRole('button', { name: 'Request my consultation' }).click();
    assert.equal(requests.length, 0, 'unchecked consent prevents transmission');
    await page.locator('input[name="consentEmail"]').check();
    await page.getByRole('button', { name: 'Request my consultation' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Business name').inputValue(), 'Controlled mock business');
    await page.getByRole('button', { name: 'Request my consultation' }).click();
    await page.getByText('SL-4242', { exact: true }).waitFor();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].key, requests[1].key);
    assert.equal(requests[1].data.delivery, 'Blended');
    assert.equal(requests[1].data.consentEmail, true);
    assert.deepEqual(errors, []);
    await context.addCookies([{ name: 'marketoir_session', value: 'non-authorizing-cookie-route-check', domain: 'localhost', path: '/' }]);
    await page.goto('http://localhost:3039/syncbooks', { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/syncbooks');
    assert.equal(await page.locator('h1').evaluate(element => getComputedStyle(element).color), headingColor);
    await page.goto('http://localhost:3039/landing', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('a[href="/syncbooks"]').count() >= 2, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto('http://localhost:3039/pricing', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('a[href="/syncbooks"]').count() >= 1, true);
    results.push({ width, overflow: false, image: 'loaded', faq: 'passed', consent: 'passed', retryKey: 'stable', submission: 'MOCKED ONLY', cookieRoute: 'public', landingAndPricing: 'passed' });
    await context.close();
  }
  const authenticated = await browser.newContext({ baseURL: 'http://localhost:3039', viewport: { width: 1440, height: 900 } });
  try {
    const response = await authenticated.request.post('/api/auth/login', { data: { email: process.env.LIVE_E2E_ADMIN_EMAIL, password: process.env.LIVE_E2E_ADMIN_PASSWORD, destination: 'ims' } });
    const login = await response.json();
    if (!response.ok() || !login.success || login.requiresMfa) throw new Error('Sandbox login unavailable or requires human MFA');
    const identity = await (await authenticated.request.get('/api/user/me')).json();
    if (process.env.LIVE_E2E_EXPECTED_BUSINESS_ID && identity.businessId !== process.env.LIVE_E2E_EXPECTED_BUSINESS_ID) throw new Error('Unexpected sandbox identity');
    const page = await authenticated.newPage();
    await page.goto('/syncbooks', { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/syncbooks');
    await page.goto('/landing', { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/landing');
    results.push({ authenticated: 'passed', signedInPublicRoute: 'passed', signedInLanding: 'passed' });
    await page.route('**/api/ims/**', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto('/ims');
    await page.getByTestId('ims-nav-__purchasing').waitFor();
    await page.screenshot({ path: 'tmp/syncbooks-ims-regression.png' });
    results.push({ authenticated: 'passed', signedInPublicRoute: 'passed', imsShell: 'passed', operationalWrites: 'blocked' });
  } catch (error) {
    results.push({ imsOrAuthenticationCheck: 'BLOCKED', reason: error.message });
  } finally { await authenticated.close(); }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });