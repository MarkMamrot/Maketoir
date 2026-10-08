import 'dotenv/config';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseUrl = process.env.COGS_REPORT_BASE_URL || 'http://localhost:3012';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Report browser validation is restricted to localhost.');
for (const key of ['LIVE_E2E_ADMIN_EMAIL', 'LIVE_E2E_ADMIN_PASSWORD', 'LIVE_E2E_EXPECTED_BUSINESS_ID']) {
  if (!process.env[key]) throw new Error(`${key} is required for authenticated read-only report validation.`);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: /IMS\s*Inventory Management/ }).click();
  await page.getByLabel('Email Address').fill(process.env.LIVE_E2E_ADMIN_EMAIL);
  await page.getByLabel('Password').fill(process.env.LIVE_E2E_ADMIN_PASSWORD);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in to IMS' }).click();
  const login = await responsePromise;
  await page.getByLabel('Password').fill('').catch(() => {});
  const body = await login.json();
  if (body.requiresMfa || body.nextRoute?.startsWith('/auth/mfa/')) throw new Error('Authenticated validation requires human MFA completion; no bypass was attempted.');
  if (!login.ok() || !body.success) throw new Error('Configured sandbox login was rejected.');
  await page.waitForURL(/\/ims(?:$|[?#])/, { timeout: 30000 });
  const identity = await (await page.request.get(`${baseUrl}/api/user/me`)).json();
  if (identity.businessId !== process.env.LIVE_E2E_EXPECTED_BUSINESS_ID) throw new Error('Authenticated business differs from the expected sandbox.');
  const reportResponse = await page.request.get(`${baseUrl}/api/ims/reports/cogs-traceability?window=30&pageSize=1`);
  const report = await reportResponse.json();
  if (!reportResponse.ok() || !report.success) throw new Error(`Report API failed (${reportResponse.status()}): ${report.error || 'unknown error'}`);
  console.log(JSON.stringify({ apiStatus: reportResponse.status(), matchingRecords: report.total, missingCostRecords: report.summary.missingCosts }));
  for (const groups of ['channel,channelInstance', 'cogs']) {
    const groupedResponse = await page.request.get(`${baseUrl}/api/ims/reports/cogs-traceability?window=30&groups=${groups}`);
    const grouped = await groupedResponse.json();
    if (!groupedResponse.ok() || !grouped.success) throw new Error('Grouped report query failed.');
    for (const field of ['qty', 'netSales', 'cogs', 'gp', 'knownCogs', 'missingCosts', 'missingRevenue']) {
      const first = report.summary[field];
      const second = grouped.summary[field];
      if (first == null ? second != null : second == null || Math.abs(first - second) > .000001) throw new Error(`Detail/grouped ${field} totals differ.`);
    }
  }
  const saleResponse = await page.request.get(`${baseUrl}/api/ims/reports/cogs-traceability?window=30&basis=sale&pageSize=200`);
  const saleReport = await saleResponse.json();
  if (!saleResponse.ok() || !saleReport.success) throw new Error('Invoice/sale-date query failed.');
  console.log(JSON.stringify({ saleRecords: saleReport.total, saleIncompleteCosts: saleReport.summary.missingCosts,
    saleCostedRecords: saleReport.summary.costedRecords, saleHasCapturedCosts: saleReport.summary.knownCogs !== 0,
    saleIncompleteSample: saleReport.rows.filter(row => row.cogs == null).map(row => ({ source: row.source, evidence: row.quality })).slice(0, 5) }));
  await page.goto(`${baseUrl}/ims#report-cogs-traceability`);
  await page.getByRole('heading', { name: 'Sales & COGS Traceability', exact: true }).waitFor();
  const dateFilter = page.getByTestId('cogs-date-filter');
  const dateBounds = await dateFilter.boundingBox();
  if (dateBounds.x + dateBounds.width < 1200) throw new Error('Desktop date filter is not right-aligned.');
  await dateFilter.getByRole('button', { name: '30 Days', exact: true }).click();
  const dateDropdown = page.getByRole('button', { name: 'Presets', exact: true }).locator('..').locator('..');
  const dropdownBounds = await dateDropdown.boundingBox();
  if (!dropdownBounds || dropdownBounds.x < 0 || dropdownBounds.x + dropdownBounds.width > 1440) throw new Error('Desktop date dropdown is clipped.');
  await dateFilter.getByRole('button', { name: '30 Days', exact: true }).click();
  await page.getByRole('tab', { name: 'Detail', exact: true }).click();
  const table = page.locator('.cogs-traceability-table-scroll');
  await table.waitFor({ timeout: 60000 });
  if (await page.getByRole('alert').filter({ hasText: /\S/ }).count()) throw new Error('Report displays an operational error.');
  const initialHeadings = await page.locator('.cogs-traceability-table-scroll__header th').evaluateAll(cells => cells.slice(0, 7).map(cell => cell.textContent.trim().toUpperCase()));
  if (!initialHeadings.includes('COGS (AUD)') || !initialHeadings.includes('NET SALES (AUD EX GST)') || !initialHeadings.includes('GP (AUD)')) throw new Error('Core accounting fields are not in the initial Detail columns.');
  const detailRows = table.locator('tbody tr');
  if (await detailRows.count() > 1) {
    const backgrounds = await detailRows.evaluateAll(rows => rows.slice(0, 2).map(row => getComputedStyle(row).backgroundColor));
    if (backgrounds[0] === backgrounds[1]) throw new Error('Detail table is not zebra-striped.');
  }
  const firstCell = table.locator('tbody tr:first-child td:first-child');
  const movingCell = table.locator('tbody tr:first-child td:nth-child(3)');
  const initialFrozenX = (await firstCell.boundingBox()).x;
  const initialMovingX = (await movingCell.boundingBox()).x;
  const overflow = await table.evaluate(element => element.scrollWidth > element.clientWidth);
  if (!overflow) throw new Error('Expected real horizontal table overflow.');
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => {
    const body = document.querySelector('.cogs-traceability-table-scroll');
    const header = document.querySelector('.cogs-traceability-table-scroll__header');
    return body.scrollLeft > 0 && body.scrollLeft === header.scrollLeft;
  });
  if (Math.abs((await firstCell.boundingBox()).x - initialFrozenX) > 1) throw new Error('Frozen reference column moved.');
  if ((await movingCell.boundingBox()).x >= initialMovingX) throw new Error('Non-frozen column did not move.');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.cogs-traceability-table-scroll').scrollLeft === 0);
  const verticalPosition = () => table.evaluate(element => {
    let total = window.scrollY;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) total += parent.scrollTop;
    return total;
  });
  const beforeDown = await verticalPosition();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(before => {
    let total = window.scrollY;
    for (let parent = document.querySelector('.cogs-traceability-table-scroll').parentElement; parent; parent = parent.parentElement) total += parent.scrollTop;
    return total > before;
  }, beforeDown);
  const afterDown = await verticalPosition();
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(before => {
    let total = window.scrollY;
    for (let parent = document.querySelector('.cogs-traceability-table-scroll').parentElement; parent; parent = parent.parentElement) total += parent.scrollTop;
    return total < before;
  }, afterDown);
  if (await table.evaluate(element => element.scrollLeft) !== 0) throw new Error('Vertical keys changed horizontal scrolling.');
  await page.getByRole('button', { name: /^Inspect / }).first().click();
  await page.getByRole('dialog', { name: 'Transaction evidence' }).waitFor();
  await page.getByRole('button', { name: 'Close evidence' }).click();
  await mkdir('test-results/cogs-traceability', { recursive: true });
  await table.evaluate(element => {
    element.scrollLeft = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) parent.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: 'test-results/cogs-traceability/desktop.png' });
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.locator('.cogs-traceability-table-scroll').waitFor();
  if (await page.getByLabel('Grouping 1', { exact: true }).locator('option').count() !== 7) throw new Error('Grouping choices are not limited to practical dimensions.');
  await page.getByLabel('Grouping 1', { exact: true }).selectOption('warehouse');
  await page.getByRole('button', { name: 'Warehouse Location', exact: true }).waitFor();
  await table.waitFor();
  await page.getByLabel('Grouping 1', { exact: true }).selectOption('channel');
  await table.waitFor();
  for (const label of ['Order ref filter', 'Product or SKU filter', 'Sales channel filter', 'Location filter']) {
    if (await page.getByLabel(label, { exact: true }).count() !== 1) throw new Error(`Standard report filter is missing: ${label}`);
  }
  const filterInput = page.getByLabel('Order ref filter', { exact: true });
  await filterInput.fill('POS');
  await filterInput.press('Home');
  await filterInput.press('ArrowRight');
  if (await filterInput.evaluate(element => element.selectionStart) !== 1) throw new Error('Filter input lost native arrow-key editing.');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await table.waitFor();
  if (report.summary.cogs == null && report.summary.costedRecords > 0) {
    const capturedTotal = await page.getByTestId('cogs-total-cogs').innerText();
    if (!capturedTotal.includes('Partial') || capturedTotal.includes('Not recorded')) throw new Error('Known captured COGS is still suppressed.');
  }
  if (report.summary.netSales == null && report.summary.knownNetSales !== 0) {
    const knownSales = await page.getByTestId('cogs-total-netSales').innerText();
    if (!knownSales.includes('Partial') || knownSales.includes('Not recorded')) throw new Error('Known Net Sales is still suppressed by incomplete rows.');
  }
  await page.screenshot({ path: 'test-results/cogs-traceability/summary.png' });
  await page.getByRole('tab', { name: 'Reconciliation', exact: true }).click();
  await page.getByRole('heading', { name: 'Movement-period reconciliation' }).waitFor();
  const exportResponse = await page.request.get(`${baseUrl}/api/ims/reports/cogs-traceability/export?window=30`);
  if (!exportResponse.ok() || !(await exportResponse.text()).includes('Evidence Status')) throw new Error('CSV export did not return the full report fields.');
  const postingsResponse = await page.request.get(`${baseUrl}/api/ims/reports/cogs-traceability/postings?window=30&pageSize=10&databaseId=ignored`);
  const postings = await postingsResponse.json();
  if (!postingsResponse.ok() || !postings.success) throw new Error(`Posting ledger failed (${postingsResponse.status()}): ${postings.error || 'unknown error'}`);
  if (!postingsResponse.headers()['cache-control']?.includes('no-store')) throw new Error('Posting ledger is not private/no-store.');
  for (const period of postings.rows) {
    if (period.calculation.breakdown.some(bucket => typeof bucket.locationName !== 'string' || !bucket.locationName.trim())) throw new Error('Posting breakdown is missing location names.');
    const recordedPosted = period.runs.filter(run => run.status === 'success' && run.xeroStatus === 'POSTED' && run.xeroId).reduce((sum, run) => sum + run.amount, 0);
    if (Math.abs(recordedPosted - period.postedTotal) > .005 || Math.abs(period.calculation.totalCOGS - period.postedTotal - period.variance) > .005) throw new Error('Posting reconciliation totals disagree with run evidence.');
    for (const run of period.runs) {
      if (run.href !== (run.xeroId ? `https://go.xero.com/ManualJournals/View.aspx?manualJournalID=${encodeURIComponent(run.xeroId)}` : null)) throw new Error('Unexpected journal deep link.');
    }
  }
  await page.getByRole('tab', { name: 'Xero Postings', exact: true }).click();
  await page.getByRole('heading', { name: 'COGS journals and period reconciliations' }).waitFor();
  await page.getByRole('note').filter({ hasText: 'checked directly with Xero' }).waitFor();
  if (await page.getByLabel('Order ref filter', { exact: true }).count() || await page.getByRole('group', { name: 'Report date basis' }).count() || await page.getByRole('button', { name: 'Export CSV', exact: true }).count()) throw new Error('Sales controls still appear in the posting ledger.');
  if (postings.rows.length) {
    await page.getByRole('button', { name: /^Inspect accounting period / }).first().click();
    await page.getByRole('region', { name: 'COGS journal runs, arrow-key scrolling' }).waitFor();
    const evidence = page.getByRole('region', { name: 'Accounting period evidence' });
    for (const bucket of postings.rows[0].calculation.breakdown) {
      if (!(await evidence.innerText()).includes(`${bucket.locationName} / ${bucket.channel}`)) throw new Error('Posting evidence still displays numbered location labels instead of resolved names.');
    }
    for (const link of await page.getByRole('link', { name: 'View journal', exact: true }).all()) {
      if (await link.getAttribute('target') !== '_blank' || !((await link.getAttribute('rel')) || '').includes('noopener')) throw new Error('Journal link does not open safely.');
    }
  } else {
    await page.getByTestId('cogs-postings-empty').waitFor();
    console.log('Sandbox has no matching posting history; populated ledger scrolling and live Xero links cannot be exercised without real journals.');
  }
  await page.screenshot({ path: 'test-results/cogs-traceability/postings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('Mobile posting ledger overflows outside its table.');
  await page.screenshot({ path: 'test-results/cogs-traceability/postings-mobile.png' });
  console.log(JSON.stringify({ postingPeriods: postings.total, postingHistoryConfigured: postings.tableAvailable, liveProviderVerification: false }));
  await page.getByRole('tab', { name: 'Detail', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Detail');
  await page.locator('.cogs-traceability-table-scroll').waitFor();
  await table.evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) parent.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  if (!pageFits) throw new Error('Mobile layout overflows outside the table scroll region.');
  await page.screenshot({ path: 'test-results/cogs-traceability/mobile.png' });
  await dateFilter.getByRole('button', { name: '30 Days', exact: true }).click();
  const mobileDropdownBounds = await dateDropdown.boundingBox();
  if (!mobileDropdownBounds || mobileDropdownBounds.x < 0 || mobileDropdownBounds.x + mobileDropdownBounds.width > 390) throw new Error('Mobile date dropdown is clipped.');
  await page.screenshot({ path: 'test-results/cogs-traceability/mobile-date.png' });
  await dateFilter.getByRole('button', { name: '30 Days', exact: true }).click();
  if (await page.getByRole('tab', { name: 'Detail', exact: true }).getAttribute('aria-selected') !== 'true') throw new Error('Mobile report did not retain the selected Detail tab.');
  console.log('Authenticated report, both date bases, grouped totals, filters, evidence, CSV, desktop/mobile layout and four-arrow scrolling passed. No stock or accounting writes were requested.');
} finally {
  await browser.close();
}