import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { getIMSPool } from '@/services/IMSMySQLService';
import {
  assertAcyclicBuildRecipes,
  positiveBuildQuantity,
  ProductBuildValidationError,
  validateBuildRecipe,
  type BuildRecipe,
} from './domain';

export class ProductBuildRecipeConflictError extends Error {
  readonly code = 'product_build_recipe_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'ProductBuildRecipeConflictError';
  }
}

export interface SaveProductBuildRecipeInput {
  businessId: string;
  productId: string;
  outputVariantId: string;
  components: Array<{ variantId: string; quantityPerOutput: number }>;
  baseOutputQuantity?: number;
  overheadPerOutput?: number;
  notes?: string | null;
  isEnabled?: boolean;
  expectedRevision?: number | null;
  actorId?: number | null;
  actorName?: string | null;
}

export interface ProductBuildRecipeDetail {
  id: number;
  businessId: string;
  productId: string;
  productName: string;
  outputVariantId: string;
  outputSku: string | null;
  outputLabel: string;
  isEnabled: boolean;
  revision: number;
  versionId: number;
  baseOutputQuantity: number;
  overheadPerOutput: number;
  notes: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  components: Array<{
    variantId: string;
    productId: string;
    productName: string;
    sku: string | null;
    label: string;
    quantityPerOutput: number;
    averageCost: number;
    sortOrder: number;
  }>;
}

interface RecipeHeaderRow extends RowDataPacket {
  id: number;
  business_id: string;
  output_variant_id: string;
  active_version_id: number;
  is_enabled: number;
  product_id: string;
  product_name: string;
  output_sku: string | null;
  output_label: string;
  revision: number;
  base_output_quantity: number;
  overhead_per_output: number;
  notes: string | null;
  created_by: number | null;
  created_by_name: string | null;
  version_created_at: string;
}

interface RecipeComponentRow extends RowDataPacket {
  recipe_version_id: number;
  component_variant_id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  component_label: string;
  quantity_per_output: number;
  average_cost: number;
  sort_order: number;
}

function headerSelect(extraWhere = ''): string {
  return `SELECT r.id, r.business_id, r.output_variant_id, r.active_version_id, r.is_enabled,
                 p.product_id, p.name AS product_name, v.sku AS output_sku,
                 CONCAT_WS(' / ', p.name, NULLIF(CONCAT_WS(' / ', v.option1_value, v.option2_value, v.option3_value), '')) AS output_label,
                 rv.revision, rv.base_output_quantity, rv.overhead_per_output, rv.notes,
                 rv.created_by, rv.created_by_name, rv.created_at AS version_created_at
            FROM ims_product_build_recipes r
            JOIN ims_product_build_recipe_versions rv
              ON rv.id = r.active_version_id AND rv.business_id = r.business_id
            JOIN ims_product_variants v
              ON v.variant_id = r.output_variant_id AND v.business_id = r.business_id
            JOIN ims_products p
              ON p.product_id = v.product_id AND p.business_id = r.business_id
           WHERE r.business_id = ? ${extraWhere}`;
}

async function loadComponents(
  connection: PoolConnection,
  businessId: string,
  versionIds: number[],
): Promise<Map<number, RecipeComponentRow[]>> {
  if (!versionIds.length) return new Map();
  const [rows] = await connection.execute<RecipeComponentRow[]>(
    `SELECT c.recipe_version_id, c.component_variant_id, c.quantity_per_output, c.sort_order,
            v.product_id, v.sku,
            COALESCE(NULLIF(v.avg_cost, 0), NULLIF(v.cost_aud, 0), 0) AS average_cost,
            p.name AS product_name,
            CONCAT_WS(' / ', p.name, NULLIF(CONCAT_WS(' / ', v.option1_value, v.option2_value, v.option3_value), '')) AS component_label
       FROM ims_product_build_recipe_components c
       JOIN ims_product_variants v
         ON v.variant_id = c.component_variant_id AND v.business_id = c.business_id
       JOIN ims_products p
         ON p.product_id = v.product_id AND p.business_id = c.business_id
      WHERE c.business_id = ? AND c.recipe_version_id IN (${versionIds.map(() => '?').join(',')})
      ORDER BY c.recipe_version_id, c.sort_order, c.id`,
    [businessId, ...versionIds],
  );
  const grouped = new Map<number, RecipeComponentRow[]>();
  for (const row of rows) grouped.set(Number(row.recipe_version_id), [...(grouped.get(Number(row.recipe_version_id)) ?? []), row]);
  return grouped;
}

function toDetail(header: RecipeHeaderRow, components: RecipeComponentRow[]): ProductBuildRecipeDetail {
  return {
    id: Number(header.id),
    businessId: header.business_id,
    productId: header.product_id,
    productName: header.product_name,
    outputVariantId: header.output_variant_id,
    outputSku: header.output_sku,
    outputLabel: header.output_label,
    isEnabled: Boolean(header.is_enabled),
    revision: Number(header.revision),
    versionId: Number(header.active_version_id),
    baseOutputQuantity: Number(header.base_output_quantity),
    overheadPerOutput: Number(header.overhead_per_output),
    notes: header.notes,
    createdBy: header.created_by == null ? null : Number(header.created_by),
    createdByName: header.created_by_name,
    createdAt: header.version_created_at,
    components: components.map(component => ({
      variantId: component.component_variant_id,
      productId: component.product_id,
      productName: component.product_name,
      sku: component.sku,
      label: component.component_label,
      quantityPerOutput: Number(component.quantity_per_output),
      averageCost: Number(component.average_cost),
      sortOrder: Number(component.sort_order),
    })),
  };
}

async function listWithConnection(
  connection: PoolConnection,
  businessId: string,
  productId?: string,
): Promise<ProductBuildRecipeDetail[]> {
  const [headers] = await connection.execute<RecipeHeaderRow[]>(
    `${headerSelect(productId ? 'AND p.product_id = ?' : '')} ORDER BY p.name, v.sku, r.id`,
    productId ? [businessId, productId] : [businessId],
  );
  const components = await loadComponents(connection, businessId, headers.map(row => Number(row.active_version_id)));
  return headers.map(header => toDetail(header, components.get(Number(header.active_version_id)) ?? []));
}

export async function listProductBuildRecipes(
  businessId: string,
  options: { productId?: string; enabledOnly?: boolean } = {},
): Promise<ProductBuildRecipeDetail[]> {
  const connection = await getIMSPool().getConnection();
  try {
    const recipes = await listWithConnection(connection, businessId, options.productId);
    return options.enabledOnly ? recipes.filter(recipe => recipe.isEnabled) : recipes;
  } finally {
    connection.release();
  }
}

export async function getProductBuildRecipe(
  businessId: string,
  outputVariantId: string,
): Promise<ProductBuildRecipeDetail | null> {
  const connection = await getIMSPool().getConnection();
  try {
    const [headers] = await connection.execute<RecipeHeaderRow[]>(
      `${headerSelect('AND r.output_variant_id = ?')} LIMIT 1`,
      [businessId, outputVariantId],
    );
    if (!headers[0]) return null;
    const components = await loadComponents(connection, businessId, [Number(headers[0].active_version_id)]);
    return toDetail(headers[0], components.get(Number(headers[0].active_version_id)) ?? []);
  } finally {
    connection.release();
  }
}

async function assertStockVariants(
  connection: PoolConnection,
  input: SaveProductBuildRecipeInput,
  componentIds: string[],
): Promise<void> {
  const ids = [input.outputVariantId, ...componentIds];
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT v.variant_id, v.product_id, v.is_active AS variant_active,
            p.is_active AS product_active, p.is_stock_item
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = v.business_id
      WHERE v.business_id = ? AND v.variant_id IN (${ids.map(() => '?').join(',')})`,
    [input.businessId, ...ids],
  );
  const byId = new Map(rows.map(row => [String(row.variant_id), row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new ProductBuildValidationError(`Variant ${id} was not found for this business.`);
    if (!Number(row.variant_active) || !Number(row.product_active) || !Number(row.is_stock_item)) {
      throw new ProductBuildValidationError(`Variant ${id} must be an active stock item.`);
    }
  }
  if (String(byId.get(input.outputVariantId)?.product_id) !== input.productId) {
    throw new ProductBuildValidationError('The output variant does not belong to this product.');
  }
}

async function assertActiveGraphAcyclic(
  connection: PoolConnection,
  businessId: string,
  proposed: BuildRecipe,
  enabled: boolean,
): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT r.output_variant_id, rv.revision, c.component_variant_id, c.quantity_per_output
       FROM ims_product_build_recipes r
       JOIN ims_product_build_recipe_versions rv
         ON rv.id = r.active_version_id AND rv.business_id = r.business_id
       JOIN ims_product_build_recipe_components c
         ON c.recipe_version_id = rv.id AND c.business_id = r.business_id
      WHERE r.business_id = ? AND r.is_enabled = 1 AND r.output_variant_id <> ?
      ORDER BY r.output_variant_id, c.sort_order, c.id`,
    [businessId, proposed.outputVariantId],
  );
  const graph = new Map<string, BuildRecipe>();
  for (const row of rows) {
    const outputVariantId = String(row.output_variant_id);
    const current = graph.get(outputVariantId) ?? {
      outputVariantId,
      revision: Number(row.revision),
      components: [],
    };
    current.components.push({
      variantId: String(row.component_variant_id),
      quantityPerOutput: Number(row.quantity_per_output),
    });
    graph.set(outputVariantId, current);
  }
  if (enabled) graph.set(proposed.outputVariantId, proposed);
  assertAcyclicBuildRecipes([...graph.values()]);
}

export async function saveProductBuildRecipe(input: SaveProductBuildRecipeInput): Promise<ProductBuildRecipeDetail> {
  const baseOutputQuantity = positiveBuildQuantity(input.baseOutputQuantity ?? 1, 'Base output quantity');
  const normalized = validateBuildRecipe({
    outputVariantId: String(input.outputVariantId ?? '').trim(),
    revision: 1,
    overheadPerOutput: Number(input.overheadPerOutput ?? 0),
    components: input.components,
  });
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    await assertStockVariants(connection, input, normalized.components.map(component => component.variantId));
    const [existingRows] = await connection.execute<RowDataPacket[]>(
      `SELECT r.id, r.active_version_id, rv.revision
         FROM ims_product_build_recipes r
         LEFT JOIN ims_product_build_recipe_versions rv
           ON rv.id = r.active_version_id AND rv.business_id = r.business_id
        WHERE r.business_id = ? AND r.output_variant_id = ? FOR UPDATE`,
      [input.businessId, normalized.outputVariantId],
    );
    const existing = existingRows[0];
    const currentRevision = Number(existing?.revision ?? 0);
    if (input.expectedRevision != null && Number(input.expectedRevision) !== currentRevision) {
      throw new ProductBuildRecipeConflictError('The recipe changed after it was loaded. Refresh and try again.');
    }
    const revision = currentRevision + 1;
    await assertActiveGraphAcyclic(connection, input.businessId, { ...normalized, revision }, input.isEnabled !== false);

    let recipeId = Number(existing?.id ?? 0);
    if (!recipeId) {
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO ims_product_build_recipes
           (business_id, output_variant_id, is_enabled, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?)`,
        [input.businessId, normalized.outputVariantId, input.isEnabled === false ? 0 : 1, input.actorId ?? null, input.actorName ?? null],
      );
      recipeId = Number(result.insertId);
    }
    const [versionResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO ims_product_build_recipe_versions
         (business_id, recipe_id, revision, base_output_quantity, overhead_per_output, notes, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.businessId, recipeId, revision, baseOutputQuantity, normalized.overheadPerOutput ?? 0,
        String(input.notes ?? '').trim() || null, input.actorId ?? null, input.actorName ?? null],
    );
    const versionId = Number(versionResult.insertId);
    for (const [index, component] of normalized.components.entries()) {
      await connection.execute(
        `INSERT INTO ims_product_build_recipe_components
           (business_id, recipe_version_id, component_variant_id, quantity_per_output, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [input.businessId, versionId, component.variantId, component.quantityPerOutput, index],
      );
    }
    await connection.execute(
      `UPDATE ims_product_build_recipes
          SET active_version_id = ?, is_enabled = ?
        WHERE id = ? AND business_id = ?`,
      [versionId, input.isEnabled === false ? 0 : 1, recipeId, input.businessId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const saved = await getProductBuildRecipe(input.businessId, normalized.outputVariantId);
  if (!saved) throw new Error('Saved product build recipe could not be reloaded.');
  return saved;
}