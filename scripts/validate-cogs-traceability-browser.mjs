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
  const saleResponse = await page.request.get(`${baseUrl}/api/ims/reports/cogs-traceability?window=30&basis=sale`);
  if (!saleResponse.ok() || !(await saleResponse.json()).success) throw new Error('Invoice/sale-date query failed.');
  await page.goto(`${baseUrl}/ims#report-cogs-traceability`);
  await page.getByRole('heading', { name: 'Sales & COGS Traceability', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Detail', exact: true }).click();
  const table = page.locator('.cogs-traceability-table-scroll');
  await table.waitFor({ timeout: 60000 });
  if (await page.getByRole('alert').filter({ hasText: /\S/ }).count()) throw new Error('Report displays an operational error.');
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
  await page.getByLabel('Grouping 1', { exact: true }).selectOption('cogs');
  await page.getByRole('button', { name: /COGS.*\(Group\)/ }).waitFor();
  await table.waitFor();
  await page.getByLabel('Grouping 1', { exact: true }).selectOption('channel');
  await table.waitFor();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const filterInput = page.getByLabel('Filter value 1', { exact: true });
  await filterInput.fill('POS');
  await filterInput.press('Home');
  await filterInput.press('ArrowRight');
  if (await filterInput.evaluate(element => element.selectionStart) !== 1) throw new Error('Filter input lost native arrow-key editing.');
  await page.getByRole('button', { name: 'Remove filter', exact: true }).click();
  await table.waitFor();
  await page.getByRole('tab', { name: 'Reconciliation', exact: true }).click();
  await page.getByRole('heading', { name: 'Movement-period reconciliation' }).waitFor();
  const exportResponse = await page.request.get(`${baseUrl}/api/ims/reports/cogs-traceability/export?window=30`);
  if (!exportResponse.ok() || !(await exportResponse.text()).includes('Evidence Status')) throw new Error('CSV export did not return the full report fields.');
  await page.setViewportSize({ width: 390, height: 844 });
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
  if (await page.getByRole('tab', { name: 'Detail', exact: true }).getAttribute('aria-selected') !== 'true') throw new Error('Mobile report did not retain the selected Detail tab.');
  console.log('Authenticated report, both date bases, grouped totals, filters, evidence, CSV, desktop/mobile layout and four-arrow scrolling passed. No stock or accounting writes were requested.');
} finally {
  await browser.close();
}