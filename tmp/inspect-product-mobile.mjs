import 'dotenv/config';
import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import mysql from 'mysql2/promise';

const baseURL = 'http://localhost:3016';
const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
const [users] = await connection.execute('SELECT id, name, company, email, business_id, role, tier FROM users WHERE LOWER(email) = LOWER(?) AND deleted_at IS NULL LIMIT 1', [process.env.LIVE_E2E_ADMIN_EMAIL]);
await connection.end();
const user = users[0];
const session = { name: user.name || '', company: user.company || '', email: user.email, businessId: user.business_id || '', role: user.role || 'user', tier: user.tier, userId: user.id };
const issuedAt = Math.floor(Date.now() / 1000);
const envelope = { v: 1, iat: issuedAt, exp: issuedAt + 3600, data: session };
const signature = createHmac('sha256', process.env.AUTH_SESSION_SECRET).update(JSON.stringify(envelope)).digest('base64url');
const cookie = JSON.stringify({ ...session, __session: envelope, __signature: signature });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const writes = [];
page.on('request', request => { if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
try {
  await page.context().addCookies([{ name: 'marketoir_session', value: cookie, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${baseURL}/wholesale/preview`);
  await page.getByLabel('Buyer and buying location').waitFor();
  await page.getByRole('button', { name: /Open Layout Editor/ }).click();
  await page.waitForURL(/\/wholesale\/[^/]+\/catalogue$/);
  await page.getByRole('button', { name: 'Welcome', exact: true }).waitFor({ timeout: 15000 });
  await page.getByLabel('Page template').selectOption('product');
  await page.getByLabel('Product sample').locator('option').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);

  const canvas = page.getByRole('main', { name: /layout preview canvas/ });
  const description = canvas.locator('[class*="description"]').first();
  const variants = canvas.locator('[class*="variant"]');
  const variantOverflow = await variants.evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth));
  const result = {
    documentOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    canvasOverflow: await canvas.evaluate(element => element.scrollWidth > element.clientWidth),
    variantOverflow,
    renderedDescriptionHeading: await description.getByRole('heading').first().textContent(),
    literalHtmlVisible: await description.getByText(/<h3|<p>/).count() > 0,
    writes,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
