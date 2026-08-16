import { expect, type Page } from '@playwright/test';

import type { LiveE2EConfig } from '../../../src/lib/liveE2E/safety';

export async function loginToIms(page: Page, config: LiveE2EConfig): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /IMS\s*Inventory Management/ }).click();
  await page.getByLabel('Email Address').fill(config.adminEmail);
  await page.getByLabel('Password').fill(config.adminPassword);
  const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in to IMS' }).click();
  const login = await (await loginResponse).json() as { success?: boolean; error?: string };
  expect(login.success, login.error ?? 'Login failed.').toBe(true);
  await expect(page).toHaveURL(/\/ims(?:$|[?#])/, { timeout: 15000 });
}