import { expect, type Page } from '@playwright/test';

import type { LiveE2EConfig } from '../../../src/lib/liveE2E/safety';

export async function loginToIms(page: Page, config: LiveE2EConfig): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /IMS\s*Inventory Management/ }).click();
  await page.getByLabel('Email Address').fill(config.adminEmail);
  await page.getByLabel('Password').fill(config.adminPassword);
  const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in to IMS' }).click();
  const response = await loginResponse;
  const login = await response.json() as { success?: boolean; requiresMfa?: boolean; nextRoute?: string; error?: string };
  if (login.requiresMfa || login.nextRoute?.startsWith('/auth/mfa/')) {
    throw new Error('Live E2E blocked: the configured admin account requires MFA.');
  }
  if (!response.ok() || !login.success) {
    throw new Error(`Live E2E blocked: configured admin credentials were rejected${login.error ? ` (${login.error})` : ''}.`);
  }
  await expect(page).toHaveURL(/\/ims(?:$|[?#])/, { timeout: 15000 });

  const identityResponse = await page.request.get('/api/user/me');
  const identity = await identityResponse.json().catch(() => ({})) as { businessId?: string };
  if (!identityResponse.ok() || identity.businessId !== config.expectedBusinessId) {
    throw new Error('Live E2E blocked: authenticated session resolved to the wrong business context.');
  }
}