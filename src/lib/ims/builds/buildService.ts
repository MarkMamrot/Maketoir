import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';
import { computeAverageCostAfterReversal, computeWeightedAverageCost } from '../avgCostMath';
import { refreshVariantCache } from '../cacheHelper';
import { recomputeBuildRequirementsSafely } from './buildRequirementService';
import {
  aggregateBuildComponentDemand,
  calculateBuildUnitCost,
  calculateReversalComponents,
  hashProductBuildRequest,
  positiveBuildQuantity,
  ProductBuildValidationError,
  type BuildRecipe,
  type BuildRequest,
} from './domain';

export class ProductBuildConflictError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'product_build_conflict', details?: Record<string, unknown>) {
    super(message);
    this.name = 'ProductBuildConflictError';
    this.code = code;
    this.details = details;
  }
}

export interface ProductBuildBatchInput {
  businessId: string;
  locationId: number;
  operationKey: string;
  builds: Array<BuildRequest & { sourceLineId?: string | null }>;
  sourceType?: 'manual' | 'pos_sale' | 'sales_order';
  sourceId?: string | null;
  sourceChannel?: string | null;
  notes?: string | null;
  actorId?: number | null;
  actorName?: string | null;
}

export interface ProductBuildReversalInput {
  businessId: string;
  buildItemId: number;
  quantity: number;
  reason: string;
  operationKey: string;
  actorId?: number | null;
  actorName?: string | null;
}

interface ActiveRecipeRow extends RowDataPacket {
  recipe_id: number;
  version_id: number;
  output_variant_id: string;
  revision: number;
  base_output_quantity: number;
  overhead_per_output: number;
  component_variant_id: string;
  quantity_per_output: number;
  sort_order: number;
}

interface VariantRow extends RowDataPacket {
  variant_id: string;
  product_id: string;
  sku: string | null;
  product_name: string;
  is_active: number;
  product_active: number;
  is_stock_item: number;
  avg_cost: number;
  cost_aud: number;
}

interface StockRow extends RowDataPacket {
  variant_id: string;
  location_id: number;
  qty_on_hand: number;
  qty_committed: number;
}

type ResolvedRecipe = BuildRecipe & { recipeId: number; versionId: number };

function operationKey(value: unknown): string {
  const key = String(value ?? '').trim();
  if (!key) throw new ProductBuildValidationError('operationKey is required.');
  if (key.length > 191) throw new ProductBuildValidationError('operationKey must be 191 characters or fewer.');
  return key;
}

function normalizeBatchInput(input: ProductBuildBatchInput): ProductBuildBatchInput {
  const locationId = Number(input.locationId);
  if (!Number.isInteger(locationId) || locationId <= 0) throw new ProductBuildValidationError('A valid location is required.');
  if (!Array.isArray(input.builds) || input.builds.length === 0) throw new ProductBuildValidationError('At least one build is required.');
  return {
    ...input,
    businessId: String(input.businessId ?? '').trim(),
    locationId,
    operationKey: operationKey(input.operationKey),
    sourceType: input.sourceType ?? 'manual',
    sourceId: String(input.sourceId ?? '').trim() || null,
    sourceChannel: String(input.sourceChannel ?? '').trim() || null,
    notes: String(input.notes ?? '').trim() || null,
    builds: input.builds.map(build => ({
      outputVariantId: String(build.outputVariantId ?? '').trim(),
      quantity: positiveBuildQuantity(build.quantity, 'Build quantity'),
      ...(build.recipeRevision == null ? {} : { recipeRevision: Number(build.recipeRevision) }),
      ...(build.overheadPerOutput == null ? {} : { overheadPerOutput: Number(build.overheadPerOutput) }),
      sourceLineId: String(build.sourceLineId ?? '').trim() || null,
    })),
  };
}

function batchHash(input: ProductBuildBatchInput): string {
  return hashProductBuildRequest({
    businessId: input.businessId,
    locationId: input.locationId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceChannel: input.sourceChannel,
    notes: input.notes,
    builds: input.builds,
  });
}

async function assertLocation(connection: PoolConnection, businessId: string, locationId: number): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1`,
    [locationId, businessId],
  );
  if (!rows[0]) throw new ProductBuildValidationError('The selected location is not active for this business.');
}

async function loadActiveRecipes(
  connection: PoolConnection,
  businessId: string,
  outputIds: string[],
  lock = false,
): Promise<Map<string, ResolvedRecipe>> {
  const [rows] = await connection.execute<ActiveRecipeRow[]>(
        `SELECT r.id AS recipe_id, rv.id AS version_id, r.output_variant_id, rv.revision,
          rv.base_output_quantity, rv.overhead_per_output,
          c.component_variant_id, c.quantity_per_output, c.sort_order
       FROM ims_product_build_recipes r
       JOIN ims_product_build_recipe_versions rv
         ON rv.id = r.active_version_id AND rv.business_id = r.business_id
       JOIN ims_product_build_recipe_components c
         ON c.recipe_version_id = rv.id AND c.business_id = r.business_id
      WHERE r.business_id = ? AND r.is_enabled = 1
        AND r.output_variant_id IN (${outputIds.map(() => '?').join(',')})
      ORDER BY r.output_variant_id, c.sort_order, c.id${lock ? ' FOR UPDATE' : ''}`,
    [businessId, ...outputIds],
  );
  const recipes = new Map<string, ResolvedRecipe>();
  for (const row of rows) {
    const id = String(row.output_variant_id);
    const recipe = recipes.get(id) ?? {
      recipeId: Number(row.recipe_id),
      versionId: Number(row.version_id),
      outputVariantId: id,
      revision: Number(row.revision),
      overheadPerOutput: Number(row.overhead_per_output),
      components: [],
    };
    recipe.components.push({
      variantId: String(row.component_variant_id),
      quantityPerOutput: Number(row.quantity_per_output),
    });
    recipes.set(id, recipe);
  }
  for (const id of outputIds) {
    if (!recipes.has(id)) throw new ProductBuildConflictError(`No active build recipe exists for variant ${id}.`, 'missing_build_recipe');
  }
  return recipes;
}

async function loadVariants(
  connection: PoolConnection,
  businessId: string,
  variantIds: string[],
  lock = false,
): Promise<Map<string, VariantRow>> {
  const [rows] = await connection.execute<VariantRow[]>(
    `SELECT v.variant_id, v.product_id, v.sku, v.is_active,
            p.name AS product_name, p.is_active AS product_active, p.is_stock_item,
            COALESCE(v.avg_cost, v.cost_aud, 0) AS avg_cost, COALESCE(v.cost_aud, 0) AS cost_aud
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = v.business_id
      WHERE v.business_id = ? AND v.variant_id IN (${variantIds.map(() => '?').join(',')})
      ORDER BY v.variant_id${lock ? ' FOR UPDATE' : ''}`,
    [businessId, ...variantIds],
  );
  const variants = new Map(rows.map(row => [String(row.variant_id), row]));
  for (const id of variantIds) {
    const row = variants.get(id);
    if (!row) throw new ProductBuildConflictError(`Variant ${id} no longer exists.`, 'invalid_build_variant');
    if (!Number(row.is_active) || !Number(row.product_active) || !Number(row.is_stock_item)) {
      throw new ProductBuildConflictError(`Variant ${id} must be an active stock item.`, 'invalid_build_variant');
    }
  }
  return variants;
}

async function ensureAndLoadStock(
  connection: PoolConnection,
  businessId: string,
  locationId: number,
  variantIds: string[],
  lock: boolean,
): Promise<{ location: Map<string, StockRow>; organizationQty: Map<string, number> }> {
  if (lock) {
    for (const variantId of variantIds) {
      await connection.execute(
        `INSERT IGNORE INTO ims_stock (business_id, variant_id, location_id) VALUES (?, ?, ?)`,
        [businessId, variantId, locationId],
      );
    }
  }
  const [rows] = await connection.execute<StockRow[]>(
    `SELECT variant_id, location_id, qty_on_hand, qty_committed
       FROM ims_stock
      WHERE business_id = ? AND variant_id IN (${variantIds.map(() => '?').join(',')})
      ORDER BY variant_id, location_id${lock ? ' FOR UPDATE' : ''}`,
    [businessId, ...variantIds],
  );
  const location = new Map<string, StockRow>();
  const organizationQty = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.variant_id);
    organizationQty.set(id, (organizationQty.get(id) ?? 0) + Number(row.qty_on_hand));
    if (Number(row.location_id) === locationId) location.set(id, row);
  }
  for (const id of variantIds) {
    if (!location.has(id)) {
      location.set(id, { variant_id: id, location_id: locationId, qty_on_hand: 0, qty_committed: 0 } as StockRow);
    }
  }
  return { location, organizationQty };
}

function withCurrentCosts(recipes: Map<string, ResolvedRecipe>, variants: Map<string, VariantRow>): Map<string, ResolvedRecipe> {
  return new Map([...recipes].map(([outputId, recipe]) => [outputId, {
    ...recipe,
    components: recipe.components.map(component => ({
      ...component,
      averageCost: Number(variants.get(component.variantId)?.avg_cost ?? 0),
    })),
  }]));
}

export async function previewProductBuildBatch(input: Omit<ProductBuildBatchInput, 'operationKey'>) {
  const normalized = normalizeBatchInput({ ...input, operationKey: '__preview__' });
  const connection = await getIMSPool().getConnection();
  try {
    await assertLocation(connection, normalized.businessId, normalized.locationId);
    const outputIds = normalized.builds.map(build => build.outputVariantId);
    const recipes = await loadActiveRecipes(connection, normalized.businessId, outputIds);
    const preliminaryDemand = aggregateBuildComponentDemand(normalized.builds, recipes);
    const allIds = [...new Set([...outputIds, ...preliminaryDemand.keys()])].sort();
    const variants = await loadVariants(connection, normalized.businessId, allIds);
    const costedRecipes = withCurrentCosts(recipes, variants);
    const demand = aggregateBuildComponentDemand(normalized.builds, costedRecipes);
    const stocks = await ensureAndLoadStock(connection, normalized.businessId, normalized.locationId, allIds, false);
    const components = [...demand].map(([variantId, required]) => {
      const stock = stocks.location.get(variantId)!;
      const onHand = Number(stock.qty_on_hand);
      const committed = Number(stock.qty_committed);
      const available = onHand - committed;
      const averageCost = Number(variants.get(variantId)?.avg_cost ?? 0);
      return { variantId, onHand, committed, available, required, after: available - required, averageCost, cost: required * averageCost };
    });
    return {
      locationId: normalized.locationId,
      canComplete: components.every(component => component.after >= -0.00005),
      builds: normalized.builds.map(build => {
        const recipe = costedRecipes.get(build.outputVariantId)!;
        return {
          outputVariantId: build.outputVariantId,
          quantity: build.quantity,
          recipeRevision: recipe.revision,
          overheadPerOutput: build.overheadPerOutput ?? recipe.overheadPerOutput ?? 0,
          outputUnitCost: calculateBuildUnitCost(recipe, build.overheadPerOutput),
        };
      }),
      components,
    };
  } finally {
    connection.release();
  }
}

async function queueShopifyVariants(
  connection: PoolConnection,
  variantIds: string[],
): Promise<boolean> {
  const [tables] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_shopify_inventory_queue' LIMIT 1`,
  );
  if (!tables.length) return false;
  await connection.execute(
    `INSERT IGNORE INTO ims_shopify_inventory_queue (variant_id, queued_at)
     VALUES ${variantIds.map(() => '(?, NOW())').join(',')}`,
    variantIds,
  );
  return true;
}

async function setOrganizationAverageCost(
  connection: PoolConnection,
  businessId: string,
  variantId: string,
  averageCost: number,
): Promise<void> {
  await connection.execute(
    `UPDATE ims_product_variants SET avg_cost = ? WHERE business_id = ? AND variant_id = ?`,
    [averageCost, businessId, variantId],
  );
  await connection.execute(
    `UPDATE ims_stock SET avg_cost = ? WHERE business_id = ? AND variant_id = ?`,
    [averageCost, businessId, variantId],
  );
}

export async function completeProductBuildInTransaction(
  connection: PoolConnection,
  rawInput: ProductBuildBatchInput,
): Promise<{ batchId: number; buildNumber: string; itemIds: number[]; touchedVariantIds: string[]; replayed: boolean; shopifyQueued: boolean }> {
  const input = normalizeBatchInput(rawInput);
  const requestHash = batchHash(input);
  const [existingRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, build_number, request_hash FROM ims_product_build_batches
      WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
    [input.businessId, input.operationKey],
  );
  if (existingRows[0]) {
    if (String(existingRows[0].request_hash) !== requestHash) {
      throw new ProductBuildConflictError('This operation key was already used for a different build request.', 'product_build_idempotency_conflict');
    }
    const detail = await getProductBuildBatchWithConnection(connection, input.businessId, Number(existingRows[0].id));
    return {
      batchId: Number(existingRows[0].id),
      buildNumber: String(existingRows[0].build_number),
      itemIds: (detail?.items ?? []).map((item: any) => Number(item.id)),
      touchedVariantIds: [...new Set((detail?.items ?? []).flatMap((item: any) => [item.output_variant_id, ...(item.components ?? []).map((c: any) => c.component_variant_id)]))] as string[],
      replayed: true,
      shopifyQueued: true,
    };
  }

  await assertLocation(connection, input.businessId, input.locationId);
  const outputIds = input.builds.map(build => build.outputVariantId);
  const recipes = await loadActiveRecipes(connection, input.businessId, outputIds, true);
  const demand = aggregateBuildComponentDemand(input.builds, recipes);
  const allIds = [...new Set([...outputIds, ...demand.keys()])].sort();
  const variants = await loadVariants(connection, input.businessId, allIds, true);
  const costedRecipes = withCurrentCosts(recipes, variants);
  const aggregatedDemand = aggregateBuildComponentDemand(input.builds, costedRecipes);
  const stocks = await ensureAndLoadStock(connection, input.businessId, input.locationId, allIds, true);
  const shortages = [...aggregatedDemand].flatMap(([variantId, required]) => {
    const stock = stocks.location.get(variantId)!;
    const available = Number(stock.qty_on_hand) - Number(stock.qty_committed);
    return available + 0.00005 < required ? [{ variantId, required, available }] : [];
  });
  if (shortages.length) {
    throw new ProductBuildConflictError('Available component stock is insufficient to complete this build.', 'product_build_stock_shortage', { shortages });
  }

  const [batchResult] = await connection.execute<ResultSetHeader>(
    `INSERT IGNORE INTO ims_product_build_batches
       (business_id, build_number, location_id, status, source_type, source_id, source_channel,
        notes, operation_key, request_hash, actor_id, actor_name)
     VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.businessId, `PENDING-${requestHash.slice(0, 32)}`, input.locationId, input.sourceType, input.sourceId,
      input.sourceChannel, input.notes, input.operationKey, requestHash, input.actorId ?? null, input.actorName ?? null],
  );
  if (!batchResult.insertId) {
    const [winnerRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, build_number, request_hash FROM ims_product_build_batches
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, input.operationKey],
    );
    const winner = winnerRows[0];
    if (!winner || String(winner.request_hash) !== requestHash) {
      throw new ProductBuildConflictError('This operation key was already used for a different build request.', 'product_build_idempotency_conflict');
    }
    const detail = await getProductBuildBatchWithConnection(connection, input.businessId, Number(winner.id));
    return {
      batchId: Number(winner.id),
      buildNumber: String(winner.build_number),
      itemIds: (detail?.items ?? []).map((item: any) => Number(item.id)),
      touchedVariantIds: [...new Set((detail?.items ?? []).flatMap((item: any) => [item.output_variant_id, ...(item.components ?? []).map((component: any) => component.component_variant_id)]))] as string[],
      replayed: true,
      shopifyQueued: true,
    };
  }
  const batchId = Number(batchResult.insertId);
  const buildNumber = `BLD-${String(batchId).padStart(8, '0')}`;
  await connection.execute(
    `UPDATE ims_product_build_batches SET build_number = ? WHERE id = ? AND business_id = ?`,
    [buildNumber, batchId, input.businessId],
  );

  const itemIds: number[] = [];
  for (const build of input.builds) {
    const recipe = costedRecipes.get(build.outputVariantId)!;
    const outputStock = stocks.location.get(build.outputVariantId)!;
    const outputVariant = variants.get(build.outputVariantId)!;
    const quantity = Number(build.quantity);
    const overhead = build.overheadPerOutput ?? recipe.overheadPerOutput ?? 0;
    const outputUnitCost = calculateBuildUnitCost(recipe, build.overheadPerOutput);
    const componentCostPerOutput = outputUnitCost - Number(overhead);
    const componentCostTotal = componentCostPerOutput * quantity;
    const oldOrganizationQty = Number(stocks.organizationQty.get(build.outputVariantId) ?? 0);
    const oldAverageCost = Number(outputVariant.avg_cost ?? 0);
    const newAverageCost = computeWeightedAverageCost({
      oldQtyOnHand: oldOrganizationQty,
      oldAvgCost: oldAverageCost,
      receivedQty: quantity,
      receivedUnitCostAud: outputUnitCost,
    });
    const [itemResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO ims_product_build_items
         (business_id, batch_id, output_variant_id, recipe_id, recipe_version_id, recipe_revision,
          quantity_built, component_cost_total, component_cost_per_output, overhead_per_output,
          output_unit_cost, output_avg_cost_before, output_avg_cost_after, source_line_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.businessId, batchId, build.outputVariantId, recipe.recipeId, recipe.versionId, recipe.revision,
        quantity, componentCostTotal, componentCostPerOutput, overhead, outputUnitCost,
        oldAverageCost, newAverageCost, build.sourceLineId ?? null],
    );
    const itemId = Number(itemResult.insertId);
    itemIds.push(itemId);

    if (input.sourceType === 'sales_order' && Number(input.sourceId) > 0 && Number(build.sourceLineId) > 0) {
      await connection.execute(
        `UPDATE ims_product_build_requirements
            SET state = 'completed', linked_build_item_id = ?, resolved_at = NOW()
          WHERE business_id = ? AND sales_order_id = ? AND sales_order_item_id = ? AND state = 'open'`,
        [itemId, input.businessId, Number(input.sourceId), Number(build.sourceLineId)],
      );
    }

    for (const [index, component] of recipe.components.entries()) {
      const consumed = positiveBuildQuantity(quantity * component.quantityPerOutput, 'Component quantity');
      const stock = stocks.location.get(component.variantId)!;
      const after = Number(stock.qty_on_hand) - consumed;
      await connection.execute(
        `UPDATE ims_stock SET qty_on_hand = ?
          WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
        [after, input.businessId, component.variantId, input.locationId],
      );
      stock.qty_on_hand = after;
      stocks.organizationQty.set(component.variantId, Number(stocks.organizationQty.get(component.variantId) ?? 0) - consumed);
      const componentCost = Number(component.averageCost ?? 0);
      await connection.execute(
        `INSERT INTO ims_product_build_item_components
           (business_id, build_item_id, component_variant_id, quantity_per_output,
            quantity_consumed, component_avg_cost, component_cost_total, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, itemId, component.variantId, component.quantityPerOutput, consumed,
          componentCost, consumed * componentCost, index],
      );
      await connection.execute(
        `INSERT INTO ims_stock_movements
           (business_id, variant_id, location_id, movement_type, channel, reference_type,
            reference_id, qty_change, qty_after_soh, unit_cost, notes)
         VALUES (?, ?, ?, 'build_component_consumed', ?, 'product_build', ?, ?, ?, ?, ?)`,
        [input.businessId, component.variantId, input.locationId, input.sourceChannel, itemId,
          -consumed, after, componentCost, buildNumber],
      );
    }

    const outputAfter = Number(outputStock.qty_on_hand) + quantity;
    await connection.execute(
      `UPDATE ims_stock SET qty_on_hand = ?
        WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
      [outputAfter, input.businessId, build.outputVariantId, input.locationId],
    );
    outputStock.qty_on_hand = outputAfter;
    stocks.organizationQty.set(build.outputVariantId, oldOrganizationQty + quantity);
    outputVariant.avg_cost = newAverageCost;
    await setOrganizationAverageCost(connection, input.businessId, build.outputVariantId, newAverageCost);
    await connection.execute(
      `INSERT INTO ims_stock_movements
         (business_id, variant_id, location_id, movement_type, channel, reference_type,
          reference_id, qty_change, qty_after_soh, unit_cost, notes)
       VALUES (?, ?, ?, 'build_output_produced', ?, 'product_build', ?, ?, ?, ?, ?)`,
      [input.businessId, build.outputVariantId, input.locationId, input.sourceChannel, itemId,
        quantity, outputAfter, outputUnitCost, buildNumber],
    );
  }
  const shopifyQueued = await queueShopifyVariants(connection, allIds);
  return { batchId, buildNumber, itemIds, touchedVariantIds: allIds, replayed: false, shopifyQueued };
}

async function reportUnexpected(operation: string, input: { businessId: string }, error: unknown, context: Record<string, unknown>) {
  await reportRuntimeIssue({
    businessId: input.businessId,
    source: 'ims_product_builds',
    operation,
    title: operation === 'reverse' ? 'Product build reversal failed' : 'Product build completion failed',
    error,
    context,
  }).catch(() => {});
  if (error && typeof error === 'object') Object.assign(error, { runtimeIssueReported: true });
}

async function refreshAfterCommit(businessId: string, operation: string, variantIds: string[], referenceId: number) {
  try {
    await refreshVariantCache(variantIds);
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_product_builds',
      operation: `${operation}_cache_refresh`,
      title: 'Product build stock cache refresh failed',
      error,
      context: { variantIds },
      reference: { type: operation === 'reverse' ? 'product_build_reversal' : 'product_build', id: referenceId },
    }).catch(() => {});
  }
}

export async function completeProductBuildBatch(input: ProductBuildBatchInput) {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await completeProductBuildInTransaction(connection, input);
    await connection.commit();
    await refreshAfterCommit(input.businessId, 'complete', result.touchedVariantIds, result.batchId);
    if (input.sourceType === 'sales_order' && Number(input.sourceId) > 0) {
      await recomputeBuildRequirementsSafely({
        businessId: input.businessId,
        salesOrderId: Number(input.sourceId),
        sourceChannel: input.sourceChannel,
      });
    }
    return result;
  } catch (error) {
    await connection.rollback();
    if (!(error instanceof ProductBuildValidationError) && !(error instanceof ProductBuildConflictError)) {
      await reportUnexpected('complete', input, error, { locationId: input.locationId, operationKey: input.operationKey });
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function listProductBuildBatches(
  businessId: string,
  options: { page?: number; pageSize?: number; locationId?: number; status?: string } = {},
) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));
  const offset = (page - 1) * pageSize;
  const filters = ['b.business_id = ?'];
  const params: unknown[] = [businessId];
  if (options.locationId) { filters.push('b.location_id = ?'); params.push(options.locationId); }
  if (options.status) { filters.push('b.status = ?'); params.push(options.status); }
  const connection = await getIMSPool().getConnection();
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT b.*, l.name AS location_name, COUNT(i.id) AS item_count,
              SUM(i.quantity_built) AS quantity_built, SUM(i.quantity_reversed) AS quantity_reversed,
              SUM(i.quantity_built * i.output_unit_cost) AS total_cost
         FROM ims_product_build_batches b
         JOIN ims_locations l ON l.id = b.location_id AND l.business_id = b.business_id
         LEFT JOIN ims_product_build_items i ON i.batch_id = b.id AND i.business_id = b.business_id
        WHERE ${filters.join(' AND ')}
        GROUP BY b.id
        ORDER BY b.completed_at DESC, b.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    const [counts] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ims_product_build_batches b WHERE ${filters.join(' AND ')}`,
      params,
    );
    return { rows, page, pageSize, total: Number(counts[0]?.total ?? 0) };
  } finally {
    connection.release();
  }
}

async function getProductBuildBatchWithConnection(connection: PoolConnection, businessId: string, batchId: number) {
  const [batches] = await connection.execute<RowDataPacket[]>(
    `SELECT b.*, l.name AS location_name
       FROM ims_product_build_batches b
       JOIN ims_locations l ON l.id = b.location_id AND l.business_id = b.business_id
      WHERE b.id = ? AND b.business_id = ? LIMIT 1`,
    [batchId, businessId],
  );
  if (!batches[0]) return null;
  const [items] = await connection.execute<RowDataPacket[]>(
    `SELECT i.*, p.name AS product_name, v.sku
       FROM ims_product_build_items i
       JOIN ims_product_variants v ON v.variant_id = i.output_variant_id AND v.business_id = i.business_id
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = i.business_id
      WHERE i.batch_id = ? AND i.business_id = ? ORDER BY i.id`,
    [batchId, businessId],
  );
  const itemIds = items.map(item => Number(item.id));
  let components: RowDataPacket[] = [];
  let reversals: RowDataPacket[] = [];
  if (itemIds.length) {
    [components] = await connection.execute<RowDataPacket[]>(
      `SELECT c.*, p.name AS product_name, v.sku
         FROM ims_product_build_item_components c
         JOIN ims_product_variants v ON v.variant_id = c.component_variant_id AND v.business_id = c.business_id
         JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = c.business_id
        WHERE c.business_id = ? AND c.build_item_id IN (${itemIds.map(() => '?').join(',')})
        ORDER BY c.build_item_id, c.sort_order, c.id`,
      [businessId, ...itemIds],
    );
    [reversals] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM ims_product_build_reversals
        WHERE business_id = ? AND build_item_id IN (${itemIds.map(() => '?').join(',')})
        ORDER BY reversed_at, id`,
      [businessId, ...itemIds],
    );
  }
  return {
    ...batches[0],
    items: items.map(item => ({
      ...item,
      components: components.filter(component => Number(component.build_item_id) === Number(item.id)),
      reversals: reversals.filter(reversal => Number(reversal.build_item_id) === Number(item.id)),
    })),
  };
}

export async function getProductBuildBatch(businessId: string, batchId: number) {
  const connection = await getIMSPool().getConnection();
  try {
    return await getProductBuildBatchWithConnection(connection, businessId, batchId);
  } finally {
    connection.release();
  }
}

export async function reverseProductBuild(rawInput: ProductBuildReversalInput) {
  const input = {
    ...rawInput,
    operationKey: operationKey(rawInput.operationKey),
    quantity: positiveBuildQuantity(rawInput.quantity, 'Reversal quantity'),
    reason: String(rawInput.reason ?? '').trim(),
  };
  if (!input.reason) throw new ProductBuildValidationError('A reversal reason is required.');
  const requestHash = hashProductBuildRequest({
    businessId: input.businessId,
    buildItemId: input.buildItemId,
    quantity: input.quantity,
    reason: input.reason,
  });
  const connection = await getIMSPool().getConnection();
  let touchedVariantIds: string[] = [];
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM ims_product_build_reversals
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, input.operationKey],
    );
    if (existing[0]) {
      if (String(existing[0].request_hash) !== requestHash) {
        throw new ProductBuildConflictError('This operation key was already used for a different reversal.', 'product_build_reversal_idempotency_conflict');
      }
      await connection.commit();
      return { reversalId: Number(existing[0].id), reversalNumber: existing[0].reversal_number, replayed: true };
    }
    const [items] = await connection.execute<RowDataPacket[]>(
      `SELECT i.*, b.location_id, b.source_channel, b.status AS batch_status
         FROM ims_product_build_items i
         JOIN ims_product_build_batches b ON b.id = i.batch_id AND b.business_id = i.business_id
        WHERE i.id = ? AND i.business_id = ? FOR UPDATE`,
      [input.buildItemId, input.businessId],
    );
    const item = items[0];
    if (!item) throw new ProductBuildConflictError('Product build item not found.', 'product_build_not_found');
    const [componentRows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM ims_product_build_item_components
        WHERE business_id = ? AND build_item_id = ? ORDER BY component_variant_id FOR UPDATE`,
      [input.businessId, input.buildItemId],
    );
    const componentQuantities = calculateReversalComponents(
      input.quantity,
      Number(item.quantity_built),
      Number(item.quantity_reversed),
      componentRows.map(component => ({
        variantId: String(component.component_variant_id),
        quantityPerOutput: Number(component.quantity_per_output),
      })),
    );
    touchedVariantIds = [...new Set([String(item.output_variant_id), ...componentQuantities.map(component => component.variantId)])].sort();
    const variants = await loadVariants(connection, input.businessId, touchedVariantIds, true);
    const stocks = await ensureAndLoadStock(connection, input.businessId, Number(item.location_id), touchedVariantIds, true);
    const outputStock = stocks.location.get(String(item.output_variant_id))!;
    const outputAvailable = Number(outputStock.qty_on_hand) - Number(outputStock.qty_committed);
    if (outputAvailable + 0.00005 < input.quantity) {
      throw new ProductBuildConflictError('Available finished stock is insufficient for this reversal.', 'product_build_reversal_stock_shortage', {
        available: outputAvailable,
        required: input.quantity,
      });
    }
    const outputVariant = variants.get(String(item.output_variant_id))!;
    const outputAverageBefore = Number(outputVariant.avg_cost ?? 0);
    const outputAverageAfter = computeAverageCostAfterReversal({
      currentQtyOnHand: Number(stocks.organizationQty.get(String(item.output_variant_id)) ?? 0),
      currentAvgCost: outputAverageBefore,
      reversedQty: input.quantity,
      reversedUnitCostAud: Number(item.output_unit_cost),
    });
    const [reversalResult] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO ims_product_build_reversals
         (business_id, reversal_number, build_item_id, quantity_reversed, reason, operation_key,
          request_hash, output_avg_cost_before, output_avg_cost_after, actor_id, actor_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.businessId, `PENDING-${requestHash.slice(0, 32)}`, input.buildItemId, input.quantity, input.reason,
        input.operationKey, requestHash, outputAverageBefore, outputAverageAfter, input.actorId ?? null, input.actorName ?? null],
    );
    if (!reversalResult.insertId) {
      const [winnerRows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM ims_product_build_reversals
          WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
        [input.businessId, input.operationKey],
      );
      const winner = winnerRows[0];
      if (!winner || String(winner.request_hash) !== requestHash) {
        throw new ProductBuildConflictError('This operation key was already used for a different reversal.', 'product_build_reversal_idempotency_conflict');
      }
      await connection.commit();
      return { reversalId: Number(winner.id), reversalNumber: winner.reversal_number, replayed: true };
    }
    const reversalId = Number(reversalResult.insertId);
    const reversalNumber = `REV-${String(reversalId).padStart(8, '0')}`;
    await connection.execute(
      `UPDATE ims_product_build_reversals SET reversal_number = ? WHERE id = ? AND business_id = ?`,
      [reversalNumber, reversalId, input.businessId],
    );

    const outputAfter = Number(outputStock.qty_on_hand) - input.quantity;
    await connection.execute(
      `UPDATE ims_stock SET qty_on_hand = ? WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
      [outputAfter, input.businessId, item.output_variant_id, item.location_id],
    );
    await setOrganizationAverageCost(connection, input.businessId, String(item.output_variant_id), outputAverageAfter);
    await connection.execute(
      `INSERT INTO ims_stock_movements
         (business_id, variant_id, location_id, movement_type, channel, reference_type,
          reference_id, qty_change, qty_after_soh, unit_cost, notes)
       VALUES (?, ?, ?, 'build_output_reversed', ?, 'product_build_reversal', ?, ?, ?, ?, ?)`,
      [input.businessId, item.output_variant_id, item.location_id, item.source_channel, reversalId,
        -input.quantity, outputAfter, item.output_unit_cost, input.reason],
    );

    for (const restored of componentQuantities) {
      const snapshot = componentRows.find(component => String(component.component_variant_id) === restored.variantId)!;
      const stock = stocks.location.get(restored.variantId)!;
      const variant = variants.get(restored.variantId)!;
      const oldOrganizationQty = Number(stocks.organizationQty.get(restored.variantId) ?? 0);
      const oldAverageCost = Number(variant.avg_cost ?? 0);
      const capturedCost = Number(snapshot.component_avg_cost);
      const newAverageCost = computeWeightedAverageCost({
        oldQtyOnHand: oldOrganizationQty,
        oldAvgCost: oldAverageCost,
        receivedQty: restored.quantity,
        receivedUnitCostAud: capturedCost,
      });
      const componentAfter = Number(stock.qty_on_hand) + restored.quantity;
      await connection.execute(
        `UPDATE ims_stock SET qty_on_hand = ? WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
        [componentAfter, input.businessId, restored.variantId, item.location_id],
      );
      await setOrganizationAverageCost(connection, input.businessId, restored.variantId, newAverageCost);
      await connection.execute(
        `INSERT INTO ims_stock_movements
           (business_id, variant_id, location_id, movement_type, channel, reference_type,
            reference_id, qty_change, qty_after_soh, unit_cost, notes)
         VALUES (?, ?, ?, 'build_component_restored', ?, 'product_build_reversal', ?, ?, ?, ?, ?)`,
        [input.businessId, restored.variantId, item.location_id, item.source_channel, reversalId,
          restored.quantity, componentAfter, capturedCost, input.reason],
      );
    }
    await connection.execute(
      `UPDATE ims_product_build_items SET quantity_reversed = quantity_reversed + ?
        WHERE id = ? AND business_id = ?`,
      [input.quantity, input.buildItemId, input.businessId],
    );
    const [remaining] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS remaining,
              SUM(CASE WHEN quantity_reversed > 0 THEN 1 ELSE 0 END) AS affected
         FROM ims_product_build_items
        WHERE batch_id = ? AND business_id = ? AND quantity_reversed + 0.00005 < quantity_built`,
      [item.batch_id, input.businessId],
    );
    const status = Number(remaining[0]?.remaining ?? 0) === 0
      ? 'reversed'
      : 'partially_reversed';
    await connection.execute(
      `UPDATE ims_product_build_batches SET status = ? WHERE id = ? AND business_id = ?`,
      [status, item.batch_id, input.businessId],
    );
    const shopifyQueued = await queueShopifyVariants(connection, touchedVariantIds);
    await connection.commit();
    await refreshAfterCommit(input.businessId, 'reverse', touchedVariantIds, reversalId);
    return { reversalId, reversalNumber, buildItemId: input.buildItemId, quantity: input.quantity, replayed: false, shopifyQueued };
  } catch (error) {
    await connection.rollback();
    if (!(error instanceof ProductBuildValidationError) && !(error instanceof ProductBuildConflictError) && !(error instanceof RangeError)) {
      await reportUnexpected('reverse', input, error, { buildItemId: input.buildItemId, operationKey: input.operationKey });
    }
    throw error;
  } finally {
    connection.release();
  }
}