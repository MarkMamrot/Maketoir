import { expect, test } from '@playwright/test';
import mysql from 'mysql2/promise';

import { loadLiveE2EConfig, type LiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { loadAllocationFixtureSnapshot } from './support/database-preflight';
import { appendManifestState, readManifest } from './support/manifest-store';
import { verifyLiveFifoIntegrity } from './support/fifo-database';
import { xeroApiFetch } from '../../src/services/XeroService';

test.describe.configure({ timeout: 180_000 });

async function trainingOracle(config: LiveE2EConfig, localId: string) {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  });
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const schema = connection.escapeId(config.expectedImsSchema);
    const [counts] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        (SELECT COUNT(*) FROM ${schema}.pos_sales WHERE business_id = ?) AS sales,
        (SELECT COUNT(*) FROM ${schema}.pos_sale_items item JOIN ${schema}.pos_sales sale ON sale.id = item.sale_id WHERE sale.business_id = ?) AS items,
        (SELECT COUNT(*) FROM ${schema}.pos_payments payment JOIN ${schema}.pos_sales sale ON sale.id = payment.sale_id WHERE sale.business_id = ?) AS payments,
        (SELECT COUNT(*) FROM ${schema}.ims_stock_movements WHERE business_id = ?) AS movements`,
      Array(4).fill(config.expectedBusinessId),
    );
    const [training] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, local_id, location_id, register_id, total, items_json, payments_json FROM ${schema}.pos_training_sales
        WHERE business_id = ? AND local_id = ?`, [config.expectedBusinessId, localId],
    );
    return { counts: counts[0], training };
  } finally {
    await connection.rollback();
    await connection.end();
  }
}

async function registerOracle(config: LiveE2EConfig, registerId: number) {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [registers] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, location_id, name FROM ${schema}.pos_registers WHERE id = ? AND location_id = ?`,
      [registerId, config.fixtureLocationId],
    );
    expect(registers).toHaveLength(1);
    const [sessions] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, register_id, location_id, status, opening_float, opened_at, closed_at
         FROM ${schema}.pos_register_sessions WHERE register_id = ? ORDER BY id`, [registerId],
    );
    return { registers, sessions };
  } finally {
    await connection.end();
  }
}

test('@pos-ui-audit-recovery reconciles only the recorded UI training audit without resubmitting checkout', async () => {
  const config = loadLiveE2EConfig();
  expect(['allocation', 'build-verify']).toContain(config.action);
  const events = await readManifest(config.runId);
  const state = events.at(-1)?.state;
  expect(['blocked', 'clean']).toContain(state);
  const checkpoint = events.at(-1)!.details as { scenario: string; trainingLocalId: string; trainingId: number; phase?: string };
  if (state === 'clean') expect(checkpoint.phase).toBe('existing_training_audit_verified');
  expect(checkpoint.scenario).toBe('POS UI training checkout');
  expect(checkpoint.trainingLocalId).toBeTruthy();
  expect(checkpoint.trainingId).toBeGreaterThan(0);
  const recorded = await trainingOracle(config, checkpoint.trainingLocalId);
  expect(recorded.training).toHaveLength(1);
  const audit = recorded.training[0];
  expect(Number(audit.id)).toBe(checkpoint.trainingId);
  expect(Number(audit.location_id)).toBe(config.fixtureLocationId);
  expect(Number(audit.total)).toBe(config.maxDocumentTotal);
  const parse = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
  const items = parse(audit.items_json);
  const payments = parse(audit.payments_json);
  expect(items).toHaveLength(1);
  expect(items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(items[0].qty)).toBe(1);
  expect(Number(items[0].unit_price)).toBe(config.maxDocumentTotal);
  expect(payments).toHaveLength(1);
  expect(payments[0].payment_method).toBe('Cash');
  expect(Number(payments[0].amount)).toBe(config.maxDocumentTotal);
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const marker = `LIVE E2E ${config.runId} TRAINING UI`;
    const [labelled] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, local_id FROM ${schema}.pos_training_sales WHERE business_id = ? AND notes = ?`, [config.expectedBusinessId, marker]);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toMatchObject({ id: checkpoint.trainingId, local_id: checkpoint.trainingLocalId });
    const [ordinary] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id FROM ${schema}.pos_sales WHERE business_id = ? AND local_id = ?`, [config.expectedBusinessId, checkpoint.trainingLocalId]);
    expect(ordinary).toHaveLength(0);
  } finally { await connection.end(); }
  const register = await registerOracle(config, Number(audit.register_id));
  expect(register.sessions.filter(session => session.status === 'open')).toHaveLength(0);
  expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  expect(await trainingOracle(config, checkpoint.trainingLocalId)).toEqual(recorded);
  const fifo = await verifyLiveFifoIntegrity(config);
  expect(fifo.stockQuantity).toBe(0);
  expect(fifo.layerQuantity).toBe(0);
  if (state === 'blocked') {
    await appendManifestState(config.runId, 'verification_authorized', { ...checkpoint, operation: 'Read-only exact audit recovery; no checkout replay' });
    await appendManifestState(config.runId, 'clean', { ...checkpoint, phase: 'existing_training_audit_verified', fifo,
      originalUiTestPassed: false, recoveryVerificationPassed: true, resubmitted: false,
      permanentArtifacts: ['Original labelled training audit; original UI request-capture failure retained'] });
  }
});

test.describe('Guarded POS browser requests', () => {
test.use({ serviceWorkers: 'block' });

test('@pos-request-capture intercepts a checkout-shaped request without sending it to the server', async ({ page }) => {
  const config = loadLiveE2EConfig();
  await page.goto('/login');
  let capturedLocalId: string | null = null;
  await page.route('**/api/pos/sales', async route => {
    const input = route.request().postDataJSON();
    expect(input.is_training).toBe(true);
    expect(input.payments[0].payment_method).toBe('Cash');
    capturedLocalId = input.local_id;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ captured: true }) });
  });
  const result = await page.evaluate(async localId => {
    const response = await fetch('/api/pos/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_training: true, local_id: localId, payments: [{ payment_method: 'Cash', amount: 1 }] }) });
    return response.json();
  }, `${config.runId}:capture-only`);
  expect(result).toEqual({ captured: true });
  expect(capturedLocalId).toBe(`${config.runId}:capture-only`);
});

test('@pos-ui inspects real POS setup and training screen without opening a register', async ({ page }, testInfo) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  expect((await readManifest(config.runId)).at(-1)?.state).toBe('preflight_passed');
  const inventory = await loadAllocationFixtureSnapshot(config);
  const ordinary = await trainingOracle(config, `LIVE E2E ${config.runId} UI ONLY`);
  const checkout = process.env.LIVE_E2E_POS_UI_CHECKOUT === 'training';
  let trainingLocalId: string | null = null;
  await loginToIms(page, config);
  const registersResponse = await page.request.get(`/api/pos/registers?location_id=${config.fixtureLocationId}&business_id=${encodeURIComponent(config.expectedBusinessId)}`);
  const registers = (await registersResponse.json()).registers;
  expect(registersResponse.ok()).toBe(true);
  expect(registers).toHaveLength(1);
  const registerId = Number(registers[0].id);
  const beforeRegister = await registerOracle(config, registerId);
  expect(beforeRegister.sessions.filter(session => session.status === 'open')).toHaveLength(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/pos');
  await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('combobox').first().selectOption(String(config.fixtureLocationId));
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('combobox').first().selectOption(String(registerId));
  await page.screenshot({ path: testInfo.outputPath('pos-register-setup-desktop.png'), fullPage: true });
  const overflow = async () => page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect((await overflow()).document).toBeLessThanOrEqual(1441);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('pos-register-setup-mobile.png'), fullPage: true });
  expect((await overflow()).document).toBeLessThanOrEqual(391);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Set Up Device', exact: true }).click();
  const more = page.getByTitle('More options', { exact: true });
  await expect(more).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: /Charge/ }).first()).toBeDisabled();
  await more.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Misc', exact: true }).click();
  const training = page.getByLabel(/Training Mode/);
  await training.check();
  await expect(page.getByRole('status').filter({ hasText: 'TRAINING MODE' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pos-training-settings-desktop.png'), fullPage: true });
  if (checkout) {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const inStock = page.getByRole('button', { name: 'In Stock', exact: true });
    if (await inStock.count()) await inStock.click();
    await page.getByPlaceholder('Search by name, brand or scan barcode…', { exact: true }).fill(config.fixtureSku);
    const product = page.getByText(new RegExp(` · ${config.fixtureSku}$`)).first();
    await expect(product).toBeVisible({ timeout: 30_000 });
    await product.click();
    await page.getByRole('button', { name: '$0.00', exact: true }).click();
    const price = page.locator('input:focus');
    await expect(price).toHaveValue('0');
    await price.fill(String(config.maxDocumentTotal));
    await price.press('Enter');
    await page.getByRole('button', { name: /Order Notes/ }).click();
    const marker = `LIVE E2E ${config.runId} TRAINING UI`;
    await page.getByPlaceholder('Order notes…', { exact: true }).fill(marker);
    await expect(page.getByRole('button', { name: /Charge/ }).first()).toContainText('$1.00');
    await page.getByRole('button', { name: /Charge/ }).first().click();
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await appendManifestState(config.runId, 'allocation_created', { scenario: 'POS UI training checkout', purchaseOrderIds: [], salesOrderIds: [], registerId, phase: 'before_submission' });
    await page.route('**/api/pos/sales', async route => {
      const input = route.request().postDataJSON();
      expect(input.is_training).toBe(true);
      expect(Number(input.location_id)).toBe(config.fixtureLocationId);
      expect(Number(input.total)).toBe(config.maxDocumentTotal);
      expect(input.notes).toBe(marker);
      expect(input.items).toHaveLength(1);
      expect(input.items[0].variant_id).toBe(config.fixtureVariantId);
      expect(Number(input.items[0].qty)).toBe(1);
      expect(input.payments).toHaveLength(1);
      expect(input.payments[0].payment_method).toBe('Cash');
      expect(Number(input.payments[0].amount)).toBe(config.maxDocumentTotal);
      trainingLocalId = String(input.local_id);
      await appendManifestState(config.runId, 'allocation_created', { scenario: 'POS UI training checkout', purchaseOrderIds: [], salesOrderIds: [], registerId, trainingLocalId, phase: 'exact_training_request_authorized' });
      await route.continue();
    });
    const pending = page.waitForResponse(response => response.url().endsWith('/api/pos/sales') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /Complete Sale/ }).click();
    const response = await pending;
    const result = await response.json();
    expect(response.ok(), result.error).toBe(true);
    expect(trainingLocalId, 'The pre-submit guard must capture the request before checkout can be verified.').toBeTruthy();
    expect(result.training_id).toBeGreaterThan(0);
    const recorded = await trainingOracle(config, trainingLocalId!);
    expect(recorded.counts).toEqual(ordinary.counts);
    expect(recorded.training).toHaveLength(1);
    expect(Number(recorded.training[0].id)).toBe(result.training_id);
    expect(Number(recorded.training[0].total)).toBe(config.maxDocumentTotal);
    await page.screenshot({ path: testInfo.outputPath('pos-training-checkout.png'), fullPage: true });
    await more.click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Misc', exact: true }).click();
  }
  await training.uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'TRAINING MODE' })).toHaveCount(0);
  try {
    await page.context().setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath('pos-offline-screen-desktop.png'), fullPage: true });
  } finally {
    await page.context().setOffline(false);
  }
  expect(await trainingOracle(config, `LIVE E2E ${config.runId} UI ONLY`)).toEqual(ordinary);
  expect(await loadAllocationFixtureSnapshot(config)).toEqual(inventory);
  expect(await registerOracle(config, registerId)).toEqual(beforeRegister);
  await appendManifestState(config.runId, 'allocation_created', { scenario: checkout ? 'POS UI training checkout' : 'POS UI read-only device setup', purchaseOrderIds: [], salesOrderIds: [], registerId, trainingLocalId });
  await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'POS UI read-only device setup', registerId, mutatedInventory: false });
  await appendManifestState(config.runId, 'acknowledged', { operator: 'Authorized read-only campaign verification; no transaction cleanup required' });
  await appendManifestState(config.runId, 'compensating', { scenario: 'POS UI read-only device setup', registerId, cleanup: 'No server artifacts created' });
  await appendManifestState(config.runId, 'clean', { scenario: checkout ? 'POS UI training checkout' : 'POS UI read-only device setup', registerId, trainingLocalId,
    assertions: ['Desktop/mobile setup containment', 'Real device-local Training Mode toggle and empty-cart Charge gate', 'Offline indicator without transactions', 'Ordinary sales, stock and register sessions unchanged'] });
});
});

test('@pos-offline-training keeps a simulated checkout out of the offline queue with the service worker active', async ({ page }, testInfo) => {
  const browserFailures: string[] = [];
  page.on('pageerror', error => browserFailures.push(error.message));
  page.on('requestfailed', request => browserFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  expect((await readManifest(config.runId)).at(-1)?.state).toBe('preflight_passed');
  const inventory = await loadAllocationFixtureSnapshot(config);
  const marker = `LIVE E2E ${config.runId} OFFLINE TRAINING`;
  const ordinary = await trainingOracle(config, marker);
  await loginToIms(page, config);
  const registerResponse = await page.request.get(`/api/pos/registers?location_id=${config.fixtureLocationId}&business_id=${encodeURIComponent(config.expectedBusinessId)}`);
  expect(registerResponse.ok()).toBe(true);
  const registers = (await registerResponse.json()).registers;
  expect(registers).toHaveLength(1);
  const registerId = Number(registers[0].id);
  const registerBefore = await registerOracle(config, registerId);
  expect(registerBefore.sessions.filter(session => session.status === 'open')).toHaveLength(0);
  await page.goto('/pos');
  await page.getByRole('combobox').first().selectOption(String(config.fixtureLocationId));
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('combobox').first().selectOption(String(registerId));
  await page.getByRole('button', { name: 'Set Up Device', exact: true }).click();
  const more = page.getByTitle('More options', { exact: true });
  await expect(more).toBeVisible({ timeout: 45_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const queues = () => page.evaluate(businessId => ({
    pending: localStorage.getItem(`pos_offline_queue:${businessId}`), failed: localStorage.getItem(`pos_failed_queue:${businessId}`),
  }), config.expectedBusinessId);
  const queueBefore = await queues();
  await more.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Misc', exact: true }).click();
  await page.getByLabel(/Training Mode/).check();
  await expect(page.getByRole('status').filter({ hasText: 'TRAINING MODE' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const inStock = page.getByRole('button', { name: 'In Stock', exact: true });
  if (await inStock.count()) await inStock.click();
  await page.getByPlaceholder('Search by name, brand or scan barcode…', { exact: true }).fill(config.fixtureSku);
  const product = page.getByText(new RegExp(` · ${config.fixtureSku}$`)).first();
  await expect(product).toBeVisible({ timeout: 30_000 });
  await product.click();
  await page.getByRole('button', { name: '$0.00', exact: true }).click();
  await page.locator('input:focus').fill(String(config.maxDocumentTotal));
  await page.locator('input:focus').press('Enter');
  await page.getByRole('button', { name: /Order Notes/ }).click();
  await page.getByPlaceholder('Order notes…', { exact: true }).fill(marker);
  await page.getByRole('button', { name: /Charge/ }).first().click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.evaluate(() => {
    const diagnostics: Array<{ event: string; online: boolean; time: number }> = [];
    (window as any).__offlineDiagnostics = diagnostics;
    document.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('button')?.textContent?.trim() === 'Add') diagnostics.push({ event: 'checkout-click', online: navigator.onLine, time: Date.now() });
    }, true);
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]).includes('/api/pos/sales')) diagnostics.push({ event: 'sales-fetch', online: navigator.onLine, time: Date.now() });
      return originalFetch(...args);
    };
  });
  let guardFailure: Error | null = null;
  try {
    await page.context().setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    expect(await queues()).toEqual(queueBefore);
    await expect(page.getByText('Training Mode requires an internet connection so the training audit can be recorded.', { exact: true })).toBeVisible();
    expect(await queues()).toEqual(queueBefore);
    await expect(page.getByRole('button', { name: /Complete Sale/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('service-worker-offline-training-guard.png'), fullPage: true });
  } catch (error) {
    guardFailure = error instanceof Error ? error : new Error(String(error));
    expect(await queues()).toEqual(queueBefore);
    await page.screenshot({ path: testInfo.outputPath('service-worker-offline-training-guard-failure.png'), fullPage: true });
  } finally {
    await testInfo.attach('offline-browser-diagnostics', { body: JSON.stringify({ browserFailures,
      events: await page.evaluate(() => (window as any).__offlineDiagnostics), queues: await queues() }), contentType: 'application/json' });
    await page.context().setOffline(false);
  }
  expect(await trainingOracle(config, marker)).toEqual(ordinary);
  expect(await loadAllocationFixtureSnapshot(config)).toEqual(inventory);
  expect(await registerOracle(config, registerId)).toEqual(registerBefore);
  await appendManifestState(config.runId, 'allocation_created', { scenario: 'Service-worker offline training guard', purchaseOrderIds: [], salesOrderIds: [], registerId });
  await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'Service-worker offline training guard', noSaleSubmitted: true });
  await appendManifestState(config.runId, 'acknowledged', { operator: 'Authorised non-mutating campaign verification' });
  await appendManifestState(config.runId, 'compensating', { cleanup: 'Browser-only cart discarded with isolated context; no server mutations' });
  await appendManifestState(config.runId, 'clean', { scenario: 'Service-worker offline training guard', serviceWorkerActive: true,
    guardPassed: !guardFailure, guardError: guardFailure?.message ?? null,
    queueUnchanged: true, productionCountersUnchanged: true, registerUnchanged: true });
  if (guardFailure) throw guardFailure;
});

test('@pos-register opens and closes only the isolated zero-float register session', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  expect((await readManifest(config.runId)).at(-1)?.state).toBe('preflight_passed');
  const inventory = await loadAllocationFixtureSnapshot(config);
  expect(inventory.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  const counts = await trainingOracle(config, `LIVE E2E ${config.runId} REGISTER ONLY`);
  await loginToIms(page, config);
  const identityResponse = await page.request.get(`/api/pos/auth/me?business_id=${encodeURIComponent(config.expectedBusinessId)}&location_id=${config.fixtureLocationId}`);
  const identity = await identityResponse.json();
  expect(identityResponse.ok()).toBe(true);
  expect(identity.session).toMatchObject({ businessId: config.expectedBusinessId, location_id: config.fixtureLocationId, register_id: null });
  const registersResponse = await page.request.get(`/api/pos/registers?location_id=${config.fixtureLocationId}`);
  const registers = (await registersResponse.json()).registers;
  expect(registersResponse.ok()).toBe(true);
  expect(registers).toHaveLength(1);
  const registerId = Number(registers[0].id);
  expect(Number(registers[0].location_id)).toBe(config.fixtureLocationId);
  const before = await registerOracle(config, registerId);
  expect(before.sessions.filter(session => session.status === 'open')).toHaveLength(0);
  await appendManifestState(config.runId, 'allocation_created', { scenario: 'POS register', purchaseOrderIds: [], salesOrderIds: [], registerId, beforeSessionIds: before.sessions.map(session => session.id) });
  let sessionId: number | null = null;
  try {
    const input = { register_id: registerId, location_id: config.fixtureLocationId, opening_float: 0 };
    const openedResponse = await page.request.post('/api/pos/register/open', { data: input });
    const opened = await openedResponse.json();
    expect(openedResponse.ok(), opened.error).toBe(true);
    sessionId = Number(opened.session_id);
    expect(sessionId).toBeGreaterThan(0);
    await appendManifestState(config.runId, 'awaiting_operator', { scenario: 'POS register', registerId, sessionId, openingFloat: 0 });
    const active = await registerOracle(config, registerId);
    expect(active.sessions).toHaveLength(before.sessions.length + 1);
    expect(active.sessions.at(-1)).toMatchObject({ id: sessionId, register_id: registerId, location_id: config.fixtureLocationId, status: 'open' });
    expect(Number(active.sessions.at(-1)!.opening_float)).toBe(0);
    const duplicateOpen = await page.request.post('/api/pos/register/open', { data: input });
    expect(duplicateOpen.status()).toBe(409);
    expect(await registerOracle(config, registerId)).toEqual(active);
    await appendManifestState(config.runId, 'acknowledged', { operator: 'User-authorized exact zero-float register cleanup', sessionId });
    await appendManifestState(config.runId, 'compensating', { scenario: 'POS register', registerId, sessionId });
    const closedResponse = await page.request.post('/api/pos/register/close', { data: { session_id: sessionId } });
    const closed = await closedResponse.json();
    expect(closedResponse.ok(), closed.error).toBe(true);
    const after = await registerOracle(config, registerId);
    expect(after.sessions.at(-1)).toMatchObject({ id: sessionId, status: 'closed' });
    expect(after.sessions.at(-1)!.closed_at).toBeTruthy();
    expect(after.sessions.slice(0, -1)).toEqual(before.sessions);
    const duplicateClose = await page.request.post('/api/pos/register/close', { data: { session_id: sessionId } });
    expect(duplicateClose.status()).toBe(409);
    expect(await registerOracle(config, registerId)).toEqual(after);
    expect(await trainingOracle(config, `LIVE E2E ${config.runId} REGISTER ONLY`)).toEqual(counts);
    expect(await loadAllocationFixtureSnapshot(config)).toEqual(inventory);
    await appendManifestState(config.runId, 'clean', { scenario: 'POS register', registerId, sessionId, status: 'closed', openingFloat: 0,
      permanentArtifacts: ['One closed zero-float register session; no ordinary sale/payment/stock writes'] });
  } catch (error) {
    if (sessionId) await page.request.post('/api/pos/register/close', { data: { session_id: sessionId } }).catch(() => {});
    await appendManifestState(config.runId, 'blocked', { scenario: 'POS register', registerId, sessionId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

async function posSaleOracle(config: LiveE2EConfig, localIds: string[]) {
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [sales] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, local_id, status, sale_type, total, tax_total, register_session_id, credit_note_id
         FROM ${schema}.pos_sales WHERE business_id = ? AND local_id IN (${localIds.map(() => '?').join(',')}) ORDER BY id`,
      [config.expectedBusinessId, ...localIds]);
    const [items] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT item.id, item.sale_id, item.variant_id, item.qty, item.line_total, item.return_of_sale_item_id
         FROM ${schema}.pos_sale_items item JOIN ${schema}.pos_sales sale ON sale.id = item.sale_id
        WHERE sale.business_id = ? AND sale.local_id IN (${localIds.map(() => '?').join(',')}) ORDER BY item.id`,
      [config.expectedBusinessId, ...localIds]);
    return { sales, items };
  } finally { await connection.end(); }
}

test('@pos-fifo-return @pos-costed-return completes a linked cash sale and return with sole CN restock ownership', async ({ page }) => {
  test.setTimeout(300_000);
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('build');
  expect(['fifo', 'average_cost']).toContain(config.expectedCostingMethod);
  const events = await readManifest(config.runId);
  const recoveringSale = events.at(-1)?.state === 'blocked';
  expect(['awaiting_operator', 'blocked']).toContain(events.at(-1)?.state);
  const source = events.at(-1)!.details as { scenario: string; purchaseOrderId: number; xeroBillId: string; saleId?: number; returnId?: number | null;
    capturedSaleLocalId?: string; originalOfflineUiPassed?: boolean };
  expect(source.scenario).toBe(recoveringSale ? 'POS FIFO' : 'P1');
  if (recoveringSale) {
    expect(source.saleId).toBeGreaterThan(0);
    expect(source.returnId).toBeNull();
  }
  expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: recoveringSale ? 0 : 1, qtyIncoming: 0, qtyCommitted: 0 });
  const surface = process.env.LIVE_E2E_POS_SURFACE ?? 'api';
  expect(['api', 'offline-ui']).toContain(surface);
  expect(!recoveringSale || surface === 'api').toBe(true);
  let saleLocalId = source.capturedSaleLocalId ?? `LIVE E2E ${config.runId} POS SALE`;
  const returnLocalId = `LIVE E2E ${config.runId} POS RETURN`;
  const existing = await posSaleOracle(config, [saleLocalId, returnLocalId]);
  expect(existing.sales).toHaveLength(recoveringSale ? 1 : 0);
  if (recoveringSale) {
    expect(existing.sales[0].local_id).toBe(saleLocalId);
    expect(Number(existing.sales[0].id)).toBe(source.saleId);
    expect(existing.sales[0].status).toBe('completed');
    expect(existing.items).toHaveLength(1);
    expect(existing.items[0].variant_id).toBe(config.fixtureVariantId);
    expect(Number(existing.items[0].qty)).toBe(1);
    expect(Number(existing.sales[0].total)).toBe(1);
  }
  await loginToIms(page, config);
  const identityResponse = await page.request.get(`/api/pos/auth/me?business_id=${encodeURIComponent(config.expectedBusinessId)}&location_id=${config.fixtureLocationId}`);
  const identity = await identityResponse.json();
  expect(identityResponse.ok()).toBe(true);
  expect(identity.session).toMatchObject({ businessId: config.expectedBusinessId, location_id: config.fixtureLocationId });
  const poResponse = await page.request.get(`/api/ims/purchase-orders/${source.purchaseOrderId}`);
  const po = (await poResponse.json()).data;
  expect(poResponse.ok()).toBe(true);
  expect(po).toMatchObject({ status: 'complete', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, tax_treatment: 'no_tax' });
  expect(po.notes).toContain(`LIVE E2E ${config.runId} P1`);
  expect(Number(po.total_amount)).toBe(1);
  expect(po.items).toHaveLength(1);
  expect(po.items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(po.items[0].qty_received)).toBe(1);
  const registersResponse = await page.request.get(`/api/pos/registers?location_id=${config.fixtureLocationId}`);
  const registers = (await registersResponse.json()).registers;
  expect(registersResponse.ok()).toBe(true);
  expect(registers).toHaveLength(1);
  const registerId = Number(registers[0].id);
  expect((await registerOracle(config, registerId)).sessions.filter(session => session.status === 'open')).toHaveLength(0);
  if (recoveringSale) await appendManifestState(config.runId, 'allocation_created', { scenario: 'POS FIFO', purchaseOrderIds: [], salesOrderIds: [], phase: 'exact_sale_recovery_verified', saleId: source.saleId });
  let sessionId: number | null = null;
  let saleId: number | null = null;
  let returnId: number | null = null;
  let supplierCreditNoteId: number | null = null;
  const command = async (endpoint: string, data: unknown) => {
    const response = await page.request.post(endpoint, { data });
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    expect(body.success, body.error).toBe(true);
    expect(body.stockWarning).toBeUndefined();
    return body;
  };
  try {
    sessionId = Number((await command('/api/pos/register/open', { register_id: registerId, location_id: config.fixtureLocationId, opening_float: 0 })).session_id);
    expect(sessionId).toBeGreaterThan(0);
    await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'register_opened', registerId, sessionId });
    let sale: any = { local_id: saleLocalId, register_id: registerId, register_session_id: sessionId, location_id: config.fixtureLocationId,
      sale_type: 'sale', status: 'completed', subtotal: 1 / 1.1, discount_total: 0, tax_total: 1 - 1 / 1.1, total: 1, notes: saleLocalId,
      items: [{ variant_id: config.fixtureVariantId, code: config.fixtureSku, name: saleLocalId, qty: 1, unit_price: 1, line_total: 1, tax_rate: 10, discount_type: 'none', discount_value: 0, discount_amount: 0 }],
      payments: [{ payment_method: 'Cash', amount: 1 }] };
    if (recoveringSale) {
      saleId = Number(source.saleId);
    } else if (surface === 'offline-ui') {
      await page.goto('/pos');
      await page.getByRole('combobox').first().selectOption(String(config.fixtureLocationId));
      await page.getByRole('button', { name: /Next/i }).click();
      await page.getByRole('combobox').first().selectOption(String(registerId));
      await page.getByRole('button', { name: 'Set Up Device', exact: true }).click();
      const continueSession = page.getByRole('button', { name: 'Continue Session', exact: true });
      const more = page.getByTitle('More options', { exact: true });
      await expect(more.or(continueSession)).toBeVisible({ timeout: 45_000 });
      if (await continueSession.isVisible()) await continueSession.click();
      await expect(more).toBeVisible({ timeout: 45_000 });
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await expect(page.getByRole('status').filter({ hasText: 'TRAINING MODE' })).toHaveCount(0);
      const queue = () => page.evaluate(businessId => JSON.parse(localStorage.getItem(`pos_offline_queue:${businessId}`) ?? '[]'), config.expectedBusinessId);
      expect(await queue()).toEqual([]);
      await page.getByPlaceholder('Search by name, brand or scan barcode…', { exact: true }).fill(config.fixtureSku);
      const product = page.getByText(new RegExp(` · ${config.fixtureSku}$`)).first();
      await expect(product).toBeVisible({ timeout: 30_000 });
      await product.click();
      await page.getByRole('button', { name: '$0.00', exact: true }).click();
      await page.locator('input:focus').fill('1');
      await page.locator('input:focus').press('Enter');
      await page.getByRole('button', { name: /Order Notes/ }).click();
      await page.getByPlaceholder('Order notes…', { exact: true }).fill(saleLocalId);
      await expect(page.getByRole('button', { name: /Charge/ }).first()).toBeEnabled();
      await page.getByRole('button', { name: /Charge/ }).first().click();
      await page.getByRole('button', { name: 'Cash', exact: true }).click();
      await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'before_offline_ui_checkout',
        registerId, sessionId, saleId, saleMarker: saleLocalId, serviceWorkerActive: true });
      try {
        await page.context().setOffline(true);
        await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect.poll(async () => (await queue()).length, { timeout: 10_000 }).toBe(1);
        sale = (await queue())[0].payload;
        expect(sale.is_training).toBe(false);
        expect(sale.notes).toBe(saleLocalId);
        expect(Number(sale.location_id)).toBe(config.fixtureLocationId);
        expect(Number(sale.register_id)).toBe(registerId);
        expect(Number(sale.total)).toBe(1);
        expect(sale.items).toHaveLength(1);
        expect(sale.items[0].variant_id).toBe(config.fixtureVariantId);
        expect(Number(sale.items[0].qty)).toBe(1);
        expect(sale.payments).toHaveLength(1);
        expect(sale.payments[0].payment_method).toBe('Cash');
        saleLocalId = String(sale.local_id);
        expect((await posSaleOracle(config, [saleLocalId])).sales).toHaveLength(0);
        await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'exact_offline_sale_queued',
          registerId, sessionId, saleId, saleLocalId, returnLocalId });
      } finally { await page.context().setOffline(false); }
      await expect.poll(async () => {
        if (await continueSession.isVisible()) {
          await continueSession.click();
          await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'reconnect_register_session_continued',
            registerId, sessionId, saleLocalId, returnLocalId });
        }
        const recorded = await posSaleOracle(config, [saleLocalId]);
        saleId = recorded.sales.length === 1 ? Number(recorded.sales[0].id) : null;
        return saleId;
      }, { timeout: 45_000 }).not.toBeNull();
      try {
        await expect.poll(async () => (await queue()).length, { timeout: 45_000 }).toBe(0);
      } finally {
        await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'offline_queue_clearance_observed',
          registerId, sessionId, saleId, saleLocalId, returnLocalId,
          pending: (await queue()).map((entry: any) => ({ localId: entry.payload.local_id, attempts: entry.attempts, lastError: entry.last_error ?? null })) });
      }
    } else {
      saleId = Number((await command('/api/pos/sales', sale)).id);
    }
    expect(saleId).toBeGreaterThan(0);
    await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'sale_completed', registerId, sessionId, saleId, saleLocalId, returnLocalId });
    const sold = await posSaleOracle(config, [saleLocalId, returnLocalId]);
    expect(sold.sales).toHaveLength(1);
    expect(sold.items).toHaveLength(1);
    const saleMovements = (await loadAllocationFixtureSnapshot(config)).movements.filter(row => Number(row.reference_id) === saleId && row.reference_type === 'pos_sale');
    expect(saleMovements).toHaveLength(1);
    expect(Number(saleMovements[0].unit_cost)).toBe(1);
    expect(saleMovements[0].cost_method_snapshot).toBe(config.expectedCostingMethod);
    if (config.expectedCostingMethod === 'fifo') expect((await verifyLiveFifoIntegrity(config)).layerQuantity).toBe(0);
    if (!recoveringSale) expect(Number((await command('/api/pos/sales', sale)).id)).toBe(saleId);
    expect(await posSaleOracle(config, [saleLocalId, returnLocalId])).toEqual(sold);
    const returned = { ...sale, local_id: returnLocalId, notes: returnLocalId, sale_type: 'return', return_of_sale_id: saleId,
      subtotal: -1 / 1.1, tax_total: -(1 - 1 / 1.1), total: -1,
      items: [{ ...sale.items[0], qty: -1, line_total: -1, return_of_sale_item_id: Number(sold.items[0].id) }], payments: [{ payment_method: 'Cash', amount: -1 }] };
    const result = await command('/api/pos/sales', returned);
    returnId = Number(result.id);
    expect(Number(result.credit_note_id)).toBeGreaterThan(0);
    await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'return_completed', registerId, sessionId, saleId, returnId, creditNoteId: result.credit_note_id, saleLocalId, returnLocalId });
    const restored = await posSaleOracle(config, [saleLocalId, returnLocalId]);
    expect(restored.sales).toHaveLength(2);
    expect(restored.items).toHaveLength(2);
    const returnMovements = (await loadAllocationFixtureSnapshot(config)).movements.filter(row => Number(row.reference_id) === Number(result.credit_note_id) && row.reference_type === 'credit_note');
    expect(returnMovements).toHaveLength(1);
    expect(Number(returnMovements[0].unit_cost)).toBe(1);
    expect(Number(returnMovements[0].qty_change)).toBe(1);
    expect(returnMovements[0].cost_method_snapshot).toBe(config.expectedCostingMethod);
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 1, qtyIncoming: 0, qtyCommitted: 0 });
    if (config.expectedCostingMethod === 'fifo') expect((await verifyLiveFifoIntegrity(config)).layerQuantity).toBe(1);
    const replay = await command('/api/pos/sales', returned);
    expect(Number(replay.id)).toBe(returnId);
    expect(replay.credit_note_id).toBe(result.credit_note_id);
    expect(await posSaleOracle(config, [saleLocalId, returnLocalId])).toEqual(restored);
    const excess = await page.request.post('/api/pos/sales', { data: { ...returned, local_id: `${returnLocalId}:excess` } });
    expect(excess.status()).toBe(400);
    expect((await posSaleOracle(config, [`${returnLocalId}:excess`])).sales).toHaveLength(0);
    const created = await command('/api/ims/supplier-credit-notes', { po_id: source.purchaseOrderId, supplier_id: config.fixtureSupplierId,
      location_id: config.fixtureLocationId, scn_date: new Date().toISOString().slice(0, 10), tax_treatment: 'no_tax', notes: `LIVE E2E ${config.runId} POS RESTORED UNIT RETURN`,
      items: [{ variant_id: config.fixtureVariantId, source_po_item_id: Number(po.items[0].id), qty: 1, unit_cost: 1, tax_rate: 0, restock: true }] });
    supplierCreditNoteId = Number(created.data.id);
    await appendManifestState(config.runId, 'awaiting_operator', { ...source, scenario: 'POS FIFO', phase: 'supplier_return_draft', registerId, sessionId, saleId, returnId, supplierCreditNoteId });
    await appendManifestState(config.runId, 'acknowledged', { operator: 'User-authorized exact POS stock cleanup', supplierCreditNoteId });
    await appendManifestState(config.runId, 'compensating', { scenario: 'POS FIFO', registerId, sessionId, supplierCreditNoteId });
    await command(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, { operationKey: `${config.runId}:supplier-return` });
    await command('/api/pos/register/close', { session_id: sessionId });
    expect((await registerOracle(config, registerId)).sessions.filter(session => session.status === 'open')).toHaveLength(0);
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
    const fifo = config.expectedCostingMethod === 'fifo' ? await verifyLiveFifoIntegrity(config) : null;
    if (fifo) expect(fifo.layerQuantity).toBe(0);
    await appendManifestState(config.runId, 'clean', { ...source, scenario: 'POS FIFO', registerId, sessionId, saleId, returnId, supplierCreditNoteId, fifo,
      costingMethod: config.expectedCostingMethod,
      surface, offlineCheckoutPassed: surface === 'offline-ui',
      recoveredExistingSaleWithoutResubmission: recoveringSale,
      permanentArtifacts: ['Cash sale and linked cash refund with sole completed CN restock', 'Completed PO and supplier return', 'Closed zero-float register session'] });
  } catch (error) {
    if (sessionId) await page.request.post('/api/pos/register/close', { data: { session_id: sessionId } }).catch(() => {});
    await appendManifestState(config.runId, 'blocked', { ...source, scenario: 'POS FIFO', registerId, sessionId, saleId, returnId, supplierCreditNoteId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

test('@pos-build-sale atomically builds and sells one output with original-cost return and exact cleanup', async ({ page }) => {
  test.setTimeout(300_000);
  const config = loadLiveE2EConfig();
  const buildSurface = process.env.LIVE_E2E_POS_BUILD_SURFACE ?? 'api';
  expect(['api', 'ui']).toContain(buildSurface);
  expect(config.action).toBe('build');
  expect(['fifo', 'average_cost']).toContain(config.expectedCostingMethod);
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('awaiting_operator');
  const source = events.at(-1)!.details as any;
  expect(source.scenario).toBe('P1');
  expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 1, qtyIncoming: 0, qtyCommitted: 0 });
  await loginToIms(page, config);
  const identityResponse = await page.request.get(`/api/pos/auth/me?business_id=${encodeURIComponent(config.expectedBusinessId)}&location_id=${config.fixtureLocationId}`);
  expect(identityResponse.ok()).toBe(true);
  expect((await identityResponse.json()).session).toMatchObject({ businessId: config.expectedBusinessId, location_id: config.fixtureLocationId });
  const poResponse = await page.request.get(`/api/ims/purchase-orders/${source.purchaseOrderId}`);
  expect(poResponse.ok()).toBe(true);
  const po = (await poResponse.json()).data;
  expect(po).toMatchObject({ status: 'complete', supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId,
    tax_treatment: 'no_tax', xero_bill_id: source.xeroBillId });
  expect(po.notes).toContain(`LIVE E2E ${config.runId} P1`);
  expect(Number(po.total_amount)).toBe(1);
  expect(po.items).toHaveLength(1);
  expect(po.items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(po.items[0].qty_received)).toBe(1);
  const command = async (endpoint: string, data: unknown, method: 'post' | 'put' = 'post') => {
    const response = await page.request[method](endpoint, { data });
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    expect(body.success, body.error).toBe(true);
    return body;
  };
  const settingsResponse = await page.request.get('/api/ims/settings');
  expect(settingsResponse.ok()).toBe(true);
  const policyKey = `build_from_sale_location:${config.fixtureLocationId}`;
  const originalBuildPolicy = (await settingsResponse.json()).data[policyKey] ?? 'inherit';
  const policyEndpoint = `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`;
  const policyResponse = await page.request.get(policyEndpoint);
  expect(policyResponse.ok()).toBe(true);
  const originalXeroPolicy = (await policyResponse.json()).policy;
  expect(originalXeroPolicy).toBeDefined();
  let outputProductId: string | null = null;
  let outputVariantId: string | null = null;
  let registerId: number | null = null;
  let sessionId: number | null = null;
  let saleId: number | null = null;
  let returnId: number | null = null;
  let supplierCreditNoteId: number | null = null;
  let saleLocalId = `LIVE E2E ${config.runId} BUILD POS SALE`;
  const returnLocalId = `LIVE E2E ${config.runId} BUILD POS RETURN`;
  const checkpoint = (phase: string) => appendManifestState(config.runId, 'awaiting_operator', {
    ...source, scenario: 'POS sale build', phase, outputProductId, outputVariantId, registerId, sessionId, saleId, returnId,
    supplierCreditNoteId, saleLocalId, returnLocalId, originalBuildPolicy, originalXeroPolicy,
  });
  const outputSnapshot = async () => {
    const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
    try {
      const schema = connection.escapeId(config.expectedImsSchema);
      const [stock] = await connection.query<mysql.RowDataPacket[]>(`SELECT qty_on_hand,qty_incoming,qty_committed FROM ${schema}.ims_stock
        WHERE business_id=? AND variant_id=? AND location_id=?`, [config.expectedBusinessId, outputVariantId, config.fixtureLocationId]);
      const [builds] = await connection.query<mysql.RowDataPacket[]>(`SELECT id,batch_id,quantity_built,output_unit_cost FROM ${schema}.ims_product_build_items
        WHERE business_id=? AND output_variant_id=? ORDER BY id`, [config.expectedBusinessId, outputVariantId]);
      const [movements] = await connection.query<mysql.RowDataPacket[]>(`SELECT id,qty_change,unit_cost,reference_type,reference_id,cost_method_snapshot
        FROM ${schema}.ims_stock_movements WHERE business_id=? AND variant_id=? ORDER BY id`, [config.expectedBusinessId, outputVariantId]);
      return { stock, builds, movements };
    } finally { await connection.end(); }
  };
  try {
    const sku = `E2E-POS-BUILD-${config.runId}`;
    outputProductId = (await command('/api/ims/products', { name: `LIVE E2E ${config.runId} POS BUILD OUTPUT`, base_sku: sku,
      is_active: 1, is_online: 0, is_stock_item: 1, uses_builds: 1 })).product_id;
    await checkpoint('output_product_created');
    outputVariantId = (await command('/api/ims/variants', { product_id: outputProductId, sku, is_active: 1, cost_aud: 0, price_rrp: 1 })).variant_id;
    await checkpoint('output_variant_created');
    const recipe = { outputVariantId, components: [{ variantId: config.fixtureVariantId, quantityPerOutput: 1 }],
      baseOutputQuantity: 1, overheadPerOutput: 0, notes: `LIVE E2E ${config.runId} POS BUILD RECIPE`, isEnabled: true };
    expect((await command(`/api/ims/products/${outputProductId}/build-recipes`, recipe, 'put')).data.revision).toBe(1);
    await checkpoint('recipe_created');
    await command('/api/ims/settings', { key: policyKey, value: 'enabled' }, 'put');
    const registersResponse = await page.request.get(`/api/pos/registers?location_id=${config.fixtureLocationId}`);
    expect(registersResponse.ok()).toBe(true);
    const registers = (await registersResponse.json()).registers;
    expect(registers).toHaveLength(1);
    registerId = Number(registers[0].id);
    expect((await registerOracle(config, registerId)).sessions.filter(session => session.status === 'open')).toHaveLength(0);
    sessionId = Number((await command('/api/pos/register/open', { register_id: registerId, location_id: config.fixtureLocationId, opening_float: 0 })).session_id);
    await checkpoint('register_opened');
    const items = [{ variant_id: outputVariantId, code: sku, name: `LIVE E2E ${config.runId} POS BUILD OUTPUT`, qty: 1,
      unit_price: 1, line_total: 1, tax_rate: 10, discount_type: 'none', discount_value: 0, discount_amount: 0 }];
    const preview = await command('/api/pos/build-preview', { location_id: config.fixtureLocationId, items });
    expect(preview.buildable).toBe(true);
    expect(preview.preview.builds).toHaveLength(1);
    expect(preview.preview.builds[0].outputVariantId).toBe(outputVariantId);
    expect(Number(preview.preview.builds[0].outputUnitCost)).toBe(1);
    let sale: any = { local_id: saleLocalId, register_id: registerId, register_session_id: sessionId, location_id: config.fixtureLocationId,
      sale_type: 'sale', status: 'completed', subtotal: 1 / 1.1, discount_total: 0, tax_total: 1 - 1 / 1.1, total: 1,
      notes: saleLocalId, items, payments: [{ payment_method: 'Cash', amount: 1 }],
      build_consent: { operation_key: `${config.runId}:pos:build`, builds: [{ output_variant_id: outputVariantId, quantity: 1, recipe_revision: 1 }] } };
    await checkpoint('before_atomic_build_sale');
    if (buildSurface === 'ui') {
      await page.goto('/pos');
      await page.getByRole('combobox').first().selectOption(String(config.fixtureLocationId));
      await page.getByRole('button', { name: /Next/i }).click();
      await page.getByRole('combobox').first().selectOption(String(registerId));
      await page.getByRole('button', { name: 'Set Up Device', exact: true }).click();
      const continueSession = page.getByRole('button', { name: 'Continue Session', exact: true });
      const more = page.getByTitle('More options', { exact: true });
      await expect(more.or(continueSession)).toBeVisible({ timeout: 45_000 });
      if (await continueSession.isVisible()) await continueSession.click();
      await expect(more).toBeVisible({ timeout: 45_000 });
      await expect(page.getByRole('status').filter({ hasText: 'TRAINING MODE' })).toHaveCount(0);
      const inStock = page.getByRole('button', { name: 'In Stock', exact: true });
      if (await inStock.count()) await inStock.click();
      await page.getByPlaceholder('Search by name, brand or scan barcode…', { exact: true }).fill(sku);
      const product = page.getByText(sku, { exact: true }).first();
      await expect.poll(async () => {
        if (await continueSession.isVisible()) {
          await continueSession.click();
          await page.getByPlaceholder('Search by name, brand or scan barcode…', { exact: true }).fill(sku);
        }
        return product.isVisible();
      }, { timeout: 30_000 }).toBe(true);
      await product.click();
      await page.getByRole('button', { name: /Order Notes/ }).click();
      await page.getByPlaceholder('Order notes…', { exact: true }).fill(saleLocalId);
      await page.getByRole('button', { name: /Charge/ }).first().click();
      await page.getByRole('button', { name: 'Cash', exact: true }).click();
      const unbuilt = await outputSnapshot();
      const componentBefore = await loadAllocationFixtureSnapshot(config);
      let cancelledMessage = '';
      page.once('dialog', async dialog => { cancelledMessage = dialog.message(); await dialog.dismiss(); });
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect.poll(() => cancelledMessage).toContain('Build stock and complete this sale?');
      expect(cancelledMessage).toContain('build 1 at $1.00 each');
      expect(await outputSnapshot()).toEqual(unbuilt);
      expect(await loadAllocationFixtureSnapshot(config)).toEqual(componentBefore);
      expect((await posSaleOracle(config, [saleLocalId])).sales).toHaveLength(0);
      await checkpoint('ui_build_cancelled_without_mutation');
      const completeButton = page.getByRole('button', { name: /Complete Sale/ });
      await expect(completeButton.or(continueSession)).toBeVisible({ timeout: 15_000 });
      if (await continueSession.isVisible()) {
        await continueSession.click();
        await expect(more).toBeVisible();
        await page.getByRole('button', { name: /Charge/ }).first().click();
        await page.getByRole('button', { name: 'Cash', exact: true }).click();
      }
      let acceptedMessage = '';
      page.once('dialog', async dialog => { acceptedMessage = dialog.message(); await dialog.accept(); });
      const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/pos/sales' && response.request().method() === 'POST', { timeout: 60_000 });
      await (await completeButton.isVisible() ? completeButton : page.getByRole('button', { name: 'Add', exact: true })).click({ timeout: 15_000 });
      const response = await savedResponse;
      sale = response.request().postDataJSON();
      saleLocalId = String(sale.local_id);
      const saved = await response.json();
      saleId = Number(saved.id);
      await checkpoint('ui_build_sale_response_captured');
      expect(response.ok(), saved.error).toBe(true);
      expect(saved.success, saved.error).toBe(true);
      expect(acceptedMessage).toContain('Build stock and complete this sale?');
      expect(acceptedMessage).toContain('build 1 at $1.00 each');
      expect(Number(sale.total)).toBe(1);
      expect(sale.items).toHaveLength(1);
      expect(sale.items[0].variant_id).toBe(outputVariantId);
      expect(Number(sale.items[0].qty)).toBe(1);
      expect(sale.build_consent.builds).toEqual([{ output_variant_id: outputVariantId, quantity: 1, recipe_revision: 1 }]);
    } else {
      saleId = Number((await command('/api/pos/sales', sale)).id);
    }
    await checkpoint('atomic_build_sale_completed');
    const sold = await posSaleOracle(config, [saleLocalId, returnLocalId]);
    expect(sold.sales).toHaveLength(1);
    expect(sold.items).toHaveLength(1);
    const built = await outputSnapshot();
    expect(built.builds).toHaveLength(1);
    expect(Number(built.builds[0].quantity_built)).toBe(1);
    expect(Number(built.builds[0].output_unit_cost)).toBe(1);
    expect(built.stock.map(row => [row.qty_on_hand, row.qty_incoming, row.qty_committed].map(Number))).toEqual([[0, 0, 0]]);
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
    const consumed = built.movements.filter(row => row.reference_type === 'pos_sale' && Number(row.reference_id) === saleId);
    expect(consumed).toHaveLength(1);
    expect(Number(consumed[0].unit_cost)).toBe(1);
    expect(consumed[0].cost_method_snapshot).toBe(config.expectedCostingMethod);
    expect(Number((await command('/api/pos/sales', sale)).id)).toBe(saleId);
    expect(await outputSnapshot()).toEqual(built);
    const returned = { ...sale, local_id: returnLocalId, build_consent: undefined, notes: returnLocalId, sale_type: 'return', return_of_sale_id: saleId,
      subtotal: -1 / 1.1, tax_total: -(1 - 1 / 1.1), total: -1,
      items: [{ ...items[0], qty: -1, line_total: -1, return_of_sale_item_id: Number(sold.items[0].id) }], payments: [{ payment_method: 'Cash', amount: -1 }] };
    const refund = await command('/api/pos/sales', returned);
    returnId = Number(refund.id);
    expect(Number(refund.credit_note_id)).toBeGreaterThan(0);
    await checkpoint('built_output_returned');
    const restored = await outputSnapshot();
    expect(Number(restored.stock[0].qty_on_hand)).toBe(1);
    const returnMovement = restored.movements.filter(row => row.reference_type === 'credit_note' && Number(row.reference_id) === Number(refund.credit_note_id));
    expect(returnMovement).toHaveLength(1);
    expect(Number(returnMovement[0].unit_cost)).toBe(1);
    expect(Number((await command('/api/pos/sales', returned)).id)).toBe(returnId);
    expect(await outputSnapshot()).toEqual(restored);
    supplierCreditNoteId = Number((await command('/api/ims/supplier-credit-notes', { supplier_id: config.fixtureSupplierId,
      location_id: config.fixtureLocationId, scn_date: new Date().toISOString().slice(0, 10), tax_treatment: 'no_tax', currency_code: 'AUD',
      notes: `LIVE E2E ${config.runId} BUILT OUTPUT CLEANUP`, items: [{ variant_id: outputVariantId, qty: 1, unit_cost: 1, tax_rate: 0, restock: true }] })).data.id);
    await checkpoint('output_cleanup_draft');
    await command('/api/xero/document-policies', { databaseId: config.expectedBusinessId, policy: { ...originalXeroPolicy, supplierCreditNoteAction: 'draft' } }, 'put');
    const completion = { operationKey: `${config.runId}:built-output:return` };
    await command(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, completion);
    const cleaned = await outputSnapshot();
    expect(Number(cleaned.stock[0].qty_on_hand)).toBe(0);
    await command(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/complete`, completion);
    expect(await outputSnapshot()).toEqual(cleaned);
    let xeroCreditId: string | null = null;
    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/supplier-credit-notes/${supplierCreditNoteId}/xero-status`);
      const body = await response.json();
      xeroCreditId = body.latest?.status === 'success' ? body.latest.xero_id : null;
      return xeroCreditId;
    }, { timeout: 60_000 }).not.toBeNull();
    const credit = await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${xeroCreditId}`, { method: 'GET' });
    expect(Number(credit.CreditNotes[0].Total)).toBe(1);
    expect(Number(credit.CreditNotes[0].TotalTax)).toBe(0);
    const bill = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${source.xeroBillId}`, { method: 'GET' });
    expect(Number(bill.Invoices[0].Total)).toBe(1);
    await command(`/api/ims/products/${outputProductId}/build-recipes`, { ...recipe, isEnabled: false, expectedRevision: 1 }, 'put');
    await command(`/api/ims/products/${outputProductId}`, { is_active: 0 }, 'put');
    await command('/api/pos/register/close', { session_id: sessionId });
    expect((await registerOracle(config, registerId!)).sessions.filter(session => session.status === 'open')).toHaveLength(0);
    await checkpoint('verified_and_cleaned');
    await appendManifestState(config.runId, 'acknowledged', { operator: 'Authorised exact POS build fixture cleanup verified' });
    await appendManifestState(config.runId, 'compensating', { cleanup: 'Output supplier return complete; register closed; recipe disabled' });
    await appendManifestState(config.runId, 'clean', { ...source, scenario: 'POS sale build', outputProductId, outputVariantId, saleId, returnId,
      supplierCreditNoteId, xeroCreditId, registerId, sessionId, buildSurface, posBuildPassed: true,
      costingMethod: config.expectedCostingMethod,
      uiConsentPassed: buildSurface === 'ui', originalCostReturnPassed: true, replayPassed: true });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { ...source, scenario: 'POS sale build', outputProductId, outputVariantId, registerId, sessionId,
      saleId, returnId, supplierCreditNoteId, saleLocalId, returnLocalId, originalBuildPolicy, originalXeroPolicy,
      error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    if (sessionId) await page.request.post('/api/pos/register/close', { data: { session_id: sessionId } });
    await command('/api/ims/settings', { key: policyKey, value: originalBuildPolicy }, 'put');
    await command('/api/xero/document-policies', { databaseId: config.expectedBusinessId, policy: originalXeroPolicy }, 'put');
    expect((await (await page.request.get('/api/ims/settings')).json()).data[policyKey] ?? 'inherit').toBe(originalBuildPolicy);
    expect((await (await page.request.get(policyEndpoint)).json()).policy).toEqual(originalXeroPolicy);
  }
});

test('@pos-training verifies simulated-sale persistence, replay and prohibited tenders without production writes', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  expect((await readManifest(config.runId)).at(-1)?.state).toBe('preflight_passed');
  const localId = `LIVE E2E ${config.runId} POS TRAINING`;
  const before = await trainingOracle(config, localId);
  expect(before.training).toHaveLength(0);
  const inventory = await loadAllocationFixtureSnapshot(config);
  expect(inventory.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  await loginToIms(page, config);
  const identityResponse = await page.request.get(`/api/pos/auth/me?business_id=${encodeURIComponent(config.expectedBusinessId)}&location_id=${config.fixtureLocationId}`);
  const identity = await identityResponse.json();
  expect(identityResponse.ok()).toBe(true);
  expect(identity.session).toMatchObject({ businessId: config.expectedBusinessId, location_id: config.fixtureLocationId, register_id: null });
  await appendManifestState(config.runId, 'allocation_created', {
    scenario: 'POS training', purchaseOrderIds: [], salesOrderIds: [], localId, beforeCounts: before.counts,
  });
  const body = {
    local_id: localId, is_training: true, location_id: config.fixtureLocationId, register_id: null,
    sale_type: 'sale', status: 'completed', subtotal: config.maxDocumentTotal / 1.1,
    tax_total: config.maxDocumentTotal - config.maxDocumentTotal / 1.1, total: config.maxDocumentTotal,
    notes: localId, items: [{ variant_id: config.fixtureVariantId, code: config.fixtureSku, name: 'LIVE E2E simulated fixture', qty: 1,
      unit_price: config.maxDocumentTotal, line_total: config.maxDocumentTotal, tax_rate: 10 }],
    payments: [{ payment_method: 'Cash', amount: config.maxDocumentTotal }],
  };
  const response = await page.request.post('/api/pos/sales', { data: body });
  const result = await response.json();
  expect(response.ok(), result.error).toBe(true);
  expect(result).toMatchObject({ success: true, training: true });
  expect(Number(result.training_id)).toBeGreaterThan(0);
  const saved = await trainingOracle(config, localId);
  expect(saved.counts).toEqual(before.counts);
  expect(saved.training).toHaveLength(1);
  expect(Number(saved.training[0].total)).toBe(config.maxDocumentTotal);
  expect(Number(saved.training[0].location_id)).toBe(config.fixtureLocationId);
  const replayResponse = await page.request.post('/api/pos/sales', { data: body });
  expect(replayResponse.ok()).toBe(true);
  expect((await replayResponse.json()).training_id).toBe(result.training_id);
  for (const change of [
    { sale_type: 'return' }, { sale_type: 'layby', status: 'layby_active' },
    { payments: [{ payment_method: 'Store Credit (Issue)', amount: 1 }] },
    { payments: [{ payment_method: 'Gift Card', amount: 1 }] },
    { items: [{ ...body.items[0], qty: -1 }] }, { items: [{ ...body.items[0], is_gift_card: true }] },
    { return_of_sale_id: 1 }, { loyalty_reward_id: 1 },
  ]) {
    const rejected = await page.request.post('/api/pos/sales', { data: { ...body, ...change, local_id: `${localId}:blocked` } });
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).error).toBeTruthy();
  }
  expect(await trainingOracle(config, localId)).toEqual(saved);
  expect((await trainingOracle(config, `${localId}:blocked`)).training).toHaveLength(0);
  expect(await loadAllocationFixtureSnapshot(config)).toEqual(inventory);
  await appendManifestState(config.runId, 'awaiting_operator', {
    scenario: 'POS training', localId, trainingId: Number(result.training_id), beforeCounts: before.counts,
    verified: ['one simulated sale audit row', 'same ID on replay', 'return/layby/gift/store-credit/loyalty rejection', 'no ordinary sale/item/payment/stock movement writes'],
  });
});

test('@pos-training-verify retains only the acknowledged training audit and verifies production counters', async () => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation-compensate');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('acknowledged');
  const details = events.findLast(event => event.state === 'awaiting_operator')?.details as {
    scenario: string; localId: string; trainingId: number; beforeCounts: Record<string, number>;
  };
  expect(details.scenario).toBe('POS training');
  const state = await trainingOracle(config, details.localId);
  expect(state.counts).toEqual(details.beforeCounts);
  expect(state.training).toHaveLength(1);
  expect(Number(state.training[0].id)).toBe(details.trainingId);
  expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  await appendManifestState(config.runId, 'compensating', { scenario: 'POS training', localId: details.localId, retainedAuditOnly: true });
  await appendManifestState(config.runId, 'clean', {
    scenario: 'POS training', localId: details.localId, trainingId: details.trainingId,
    permanentArtifacts: ['Labelled simulated POS training audit; no financial or stock compensation required'],
  });
});