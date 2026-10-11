const { chromium } = require('playwright');
require('dotenv').config({ quiet: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: 'http://localhost:3035', viewport: { width: 1440, height: 1000 } });
    const response = await context.request.post('/api/auth/login', { data: { email: process.env.LIVE_E2E_ADMIN_EMAIL, password: process.env.LIVE_E2E_ADMIN_PASSWORD, destination: 'ims' } });
    const login = await response.json();
    if (!response.ok() || !login.success || login.requiresMfa) throw new Error('Sandbox login unavailable or requires human MFA');
    const identity = await (await context.request.get('/api/user/me')).json();
    if (identity.businessId !== process.env.LIVE_E2E_EXPECTED_BUSINESS_ID) throw new Error('Unexpected sandbox identity');
    const page = await context.newPage();
    await page.goto('/ims');
    await page.getByTestId('ims-nav-__purchasing').click();
    await page.getByTestId('ims-nav-purchase-orders').click();
    await page.getByTestId('po-new').click();
    await page.getByTestId('po-supplier').locator('option[value=""] ~ option').first().waitFor({ state: 'attached' });
    const suppliers = await page.getByTestId('po-supplier').locator('option').evaluateAll(options => options.filter(option => option.value).map(option => ({ id: Number(option.value), name: option.textContent })));
    const supplier = suppliers[0];
    if (!supplier) throw new Error('No sandbox supplier');
    let writeCount = 0;
    await page.route('**/api/ims/**', async route => {
      if (route.request().url().endsWith('/ai/parse-invoice')) return route.fulfill({ json: {
        success: true, supplier_exact: true, cost_currency_known: true, cost_tax_known: true, matched_supplier: supplier,
        invoice: { supplier_name: supplier.name, invoice_number: 'UI-ONLY', currency: 'AUD', prices_include_tax: 'ex_tax', total_amount: 20 },
        line_results: [
          { invoice_line: { product_code: 'PROBE-A', product_name: 'Review supplier', qty: 1, unit_price: 10, printed_unit_price: 20, line_total: 10, discount_pct: 50, tax_rate: 0 }, match: { variant_id: 'probe-a', sku: 'PROBE-A', product_name: 'Review supplier', cost_aud: 20, supplier_contact_id: -1, confidence: 'exact_sku', method: 'SKU' } },
          { invoice_line: { product_code: 'PROBE-B', product_name: 'Review cost', qty: 1, unit_price: 10, printed_unit_price: 10, line_total: 10, discount_pct: 0, tax_rate: 0 }, match: { variant_id: 'probe-b', sku: 'PROBE-B', product_name: 'Review cost', cost_aud: 30, supplier_contact_id: supplier.id, confidence: 'exact_sku', method: 'SKU' } },
        ],
      } });
      if (route.request().method() !== 'GET') { writeCount++; return route.abort(); }
      return route.continue();
    });
    await page.getByTestId('po-form').locator('input[type=file]').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') });
    await page.getByText('Cost supports match (within 5%)', { exact: true }).waitFor();
    await page.getByText('Cost differs (over 5%)', { exact: true }).waitFor();
    const importButton = page.getByRole('button', { name: /^Import \d+ Lines? to PO$/ });
    if (!await importButton.isDisabled()) throw new Error('Import not gated');
    const reviews = page.getByRole('checkbox', { name: 'Reviewed', exact: true });
    if (await reviews.count() !== 2) throw new Error('Expected supplier and cost reviews');
    await reviews.nth(0).check();
    await reviews.nth(1).check();
    if (await importButton.isDisabled()) throw new Error('Acknowledged import remains blocked');
    const supplierSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Unmatched' }) }).last();
    await supplierSelect.selectOption('');
    if (!await importButton.isDisabled() || await reviews.nth(0).isChecked()) throw new Error('Supplier change did not reset review');
    await page.screenshot({ path: 'tmp/invoice-cost-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const tableScroller = reviews.first().locator('xpath=ancestor::table/parent::*');
    await tableScroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await reviews.first().scrollIntoViewIfNeeded();
    if (!await reviews.first().isVisible()) throw new Error('Mobile review inaccessible');
    await page.screenshot({ path: 'tmp/invoice-cost-mobile.png', fullPage: true });
    if (writeCount) throw new Error('Unexpected operational write attempted');
    console.log('PASS: supplier and cost gates, both invoice cost bases, acknowledgement reset, desktop/mobile screenshots; no operational writes');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });