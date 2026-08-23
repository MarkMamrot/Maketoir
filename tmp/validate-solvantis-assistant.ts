import 'dotenv/config';
import { chromium } from '@playwright/test';
import mysql from 'mysql2/promise';

import { signAdminSession } from '../src/lib/auth/adminSessionToken';

async function main() {
  const baseUrl = 'http://127.0.0.1:3010';
  const email = process.env.LIVE_E2E_ADMIN_EMAIL;
  const password = process.env.LIVE_E2E_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Sandbox admin credentials are not configured.');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  });
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT u.id, u.name, u.email, u.business_id, u.tier, b.name AS company
       FROM users u JOIN businesses b ON b.business_id = u.business_id
      WHERE u.email = ? AND u.deleted_at IS NULL LIMIT 1`, [email],
  );
  await connection.end();
  if (!rows[0]) throw new Error('Configured sandbox admin user was not found.');
  const user = rows[0];
  const session = signAdminSession({
    name: String(user.name ?? user.email), company: String(user.company), email: String(user.email),
    businessId: String(user.business_id), role: String(user.tier), tier: String(user.tier), userId: Number(user.id),
  }, { maxAgeSeconds: 3_600 });
  await page.context().addCookies([{ name: 'marketoir_session', value: session, url: baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${baseUrl}/ims`);
  await page.waitForURL(/\/ims(?:$|[?#])/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Open Solvantis Assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Solvantis Assistant' });
  await panel.waitFor({ state: 'visible' });
  const desktopBox = await panel.boundingBox();
  if (!desktopBox || desktopBox.x < 0 || desktopBox.y < 0 || desktopBox.x + desktopBox.width > 1440 || desktopBox.y + desktopBox.height > 900) {
    throw new Error('Desktop assistant panel is outside the viewport.');
  }
  await page.screenshot({ path: 'test-results/solvantis-assistant-desktop.png', fullPage: true });

  await page.getByLabel('Message Solvantis Assistant').fill('What is the supported workflow for receiving only part of a purchase order?');
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/ims/assistant/chat') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message' }).click();
  const response = await responsePromise;
  const payload = await response.json() as { answer?: string; citations?: unknown[] };
  if (!response.ok() || !payload.answer) throw new Error(`Assistant request failed with HTTP ${response.status()}.`);
  await page.getByText(payload.answer, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await panel.boundingBox();
  if (!mobileBox || mobileBox.x < 0 || mobileBox.y < 0 || mobileBox.x + mobileBox.width > 390 || mobileBox.y + mobileBox.height > 844) {
    throw new Error('Mobile assistant panel is outside the viewport.');
  }
  await page.screenshot({ path: 'test-results/solvantis-assistant-mobile.png', fullPage: true });
  console.log(JSON.stringify({
    desktop: desktopBox,
    mobile: mobileBox,
    answerLength: payload.answer.length,
    citationCount: Array.isArray(payload.citations) ? payload.citations.length : 0,
  }));
  } finally {
    await browser.close();
  }
}

void main();