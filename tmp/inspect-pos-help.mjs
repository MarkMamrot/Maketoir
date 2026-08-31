import 'dotenv/config';

import { chromium } from '@playwright/test';

const baseUrl = process.argv[2] ?? process.env.LIVE_E2E_BASE_URL ?? 'http://localhost:3000';
const email = process.env.LIVE_E2E_ADMIN_EMAIL;
const password = process.env.LIVE_E2E_ADMIN_PASSWORD;

if (!email || !password) throw new Error('LIVE_E2E_ADMIN_EMAIL and LIVE_E2E_ADMIN_PASSWORD are required.');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /IMS\s*Inventory Management/ }).click();
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in to IMS' }).click();
  const login = await (await loginResponse).json();
  if (!login.success) throw new Error(login.error ?? 'Login failed.');
  const locationsResponse = await page.request.get(`${baseUrl}/api/ims/locations`);
  const locationsBody = await locationsResponse.json();
  const location = locationsBody.data?.find(candidate => candidate.is_active && candidate.pos_location_code);
  if (!location) {
    console.log(JSON.stringify({ locations: locationsBody.data?.map(candidate => ({ name: candidate.name, active: Boolean(candidate.is_active), pos: Boolean(candidate.has_pos), hasCode: Boolean(candidate.pos_location_code) })) ?? [] }, null, 2));
    throw new Error('No active location with a POS device setup code is available.');
  }
  await page.goto(`${baseUrl}/pos`, { waitUntil: 'networkidle' });
  await page.getByLabel('Location Code').fill(location.pos_location_code);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/pos-help-preflight.png', fullPage: true });
  console.log(JSON.stringify({
    url: page.url(),
    location: location.name,
    headings: await page.getByRole('heading').allTextContents(),
    buttons: (await page.getByRole('button').allTextContents()).slice(0, 30),
  }, null, 2));
} finally {
  await browser.close();
}