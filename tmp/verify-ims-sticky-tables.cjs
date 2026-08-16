require('dotenv').config();
const { chromium } = require('playwright');

const routes = [
  ['Stock Levels', 'stock'],
  ['Purchase Orders', 'purchase-orders'],
  ['Sales Orders', 'sales-orders'],
  ['Stocktakes', 'stocktakes'],
  ['Locations', 'locations'],
  ['Branch Transfers', 'branch-transfers'],
  ['Contacts', 'contacts'],
  ['Backorders', 'backorders'],
  ['Customer Credit Notes', 'credit-notes'],
  ['Supplier Credit Notes', 'supplier-credit-notes'],
  ['Sales by Branch', 'report-sales-by-branch'],
  ['Sales Summary', 'report-sales-summary'],
  ['Sales Search', 'report-sales-search'],
  ['Inventory Valuation', 'report-inventory-valuation'],
  ['Product Margin', 'report-product-margin'],
  ['POS Price Changes', 'report-pos-price-changes'],
  ['POS Registers', 'report-pos-registers'],
  ['Cash Banking', 'report-cash-banking'],
];

async function ensureScrollDistance(wrapper) {
  await wrapper.evaluate(element => {
    const table = element.querySelector(':scope > table');
    if (!table) throw new Error('Sticky wrapper has no direct table child');
    let body = table.tBodies[0];
    if (!body) body = table.createTBody();
    let template = body.rows[0];
    if (!template) {
      template = body.insertRow();
      const cell = template.insertCell();
      cell.colSpan = Math.max(1, table.tHead?.rows[0]?.cells.length ?? 1);
      cell.textContent = 'Playwright scroll fixture';
      cell.style.height = '42px';
    }
    while (table.getBoundingClientRect().height < 1200) {
      body.appendChild(template.cloneNode(true));
    }
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  const results = [];
  try {
    await page.goto('http://localhost:3005/login');
    await page.getByRole('button', { name: /IMS\s*Inventory Management/ }).click();
    await page.getByLabel('Email Address').fill(process.env.LIVE_E2E_ADMIN_EMAIL);
    await page.getByLabel('Password').fill(process.env.LIVE_E2E_ADMIN_PASSWORD);
    await Promise.all([
      page.waitForURL(/\/ims(?:$|[?#])/, { timeout: 15000 }),
      page.getByRole('button', { name: 'Sign in to IMS' }).click(),
    ]);

    for (const [name, hash] of routes) {
      await page.goto(`http://localhost:3005/ims#${hash}`);
      if (hash === 'report-pos-registers') {
        const runButton = page.getByRole('button', { name: 'Run' });
        await runButton.waitFor({ state: 'visible', timeout: 20000 });
        await runButton.click();
      }

      const table = page.locator('.ims-sticky-table > table').first();
      await table.waitFor({ state: 'visible', timeout: 30000 });
      const wrapper = table.locator('xpath=..');
      const header = table.locator('thead th').first();
      await header.waitFor({ state: 'visible' });
      await ensureScrollDistance(wrapper);

      const selfScroll = await wrapper.evaluate(element => element.classList.contains('ims-sticky-table--self-scroll'));
      const position = await header.evaluate(element => getComputedStyle(element).position);
      if (position !== 'sticky') throw new Error(`${name}: computed header position is ${position}`);

      let before;
      let after;
      if (selfScroll) {
        await wrapper.evaluate(element => {
          element.style.height = '260px';
          element.style.maxHeight = '260px';
          element.style.overflow = 'auto';
          element.scrollTop = 0;
        });
        before = (await header.boundingBox()).y;
        await wrapper.evaluate(element => { element.scrollTop = 400; });
        await page.waitForTimeout(50);
        after = (await header.boundingBox()).y;
      } else {
        await page.evaluate(() => window.scrollTo(0, 0));
        const tableTop = await table.evaluate(element => element.getBoundingClientRect().top + window.scrollY);
        before = (await header.boundingBox()).y;
        await page.evaluate(top => window.scrollTo(0, top + 250), tableTop);
        await page.waitForTimeout(50);
        after = (await header.boundingBox()).y;
      }

      const passed = selfScroll ? Math.abs(after - before) <= 1 : Math.abs(after) <= 1;
      if (!passed) throw new Error(`${name}: header moved from ${before} to ${after}`);
      results.push({ name, mode: selfScroll ? 'panel' : 'page', before, after, passed });
    }

    await page.screenshot({ path: 'test-results/ims-sticky-tables-final.png', fullPage: false });
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
