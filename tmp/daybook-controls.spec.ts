import 'dotenv/config';

import { expect, test } from '@playwright/test';
import { getMfaTotpState } from '../src/lib/auth/mfaRepository';
import { generateTotpCode } from '../src/lib/auth/totp';
import { UsersRepository } from '../src/lib/db/UsersRepository';

test('authenticated Daybook renders task controls and full text', async ({ page }) => {
  test.setTimeout(120_000);
  const email = process.env.LIVE_E2E_ADMIN_EMAIL;
  const password = process.env.LIVE_E2E_ADMIN_PASSWORD;
  const locationId = Number(process.env.LIVE_E2E_FIXTURE_LOCATION_ID);
  if (!email || !password || !Number.isFinite(locationId)) throw new Error('Daybook test credentials or location are missing.');

  const daybookPayloads: Array<Record<string, unknown>> = [];
  page.on('response', async response => {
    if (response.url().includes('/api/pos/daybook') && response.request().method() === 'GET' && response.ok()) {
      daybookPayloads.push(await response.json());
    }
  });

  await page.goto('/login');
  await page.getByRole('button', { name: /IMS\s*Inventory Management/ }).click();
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in to IMS' }).click();
  await page.waitForURL(/\/(?:ims|auth\/mfa\/challenge)(?:$|[?#])/, { timeout: 20_000 });
  if (page.url().includes('/auth/mfa/challenge')) {
    const user = await UsersRepository.findByEmail(email);
    if (!user) throw new Error('Configured Daybook test user was not found.');
    const mfa = await getMfaTotpState(user.id);
    if (!mfa?.secret || !mfa.enabled) throw new Error('Configured Daybook test user has no active TOTP enrollment.');
    await page.getByLabel('Authenticator code').fill(await generateTotpCode(mfa.secret));
    await expect(page.getByRole('button', { name: 'Verify and sign in' })).toBeEnabled();
    const mfaResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/mfa/challenge') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    const mfaResponse = await mfaResponsePromise;
    const mfaResult = await mfaResponse.json() as { success?: boolean; error?: string };
    expect(mfaResponse.ok(), mfaResult.error ?? 'MFA challenge failed.').toBe(true);
  }
  await expect(page).toHaveURL(/\/ims(?:$|[?#])/, { timeout: 20_000 });

  await page.getByTestId('ims-nav-__locations').click();
  await page.getByTestId('ims-nav-location-daybooks').click();
  await expect(page.getByRole('heading', { name: 'Location Daybooks' })).toBeVisible();

  const locations = await page.evaluate(async () => {
    const response = await fetch('/api/ims/locations', { cache: 'no-store' });
    const result = await response.json();
    return result.data as Array<{ id: number; name: string; city?: string }>;
  });
  const newtown = locations.find(location => location.city === 'Newtown');
  if (!newtown) throw new Error('Newtown sandbox location was not found.');
  const newtownLocation = page.getByText('Newtown, NSW', { exact: true }).locator('xpath=ancestor::button[1]');
  await expect(newtownLocation).toHaveCount(1);
  const initialDaybookPromise = page.waitForResponse(response => response.url().includes('/api/pos/daybook?') && response.ok());
  await newtownLocation.click();
  await expect(page.getByRole('heading', { name: 'Store Daybook' })).toBeVisible({ timeout: 20_000 });
  const initialDaybook = await (await initialDaybookPromise).json() as { tasks?: unknown[]; taskHistory?: unknown[] };

  const identityDialog = page.getByRole('dialog', { name: 'Who is using the Daybook?' });
  if (await identityDialog.isVisible().catch(() => false)) {
    const identityButton = identityDialog.locator('button').filter({ has: page.locator('b') }).first();
    if (await identityButton.count()) {
      await identityButton.click();
    } else {
      await identityDialog.getByLabel('Name').fill('Playwright Check');
      await identityDialog.getByLabel('Initials').fill('PW');
      await identityDialog.getByRole('button', { name: 'Continue as this staff member' }).click();
    }
  }

  if ((initialDaybook.tasks?.length ?? 0) === 0 && (initialDaybook.taskHistory?.length ?? 0) === 0) {
    const sampleTitle = 'PLAYWRIGHT SAMPLE - CASH SHEET FOR NEWTOWN: Complete every field and verify the final balance before close.';
    const samples = [
      {
        phase: 'opening',
        title: sampleTitle,
        instructions: `${sampleTitle} Record the opening float, cash movements, refunds, paid outs, EFTPOS settlement, expected cash, actual cash, and any variance. Add a clear note for every difference so the next staff member and manager can follow the calculation without relying on truncated text.`,
      },
      { phase: 'during_day', title: 'PLAYWRIGHT SAMPLE - Review store needs and customer requests', instructions: 'Confirm each request has an owner and a useful note.' },
      { phase: 'closing', title: 'PLAYWRIGHT SAMPLE - Complete closing handover', instructions: 'Record anything the opening team needs to know.' },
    ];
    await page.evaluate(async ({ locationId, samples }) => {
      for (const sample of samples) {
        const response = await fetch('/api/pos/daybook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_task',
            location_id: locationId,
            recurrence: 'daily',
            staff_name: 'Playwright Check',
            staff_initials: 'PW',
            ...sample,
          }),
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Sample task creation failed.');
      }
    }, { locationId: newtown.id, samples });

    await page.reload();
    await page.getByTestId('ims-nav-__locations').click();
    await page.getByTestId('ims-nav-location-daybooks').click();
    await page.getByText('Newtown, NSW', { exact: true }).locator('xpath=ancestor::button[1]').click();
    await expect(page.getByRole('heading', { name: 'Store Daybook' })).toBeVisible({ timeout: 20_000 });
  }

  const results: Array<Record<string, unknown>> = [];
  let cashInspection: Record<string, unknown> | null = null;
  for (const phase of ['OPEN', 'TODAY', 'CLOSE']) {
    await page.getByRole('tab', { name: new RegExp(`^${phase}\\b`) }).click();
    const table = page.getByRole('table');
    const taskRows = table.locator('tbody tr').filter({ has: page.locator('th[scope="row"]') });
    const edits = table.getByRole('button', { name: /^Edit / });
    const deletes = table.getByRole('button', { name: /^Delete / });
    const invisibleEdits: string[] = [];
    for (let index = 0; index < await edits.count(); index += 1) {
      const button = edits.nth(index);
      if (!(await button.isVisible()) || !(await button.boundingBox())) invisibleEdits.push(await button.getAttribute('aria-label') ?? `edit-${index}`);
    }
    const rowTitles = await taskRows.locator('th[scope="row"] strong').allTextContents();
    results.push({ phase, rows: await taskRows.count(), edits: await edits.count(), deletes: await deletes.count(), invisibleEdits, rowTitles });
    const cashText = page.getByText(/CASH SHEET FOR NEWTOWN/i).first();
    if (!cashInspection && await cashText.count()) {
      cashInspection = await cashText.evaluate(element => {
        const style = getComputedStyle(element);
        return {
          text: element.textContent,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          whiteSpace: style.whiteSpace,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
        };
      });
    }
  }

  const latestPayload = daybookPayloads.at(-1) as { tasks?: Array<{ can_edit?: boolean }>; taskHistory?: Array<{ is_active?: number; can_edit?: boolean }> } | undefined;
  const apiInspection = {
    currentTasks: latestPayload?.tasks?.length ?? 0,
    currentEditable: latestPayload?.tasks?.filter(task => task.can_edit).length ?? 0,
    activeHistory: latestPayload?.taskHistory?.filter(task => Number(task.is_active) === 1).length ?? 0,
    activeHistoryEditable: latestPayload?.taskHistory?.filter(task => Number(task.is_active) === 1 && task.can_edit).length ?? 0,
  };
  console.log(JSON.stringify({ results, cashInspection, apiInspection }, null, 2));

  await page.screenshot({ path: '../test-results/daybook-controls/daybook-desktop.png', fullPage: true });
  for (const result of results) {
    expect(result.edits, `${result.phase} edit count`).toBe(result.rows);
    expect(result.deletes, `${result.phase} delete count`).toBe(result.rows);
    expect(result.invisibleEdits, `${result.phase} invisible edits`).toEqual([]);
  }
  if (cashInspection) {
    expect(cashInspection.whiteSpace).toBe('normal');
    expect(cashInspection.textOverflow).toBe('clip');
    expect(cashInspection.scrollWidth).toBeLessThanOrEqual(cashInspection.clientWidth);
  }
});