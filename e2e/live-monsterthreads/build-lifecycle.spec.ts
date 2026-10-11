import { expect, test, type Page } from '@playwright/test';
import mysql from 'mysql2/promise';

import { loadLiveE2EConfig, type LiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { loadAllocationFixtureSnapshot } from './support/database-preflight';
import { appendManifestState, readManifest } from './support/manifest-store';
import { xeroApiFetch } from '../../src/services/XeroService';
import { verifyLiveFifoIntegrity } from './support/fifo-database';

test.describe.configure({ timeout: 180_000 });

test('@build-inspect verifies authenticated build discovery without changing fixture inventory', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('allocation');
  const before = await loadAllocationFixtureSnapshot(config);
  expect(before.stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  await loginToIms(page, config);
  for (const endpoint of ['/api/ims/builds/recipes', '/api/ims/builds?pageSize=1', '/api/ims/builds/requirements?pageSize=1']) {
    const response = await page.request.get(endpoint);
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    expect(body.success, body.error).toBe(true);
    expect(body.data).toBeDefined();
  }
  expect(await loadAllocationFixtureSnapshot(config)).toEqual(before);
});

async function api(page: Page, method: 'post' | 'put', endpoint: string, data: unknown, status = 200) {
  const response = await page.request[method](endpoint, { data });
  const body = await response.json();
  expect(response.status(), body.error).toBe(status);
  if (status === 200) expect(body.success, body.error).toBe(true);
  else {
    expect(body.success, body.error).not.toBe(true);
    expect(body.error).toBeTruthy();
  }
  return body;
}

async function snapshot(config: LiveE2EConfig, outputVariantId: string, outputProductId: string, outputCommitted = 0) {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  });
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const schema = connection.escapeId(config.expectedImsSchema);
    const [identity] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT variant.variant_id, variant.product_id, variant.sku, product.name, product.is_online
         FROM ${schema}.ims_product_variants variant JOIN ${schema}.ims_products product
           ON product.product_id = variant.product_id AND product.business_id = variant.business_id
        WHERE variant.business_id = ? AND variant.variant_id = ? AND variant.product_id = ?`,
      [config.expectedBusinessId, outputVariantId, outputProductId],
    );
    expect(identity).toHaveLength(1);
    expect(identity[0]).toMatchObject({ sku: `E2E-BUILD-${config.runId}`, name: `LIVE E2E ${config.runId} BUILD OUTPUT`, is_online: 0 });
    const [stock] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT variant_id, location_id, qty_on_hand, qty_incoming, qty_committed FROM ${schema}.ims_stock
        WHERE business_id = ? AND variant_id IN (?, ?) ORDER BY variant_id, location_id`,
      [config.expectedBusinessId, config.fixtureVariantId, outputVariantId],
    );
    for (const row of stock) {
      expect(Number(row.qty_incoming)).toBe(0);
      expect(Number(row.qty_committed)).toBe(row.variant_id === outputVariantId && Number(row.location_id) === config.fixtureLocationId ? outputCommitted : 0);
      if (Number(row.location_id) !== config.fixtureLocationId) expect(Number(row.qty_on_hand)).toBe(0);
    }
    const [items] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, batch_id, quantity_built, quantity_reversed, component_cost_total, output_unit_cost
         FROM ${schema}.ims_product_build_items WHERE business_id = ? AND output_variant_id = ? ORDER BY id`,
      [config.expectedBusinessId, outputVariantId],
    );
    const [movements] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, variant_id, movement_type, reference_type, reference_id, qty_change, unit_cost,
              cost_method_snapshot, cost_epoch_id FROM ${schema}.ims_stock_movements
        WHERE business_id = ? AND variant_id IN (?, ?) ORDER BY id`,
      [config.expectedBusinessId, config.fixtureVariantId, outputVariantId],
    );
    return { stock, items, movements };
  } finally {
    await connection.rollback();
    await connection.end();
  }
}

function quantity(state: Awaited<ReturnType<typeof snapshot>>, variantId: string, locationId: number) {
  return Number(state.stock.find(row => row.variant_id === variantId && Number(row.location_id) === locationId)?.qty_on_hand ?? 0);
}

async function buildThroughUi(page: Page, config: LiveE2EConfig, outputVariantId: string) {
  await page.goto('/ims');
  await page.getByTestId('ims-nav-__products').click();
  await page.getByTestId('ims-nav-builds').click();
  const newBuild = page.getByRole('button', { name: 'New Build', exact: true });
  await expect(newBuild).toBeEnabled({ timeout: 30_000 });
  await newBuild.click();
  const dialog = page.getByRole('dialog', { name: 'New Product Build', exact: true });
  await dialog.getByRole('combobox').first().selectOption(String(config.fixtureLocationId), { timeout: 15_000 });
  await dialog.getByRole('textbox').fill(`LIVE E2E ${config.runId} BUILD`);
  await dialog.getByRole('combobox').nth(1).selectOption(outputVariantId);
  const confirm = dialog.getByRole('button', { name: 'Confirm atomic build', exact: true });
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  const pending = page.waitForResponse(response => response.url().endsWith('/api/ims/builds') && response.request().method() === 'POST');
  await confirm.click();
  const response = await pending;
  const body = await response.json();
  expect(response.ok(), body.error).toBe(true);
  return { data: body.data, input: response.request().postDataJSON() };
}

async function reverseThroughUi(page: Page, config: LiveE2EConfig, buildItemId: number, batchId: number) {
  const buildDialog = page.getByRole('dialog', { name: `BLD-${String(batchId).padStart(8, '0')}`, exact: true });
  await expect(buildDialog).toBeVisible({ timeout: 30_000 });
  await buildDialog.getByRole('button', { name: 'Reverse', exact: true }).click();
  const reverseDialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Confirm reversal', exact: true }) });
  await reverseDialog.getByRole('spinbutton').fill('0.5');
  await reverseDialog.getByRole('textbox').fill(`LIVE E2E ${config.runId} partial reversal`);
  const pending = page.waitForResponse(response => response.url().endsWith(`/api/ims/builds/items/${buildItemId}/reverse`) && response.request().method() === 'POST');
  await reverseDialog.getByRole('button', { name: 'Confirm reversal', exact: true }).click();
  const response = await pending;
  const body = await response.json();
  expect(response.ok(), body.error).toBe(true);
  return { data: body.data, input: response.request().postDataJSON() };
}

test('@build-exercise builds one captured-cost output and reverses it in two idempotent halves', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('build');
  const surface = process.env.LIVE_E2E_BUILD_SURFACE ?? 'api';
  expect(['api', 'ui', 'sale-confirm']).toContain(surface);
  const events = await readManifest(config.runId);
  let source = events.findLast(event => event.state === 'awaiting_operator')?.details as {
    scenario: string; purchaseOrderId: number; xeroBillId: string; phase?: string;
    outputProductId?: string; outputVariantId?: string; batchId?: number; buildItemId?: number;
    buildOperationKey?: string; reversalOperationKey?: string; salesOrderId?: number;
  };
  expect(events.at(-1)?.state).toBe('awaiting_operator');
  expect(['P1', 'Build']).toContain(source.scenario);
  if (source.scenario === 'Build' && source.phase === 'before_output_creation' && !source.batchId && !source.buildItemId) {
    const prior = events.findLast(event => {
      const details = event.details as typeof source;
      return details?.phase === 'recipe_created' && details.outputProductId === source.outputProductId
        && details.outputVariantId === source.outputVariantId && details.purchaseOrderId === source.purchaseOrderId;
    })?.details as typeof source | undefined;
    expect(prior, 'Phase recovery requires the exact recorded recipe checkpoint.').toBeDefined();
    source = { ...source, phase: prior!.phase };
  }
  const recoveringOutput = source.scenario === 'Build';
  const recoveringBuilt = recoveringOutput && source.phase !== 'recipe_created';
  const recoveringHalf = recoveringBuilt && source.phase === 'half_reversed';
  if (recoveringOutput) {
    expect(['recipe_created', 'built', 'half_reversed']).toContain(source.phase);
    expect(source.outputProductId).toBeTruthy();
    expect(source.outputVariantId).toBeTruthy();
    if (recoveringBuilt) {
      expect(source.buildItemId).toBeGreaterThan(0);
      expect(source.batchId).toBeGreaterThan(0);
    }
  }
  expect(source.purchaseOrderId).toBeGreaterThan(0);
  let outputProductId: string | null = recoveringOutput ? source.outputProductId! : null;
  let outputVariantId: string | null = recoveringOutput ? source.outputVariantId! : null;
  let batchId: number | null = recoveringBuilt ? source.batchId! : null;
  let buildItemId: number | null = recoveringBuilt ? source.buildItemId! : null;
  const reversalIds: number[] = [];
  let buildOperationKey = source.buildOperationKey ?? `${config.runId}:build:1`;
  let reversalOperationKey = source.reversalOperationKey ?? `${config.runId}:reverse:1`;
  let phase = source.phase ?? 'before_output_creation';
  let salesOrderId: number | null = source.salesOrderId ?? null;
  let outputCommitted = 0;
  const policyKey = `build_from_sale_location:${config.fixtureLocationId}`;
  let originalPolicy: string | null = null;
  const checkpoint = async () => appendManifestState(config.runId, 'awaiting_operator', {
    scenario: 'Build', purchaseOrderId: source.purchaseOrderId, xeroBillId: source.xeroBillId,
    outputProductId, outputVariantId, batchId, buildItemId, buildOperationKey, reversalOperationKey, surface, salesOrderId,
    originalBuildFromSalePolicy: originalPolicy, reversalIds: [...reversalIds], phase,
  });
  await loginToIms(page, config);
  try {
    const response = await page.request.get(`/api/ims/purchase-orders/${source.purchaseOrderId}`);
    const purchaseOrder = (await response.json()).data;
    expect(response.ok()).toBe(true);
    expect(purchaseOrder).toMatchObject({ status: 'complete', location_id: config.fixtureLocationId, supplier_id: config.fixtureSupplierId, tax_treatment: 'no_tax' });
    expect(purchaseOrder.notes).toContain(`LIVE E2E ${config.runId} P1`);
    expect(Number(purchaseOrder.total_amount)).toBe(config.maxDocumentTotal);
    expect(purchaseOrder.items).toHaveLength(1);
    expect(purchaseOrder.items[0].variant_id).toBe(config.fixtureVariantId);
    expect(Number(purchaseOrder.items[0].qty_received)).toBe(1);
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: recoveringHalf ? 0.5 : recoveringBuilt ? 0 : 1, qtyIncoming: 0, qtyCommitted: 0 });
    if (!recoveringOutput) {
    const sku = `E2E-BUILD-${config.runId}`;
    const product = await api(page, 'post', '/api/ims/products', {
      name: `LIVE E2E ${config.runId} BUILD OUTPUT`, base_sku: sku,
      is_active: 1, is_online: 0, is_stock_item: 1, uses_builds: 1,
    });
    outputProductId = product.product_id;
    expect(outputProductId).toBeTruthy();
    phase = 'output_product_created';
    await checkpoint();
    const variant = await api(page, 'post', '/api/ims/variants', {
      product_id: outputProductId, sku, is_active: 1, cost_aud: 0, price_rrp: config.maxDocumentTotal,
    });
    outputVariantId = variant.variant_id;
    expect(outputVariantId).toBeTruthy();
    phase = 'output_variant_created';
    await checkpoint();
    }
    const read = () => snapshot(config, outputVariantId!, outputProductId!, outputCommitted);
    const recipeInput = {
      outputVariantId, components: [{ variantId: config.fixtureVariantId, quantityPerOutput: 1 }],
      baseOutputQuantity: 1, overheadPerOutput: 0, notes: `LIVE E2E ${config.runId} BUILD RECIPE`, isEnabled: true,
    };
    if (!recoveringOutput) {
      const recipe = await api(page, 'put', `/api/ims/products/${outputProductId}/build-recipes`, recipeInput);
      expect(recipe.data.revision).toBe(1);
      phase = 'recipe_created';
      await checkpoint();
    } else {
      const recipeResponse = await page.request.get(`/api/ims/products/${outputProductId}/build-recipes`);
      const recipes = await recipeResponse.json();
      expect(recipeResponse.ok(), recipes.error).toBe(true);
      expect(recipes.data).toHaveLength(1);
      expect(recipes.data[0]).toMatchObject({ outputVariantId, revision: 1, isEnabled: true, overheadPerOutput: 0 });
      expect(recipes.data[0].components).toHaveLength(1);
      expect(recipes.data[0].components[0]).toMatchObject({ variantId: config.fixtureVariantId, quantityPerOutput: 1 });
    }
    const before = await read();
    expect(before.items).toHaveLength(recoveringBuilt ? 1 : 0);
    expect(quantity(before, outputVariantId!, config.fixtureLocationId)).toBe(recoveringHalf ? 0.5 : recoveringBuilt ? 1 : 0);
    if (recoveringBuilt) {
      expect(Number(before.items[0].id)).toBe(buildItemId);
      expect(Number(before.items[0].batch_id)).toBe(batchId);
      expect(Number(before.items[0].quantity_reversed)).toBe(recoveringHalf ? 0.5 : 0);
    }
    const previousMovementId = recoveringBuilt
      ? Math.min(...before.movements.filter(row => row.reference_type === 'product_build' && Number(row.reference_id) === buildItemId).map(row => Number(row.id))) - 1
      : Number(before.movements.at(-1)?.id ?? 0);
    expect(Number.isFinite(previousMovementId)).toBe(true);
    let buildInput = {
      locationId: config.fixtureLocationId, operationKey: buildOperationKey,
      builds: [{ outputVariantId, quantity: 1, recipeRevision: 1 }], notes: `LIVE E2E ${config.runId} BUILD`,
    };
    const uiBuild = surface === 'ui' && !recoveringBuilt ? await buildThroughUi(page, config, outputVariantId!) : null;
    if (uiBuild) buildInput = uiBuild.input;
    buildOperationKey = buildInput.operationKey;
    let built;
    let saleBuildInput: { operationKey: string; builds: Array<{ outputVariantId: string | null; recipeRevision: number }> } | null = null;
    if (surface === 'sale-confirm') {
      expect(recoveringBuilt, 'Completed sale-assisted builds require exact checkpoint reconciliation, not blind replay.').toBe(false);
      const settingsResponse = await page.request.get('/api/ims/settings');
      const settings = await settingsResponse.json();
      expect(settingsResponse.ok(), settings.error).toBe(true);
      originalPolicy = settings.data[policyKey] ?? 'inherit';
      phase = 'before_sale_policy';
      await checkpoint();
      await api(page, 'put', '/api/ims/settings', { key: policyKey, value: 'enabled' });
      expect(salesOrderId, 'Existing sale checkpoints require ownership reconciliation before restarting.').toBeNull();
      const sale = await api(page, 'post', '/api/ims/sales-orders', {
        customer_id: config.fixtureCustomerId, location_id: config.fixtureLocationId, status: 'draft', so_type: 'wholesale',
        order_date: new Date().toISOString().slice(0, 10), notes: `LIVE E2E ${config.runId} BUILD SALE`,
        tax_treatment: 'no_tax', subtotal: 1, tax_amount: 0, total_amount: config.maxDocumentTotal,
        items: [{ variant_id: outputVariantId, qty_ordered: 1, unit_price: config.maxDocumentTotal, tax_rate: 0, line_total: config.maxDocumentTotal }],
      });
      salesOrderId = Number(sale.id);
      expect(salesOrderId).toBeGreaterThan(0);
      phase = 'sale_draft_created';
      await checkpoint();
      expect(await read()).toEqual(before);
      const preview = await api(page, 'post', `/api/ims/sales-orders/${salesOrderId}/build-preview`, { mode: 'confirm' });
      expect(JSON.stringify(preview.data)).toContain(outputVariantId!);
      saleBuildInput = { operationKey: buildOperationKey, builds: [{ outputVariantId, recipeRevision: 1 }] };
      built = (await api(page, 'post', `/api/ims/sales-orders/${salesOrderId}/build-confirm`, saleBuildInput)).data;
      outputCommitted = 1;
    } else {
      built = uiBuild?.data ?? (await api(page, 'post', '/api/ims/builds', buildInput)).data;
    }
    if (recoveringBuilt) {
      expect(built.batchId).toBe(batchId);
      expect(built.itemIds).toEqual([buildItemId]);
    }
    batchId = built.batchId;
    buildItemId = built.itemIds[0];
    expect(built.replayed).toBe(recoveringBuilt);
    expect(built.itemIds).toHaveLength(1);
    phase = recoveringHalf ? 'half_reversed' : 'built';
    await checkpoint();
    const afterBuild = await read();
    expect(quantity(afterBuild, config.fixtureVariantId, config.fixtureLocationId)).toBe(recoveringHalf ? 0.5 : 0);
    expect(quantity(afterBuild, outputVariantId!, config.fixtureLocationId)).toBe(recoveringHalf ? 0.5 : 1);
    expect(afterBuild.items).toHaveLength(1);
    expect(Number(afterBuild.items[0].quantity_built)).toBe(1);
    expect(Number(afterBuild.items[0].component_cost_total)).toBe(config.maxDocumentTotal);
    expect(Number(afterBuild.items[0].output_unit_cost)).toBe(config.maxDocumentTotal);
    const produced = afterBuild.movements.filter(row => Number(row.id) > previousMovementId && row.reference_type === 'product_build');
    expect(produced).toHaveLength(2);
    for (const movement of produced) {
      expect(movement.cost_method_snapshot).toBe(config.expectedCostingMethod);
      expect(Number(movement.unit_cost)).toBe(config.maxDocumentTotal);
    }
    if (saleBuildInput) {
      const orderResponse = await page.request.get(`/api/ims/sales-orders/${salesOrderId}`);
      const order = (await orderResponse.json()).data;
      expect(orderResponse.ok()).toBe(true);
      expect(order).toMatchObject({ status: 'confirmed', location_id: config.fixtureLocationId, notes: `LIVE E2E ${config.runId} BUILD SALE` });
      expect(Number(order.total_amount)).toBe(config.maxDocumentTotal);
      expect(order.items).toHaveLength(1);
      expect(order.items[0].variant_id).toBe(outputVariantId);
      expect(Number(order.items[0].qty_ordered)).toBe(1);
      const replay = await api(page, 'post', `/api/ims/sales-orders/${salesOrderId}/build-confirm`, saleBuildInput);
      expect(replay.data.replayed).toBe(true);
      expect(replay.data.batchId).toBe(batchId);
      expect(await read()).toEqual(afterBuild);
      await api(page, 'put', `/api/ims/sales-orders/${salesOrderId}`, { status: 'cancelled', operationKey: `${config.runId}:sale:cancel` });
      outputCommitted = 0;
      phase = 'sale_cancelled';
      await checkpoint();
      const cancelled = await read();
      expect(quantity(cancelled, outputVariantId!, config.fixtureLocationId)).toBe(1);
      expect(cancelled.items).toEqual(afterBuild.items);
    } else {
      expect((await api(page, 'post', '/api/ims/builds', buildInput)).data.replayed).toBe(true);
      await api(page, 'post', '/api/ims/builds', { ...buildInput, builds: [{ ...buildInput.builds[0], quantity: 2 }] }, 409);
      expect(await read()).toEqual(afterBuild);
    }
    const reversalEndpoint = `/api/ims/builds/items/${buildItemId}/reverse`;
    let reverseInput = { quantity: 0.5, reason: `LIVE E2E ${config.runId} partial reversal`, operationKey: reversalOperationKey };
    const uiReversal = surface === 'ui' && !recoveringHalf ? await reverseThroughUi(page, config, buildItemId!, batchId!) : null;
    if (uiReversal) reverseInput = uiReversal.input;
    reversalOperationKey = reverseInput.operationKey;
    const reversed = uiReversal?.data ?? (await api(page, 'post', reversalEndpoint, reverseInput)).data;
    reversalIds.push(reversed.reversalId);
    phase = 'half_reversed';
    await checkpoint();
    const half = await read();
    expect(quantity(half, config.fixtureVariantId, config.fixtureLocationId)).toBe(0.5);
    expect(quantity(half, outputVariantId!, config.fixtureLocationId)).toBe(0.5);
    expect(Number(half.items[0].quantity_reversed)).toBe(0.5);
    expect((await api(page, 'post', reversalEndpoint, reverseInput)).data.replayed).toBe(true);
    await api(page, 'post', reversalEndpoint, { ...reverseInput, quantity: 0.25 }, 409);
    await api(page, 'post', reversalEndpoint, { ...reverseInput, quantity: 1, operationKey: `${config.runId}:reverse:excess` }, 400);
    expect(await read()).toEqual(half);
    const remaining = (await api(page, 'post', reversalEndpoint, { ...reverseInput, operationKey: `${config.runId}:reverse:2` })).data;
    reversalIds.push(remaining.reversalId);
    phase = 'fully_reversed';
    await checkpoint();
    const restored = await read();
    expect(quantity(restored, config.fixtureVariantId, config.fixtureLocationId)).toBe(1);
    expect(quantity(restored, outputVariantId!, config.fixtureLocationId)).toBe(0);
    expect(Number(restored.items[0].quantity_reversed)).toBe(1);
    const buildMovements = restored.movements.filter(row => Number(row.id) > previousMovementId && row.reference_type !== 'sales_order');
    expect(buildMovements).toHaveLength(6);
    expect(buildMovements.reduce((total, row) => total + Number(row.qty_change) * Number(row.unit_cost), 0)).toBe(0);
    for (const movement of buildMovements) expect(Number(movement.unit_cost)).toBe(config.maxDocumentTotal);
    const disabled = await api(page, 'put', `/api/ims/products/${outputProductId}/build-recipes`, {
      ...recipeInput, isEnabled: false, expectedRevision: 1,
    });
    expect(disabled.data.isEnabled).toBe(false);
    expect(disabled.data.revision).toBe(2);
    expect(await read()).toEqual(restored);
    phase = 'verified_and_recipe_disabled';
    await checkpoint();
  } catch (error) {
    await appendManifestState(config.runId, 'awaiting_operator', {
      scenario: 'Build', purchaseOrderId: source.purchaseOrderId, xeroBillId: source.xeroBillId,
      outputProductId, outputVariantId, batchId, buildItemId, buildOperationKey, reversalOperationKey, surface, salesOrderId,
      originalBuildFromSalePolicy: originalPolicy, reversalIds, phase, error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  } finally {
    if (originalPolicy !== null) {
      await api(page, 'put', '/api/ims/settings', { key: policyKey, value: originalPolicy });
      const response = await page.request.get('/api/ims/settings');
      expect((await response.json()).data[policyKey] ?? 'inherit').toBe(originalPolicy);
    }
  }
});

test('@build-fifo-return returns the restored component through an exact linked supplier credit', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('build');
  expect(config.expectedCostingMethod).toBe('fifo');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('awaiting_operator');
  const fixture = events.at(-1)!.details as {
    scenario: string; phase: string; outputVariantId: string; outputProductId: string;
    purchaseOrderId: number; xeroBillId: string; buildItemId: number; supplierCreditNoteId?: number;
  };
  expect(fixture.scenario).toBe('Build');
  expect(['verified_and_recipe_disabled', 'supplier_return_draft']).toContain(fixture.phase);
  const before = await snapshot(config, fixture.outputVariantId, fixture.outputProductId);
  expect(quantity(before, config.fixtureVariantId, config.fixtureLocationId)).toBe(1);
  expect(quantity(before, fixture.outputVariantId, config.fixtureLocationId)).toBe(0);
  expect(before.items).toHaveLength(1);
  expect(Number(before.items[0].id)).toBe(fixture.buildItemId);
  expect(Number(before.items[0].quantity_reversed)).toBe(1);
  await loginToIms(page, config);
  const poResponse = await page.request.get(`/api/ims/purchase-orders/${fixture.purchaseOrderId}`);
  const po = (await poResponse.json()).data;
  expect(poResponse.ok()).toBe(true);
  expect(po).toMatchObject({ status: 'complete', location_id: config.fixtureLocationId, supplier_id: config.fixtureSupplierId, tax_treatment: 'no_tax' });
  expect(po.notes).toContain(`LIVE E2E ${config.runId} P1`);
  expect(Number(po.total_amount)).toBe(config.maxDocumentTotal);
  expect(po.items).toHaveLength(1);
  expect(po.items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(po.items[0].qty_received)).toBe(1);
  const recipeResponse = await page.request.get(`/api/ims/products/${fixture.outputProductId}/build-recipes`);
  const recipes = await recipeResponse.json();
  expect(recipeResponse.ok()).toBe(true);
  expect(recipes.data).toHaveLength(1);
  expect(recipes.data[0]).toMatchObject({ revision: 2, isEnabled: false });
  const input = {
    po_id: fixture.purchaseOrderId, supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId,
    scn_date: new Date().toISOString().slice(0, 10), tax_treatment: 'no_tax', currency_code: 'AUD',
    notes: `LIVE E2E ${config.runId} FIFO BUILD COMPONENT RETURN`,
    items: [{ variant_id: config.fixtureVariantId, source_po_item_id: Number(po.items[0].id),
      qty: 1, unit_cost: config.maxDocumentTotal, tax_rate: 0, restock: true }],
  };
  const scnId = fixture.supplierCreditNoteId ?? Number((await api(page, 'post', '/api/ims/supplier-credit-notes', input)).data.id);
  expect(scnId).toBeGreaterThan(0);
  const detailResponse = await page.request.get(`/api/ims/supplier-credit-notes/${scnId}`);
  const draft = (await detailResponse.json()).data;
  expect(detailResponse.ok()).toBe(true);
  expect(draft).toMatchObject({ status: 'draft', po_id: fixture.purchaseOrderId, supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, tax_treatment: 'no_tax' });
  expect(draft.notes).toBe(input.notes);
  expect(Number(draft.total_amount)).toBe(config.maxDocumentTotal);
  expect(draft.items).toHaveLength(1);
  expect(draft.items[0].variant_id).toBe(config.fixtureVariantId);
  expect(Number(draft.items[0].source_po_item_id)).toBe(Number(po.items[0].id));
  expect(Number(draft.items[0].qty)).toBe(1);
  expect(Number(draft.items[0].unit_cost)).toBe(config.maxDocumentTotal);
  expect(Number(draft.items[0].restock)).toBe(1);
  const policyEndpoint = `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`;
  const policyResponse = await page.request.get(policyEndpoint);
  const policyBody = await policyResponse.json();
  expect(policyResponse.ok(), policyBody.error).toBe(true);
  const originalXeroPolicy = policyBody.policy;
  expect(originalXeroPolicy).toBeDefined();
  await appendManifestState(config.runId, 'awaiting_operator', { ...fixture, phase: 'supplier_return_draft', supplierCreditNoteId: scnId });
  await appendManifestState(config.runId, 'acknowledged', { operator: 'User-authorized exact campaign cleanup; linked capped supplier return verified' });
  await appendManifestState(config.runId, 'compensating', { scenario: 'Build', ...fixture, supplierCreditNoteId: scnId, originalXeroPolicy });
  try {
    await api(page, 'put', '/api/xero/document-policies', {
      databaseId: config.expectedBusinessId, policy: { ...originalXeroPolicy, supplierCreditNoteAction: 'draft' },
    });
    const completion = { operationKey: `${config.runId}:supplier-return:complete` };
    const complete = await api(page, 'post', `/api/ims/supplier-credit-notes/${scnId}/complete`, completion);
    expect(complete.data.status).toBe('complete');
    const after = await snapshot(config, fixture.outputVariantId, fixture.outputProductId);
    expect(quantity(after, config.fixtureVariantId, config.fixtureLocationId)).toBe(0);
    expect(quantity(after, fixture.outputVariantId, config.fixtureLocationId)).toBe(0);
    const newMovements = after.movements.filter(row => !before.movements.some(prior => prior.id === row.id));
    expect(newMovements).toHaveLength(1);
    expect(newMovements[0]).toMatchObject({ reference_type: 'supplier_credit_note', cost_method_snapshot: 'fifo' });
    expect(Number(newMovements[0].qty_change)).toBe(-1);
    expect(Number(newMovements[0].unit_cost)).toBe(config.maxDocumentTotal);
    await api(page, 'post', `/api/ims/supplier-credit-notes/${scnId}/complete`, completion);
    expect(await snapshot(config, fixture.outputVariantId, fixture.outputProductId)).toEqual(after);
    let xeroCreditNoteId: string | null = null;
    await expect.poll(async () => {
      const response = await page.request.get(`/api/ims/supplier-credit-notes/${scnId}/xero-status`);
      const body = await response.json();
      xeroCreditNoteId = body.latest?.status === 'success' ? body.latest.xero_id : null;
      return xeroCreditNoteId;
    }, { timeout: 60_000 }).not.toBeNull();
    const credit = await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${xeroCreditNoteId}`, { method: 'GET' });
    expect(credit.CreditNotes).toHaveLength(1);
    expect(['DRAFT', 'AUTHORISED']).toContain(credit.CreditNotes[0].Status);
    expect(Number(credit.CreditNotes[0].Total)).toBe(config.maxDocumentTotal);
    expect(Number(credit.CreditNotes[0].TotalTax)).toBe(0);
    const bill = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${fixture.xeroBillId}`, { method: 'GET' });
    expect(bill.Invoices).toHaveLength(1);
    expect(['DRAFT', 'AUTHORISED']).toContain(bill.Invoices[0].Status);
    expect(Number(bill.Invoices[0].Total)).toBe(config.maxDocumentTotal);
    const fifo = await verifyLiveFifoIntegrity(config);
    expect(fifo.stockQuantity).toBe(0);
    expect(fifo.layerQuantity).toBe(0);
    expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
    await appendManifestState(config.runId, 'clean', { ...fixture, scenario: 'Build', phase: 'supplier_return_completed', supplierCreditNoteId: scnId, xeroCreditNoteId, fifo,
      permanentArtifacts: ['Completed PO receipt and original Xero bill', 'Completed linked supplier return and Xero credit note', 'Fully reversed build and immutable FIFO allocation history'] });
  } catch (error) {
    await appendManifestState(config.runId, 'blocked', { ...fixture, scenario: 'Build', phase: 'supplier_return_completion', supplierCreditNoteId: scnId, originalXeroPolicy, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await api(page, 'put', '/api/xero/document-policies', { databaseId: config.expectedBusinessId, policy: originalXeroPolicy });
    const restoredPolicy = await page.request.get(policyEndpoint);
    expect(restoredPolicy.ok()).toBe(true);
    expect((await restoredPolicy.json()).policy).toEqual(originalXeroPolicy);
  }
});

test('@build-verify reads back compensated stock, disabled recipe and the original Xero bill', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('build-verify');
  const events = await readManifest(config.runId);
  expect(['clean', 'verification_authorized']).toContain(events.at(-1)?.state);
  const fixture = events.findLast(event => (event.details as any)?.scenario === 'Build')?.details as {
    phase: string; outputVariantId: string; outputProductId: string; xeroBillId: string; buildItemId: number;
    purchaseOrderId: number; supplierCreditNoteId?: number; salesOrderId?: number;
  };
  expect(['verified_and_recipe_disabled', 'supplier_return_completed', 'supplier_return_completion']).toContain(fixture.phase);
  const before = await snapshot(config, fixture.outputVariantId, fixture.outputProductId);
  expect(quantity(before, config.fixtureVariantId, config.fixtureLocationId)).toBe(0);
  expect(quantity(before, fixture.outputVariantId, config.fixtureLocationId)).toBe(0);
  expect(before.items).toHaveLength(1);
  expect(Number(before.items[0].id)).toBe(fixture.buildItemId);
  expect(Number(before.items[0].quantity_reversed)).toBe(1);
  expect((await loadAllocationFixtureSnapshot(config)).stock).toEqual({ qtyOnHand: 0, qtyIncoming: 0, qtyCommitted: 0 });
  await loginToIms(page, config);
  const response = await page.request.get(`/api/ims/products/${fixture.outputProductId}/build-recipes`);
  const recipes = await response.json();
  expect(response.ok(), recipes.error).toBe(true);
  expect(recipes.data).toHaveLength(1);
  expect(recipes.data[0]).toMatchObject({ outputVariantId: fixture.outputVariantId, revision: 2, isEnabled: false });
  const remote = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${fixture.xeroBillId}`, { method: 'GET' });
  expect(remote.Invoices).toHaveLength(1);
  let xeroCreditNoteId: string | null = null;
  if (fixture.supplierCreditNoteId) {
    expect(config.expectedCostingMethod).toBe('fifo');
    expect(['DRAFT', 'AUTHORISED']).toContain(remote.Invoices[0].Status);
    expect(Number(remote.Invoices[0].Total)).toBe(config.maxDocumentTotal);
    const scnResponse = await page.request.get(`/api/ims/supplier-credit-notes/${fixture.supplierCreditNoteId}`);
    const scn = (await scnResponse.json()).data;
    expect(scnResponse.ok()).toBe(true);
    expect(scn).toMatchObject({ status: 'complete', po_id: fixture.purchaseOrderId, supplier_id: config.fixtureSupplierId, location_id: config.fixtureLocationId, tax_treatment: 'no_tax' });
    expect(scn.notes).toBe(`LIVE E2E ${config.runId} FIFO BUILD COMPONENT RETURN`);
    expect(Number(scn.total_amount)).toBe(config.maxDocumentTotal);
    const syncResponse = await page.request.get(`/api/ims/supplier-credit-notes/${fixture.supplierCreditNoteId}/xero-status`);
    const sync = await syncResponse.json();
    expect(syncResponse.ok()).toBe(true);
    expect(sync.latest?.status, sync.latest?.detail).toBe('success');
    xeroCreditNoteId = sync.latest.xero_id;
    expect(xeroCreditNoteId).toBeTruthy();
    const credit = await xeroApiFetch(config.expectedBusinessId, `/CreditNotes/${xeroCreditNoteId}`, { method: 'GET' });
    expect(credit.CreditNotes).toHaveLength(1);
    expect(['DRAFT', 'AUTHORISED']).toContain(credit.CreditNotes[0].Status);
    expect(Number(credit.CreditNotes[0].Total)).toBe(config.maxDocumentTotal);
    expect(Number(credit.CreditNotes[0].TotalTax)).toBe(0);
    const fifo = await verifyLiveFifoIntegrity(config);
    expect(fifo.stockQuantity).toBe(0);
    expect(fifo.layerQuantity).toBe(0);
  } else {
    expect(['DELETED', 'VOIDED']).toContain(remote.Invoices[0].Status);
  }
  if (fixture.salesOrderId) {
    const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
    let xeroInvoiceId: string;
    try {
      const schema = connection.escapeId(config.expectedImsSchema);
      const [orders] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT status, location_id, customer_id, notes, total_amount FROM ${schema}.ims_sales_orders WHERE business_id = ? AND id = ?`,
        [config.expectedBusinessId, fixture.salesOrderId]);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({ status: 'cancelled', location_id: config.fixtureLocationId, customer_id: config.fixtureCustomerId,
        notes: `LIVE E2E ${config.runId} BUILD SALE` });
      expect(Number(orders[0].total_amount)).toBe(config.maxDocumentTotal);
      const [logs] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'so_invoice' AND reference_id = ?
          AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        [config.expectedBusinessId, fixture.salesOrderId]);
      expect(logs).toHaveLength(1);
      xeroInvoiceId = String(logs[0].xero_id);
    } finally { await connection.end(); }
    const invoice = await xeroApiFetch(config.expectedBusinessId, `/Invoices/${xeroInvoiceId}`, { method: 'GET' });
    expect(invoice.Invoices).toHaveLength(1);
    expect(['DELETED', 'VOIDED']).toContain(invoice.Invoices[0].Status);
    expect(Number(invoice.Invoices[0].Total)).toBe(config.maxDocumentTotal);
    expect(Number(invoice.Invoices[0].TotalTax)).toBe(0);
  }
  expect(await snapshot(config, fixture.outputVariantId, fixture.outputProductId)).toEqual(before);
  if (events.at(-1)?.state === 'verification_authorized') {
    await appendManifestState(config.runId, 'clean', { ...fixture, scenario: 'Build', phase: 'supplier_return_completed', xeroCreditNoteId,
      permanentArtifacts: ['Completed PO receipt and original Xero bill', 'Completed linked supplier return and Xero credit note', 'Fully reversed build and immutable FIFO allocation history'] });
  }
});

test('@build-ui inspects retained build history and detail across desktop and mobile without writes', async ({ page }, testInfo) => {
  const config = loadLiveE2EConfig();
  expect(config.action).toBe('build-verify');
  const events = await readManifest(config.runId);
  expect(events.at(-1)?.state).toBe('clean');
  const fixture = events.findLast(event => (event.details as any)?.scenario === 'Build')?.details as {
    outputVariantId: string; outputProductId: string; batchId: number;
  };
  const before = await snapshot(config, fixture.outputVariantId, fixture.outputProductId);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginToIms(page, config);
  await page.getByTestId('ims-nav-__products').click();
  const reads = ['/api/ims/builds?pageSize=100', '/api/ims/builds/requirements?state=open&limit=200', '/api/ims/builds/recipes', '/api/ims/locations']
    .map(endpoint => page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'GET'));
  await page.getByTestId('ims-nav-builds').click();
  const responses = await Promise.all(reads);
  for (const response of responses) expect(response.ok(), `${response.status()} ${new URL(response.url()).pathname}`).toBe(true);
  const history = await responses[0].json();
  expect(history.data.rows.some((item: { id: number }) => Number(item.id) === fixture.batchId)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Product Builds', exact: true })).toBeVisible();
  const buildNumber = `BLD-${String(fixture.batchId).padStart(8, '0')}`;
  const buildButton = page.getByRole('button', { name: buildNumber, exact: true });
  await expect(buildButton).toBeVisible({ timeout: 30_000 });
  const row = buildButton.locator('xpath=ancestor::tr');
  await expect(row).toContainText('reversed');
  const region = page.getByRole('region', { name: 'Build history. Use arrow keys to scroll.', exact: true });
  await page.setViewportSize({ width: 900, height: 700 });
  expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const frozenBefore = await row.locator('td').first().boundingBox();
  const movingBefore = await row.locator('td').nth(1).boundingBox();
  await region.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  const bodyOffset = await region.evaluate(element => element.scrollLeft);
  const headerOffset = await region.evaluate(element => element.previousElementSibling?.scrollLeft);
  expect(headerOffset).toBe(bodyOffset);
  expect((await row.locator('td').first().boundingBox())!.x).toBeCloseTo(frozenBefore!.x, 0);
  expect((await row.locator('td').nth(1).boundingBox())!.x).toBeLessThan(movingBefore!.x);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBe(0);
  await page.setViewportSize({ width: 900, height: 300 });
  await region.focus();
  const verticalScroll = () => region.evaluate(element => {
    let parent = element.parentElement;
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent.scrollTop;
      parent = parent.parentElement;
    }
    return window.scrollY;
  });
  const verticalBefore = await verticalScroll();
  await page.keyboard.press('ArrowDown');
  await expect.poll(verticalScroll).toBeGreaterThan(verticalBefore);
  expect(await region.evaluate(element => element.scrollLeft)).toBe(0);
  await page.keyboard.press('ArrowUp');
  await expect.poll(verticalScroll).toBeLessThanOrEqual(verticalBefore);
  expect(await region.evaluate(element => element.scrollLeft)).toBe(0);
  await page.setViewportSize({ width: 900, height: 700 });
  await buildButton.click();
  const dialog = page.getByRole('dialog', { name: buildNumber, exact: true });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText('1 built');
  await expect(dialog).toContainText('1 reversed');
  await expect(dialog.getByRole('button', { name: 'Reverse', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('build-detail-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('build-detail-mobile.png'), fullPage: true });
  const geometry = await dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, viewport: window.innerWidth, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(errors).toEqual([]);
  expect(await snapshot(config, fixture.outputVariantId, fixture.outputProductId)).toEqual(before);
});