import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { buildQuantity } from './domain';

interface RequirementSourceLine {
  itemId: number;
  variantId: string;
  orderedQuantity: number;
  fulfilledQuantity: number;
  recipeRevision: number;
}

export interface PlannedBuildRequirement {
  salesOrderItemId: number;
  outputVariantId: string;
  detectedShortfall: number;
  recipeRevision: number;
}

export function planOrderBuildRequirements(input: {
  status: string;
  lines: RequirementSourceLine[];
  stockByVariant: ReadonlyMap<string, { onHand: number; committed: number }>;
}): PlannedBuildRequirement[] {
  const outstandingByVariant = new Map<string, number>();
  for (const line of input.lines) {
    const outstanding = buildQuantity(Math.max(0, Number(line.orderedQuantity) - Number(line.fulfilledQuantity)));
    outstandingByVariant.set(line.variantId, buildQuantity((outstandingByVariant.get(line.variantId) ?? 0) + outstanding));
  }

  const remainingUsable = new Map<string, number>();
  for (const [variantId, orderOutstanding] of outstandingByVariant) {
    const stock = input.stockByVariant.get(variantId) ?? { onHand: 0, committed: 0 };
    const competingCommitment = ['confirmed', 'partially_fulfilled'].includes(input.status)
      ? Math.max(0, Number(stock.committed) - orderOutstanding)
      : Math.max(0, Number(stock.committed));
    remainingUsable.set(variantId, buildQuantity(Math.max(0, Number(stock.onHand) - competingCommitment)));
  }

  const requirements: PlannedBuildRequirement[] = [];
  for (const line of input.lines) {
    const outstanding = buildQuantity(Math.max(0, Number(line.orderedQuantity) - Number(line.fulfilledQuantity)));
    const usable = Math.min(outstanding, remainingUsable.get(line.variantId) ?? 0);
    remainingUsable.set(line.variantId, buildQuantity(Math.max(0, (remainingUsable.get(line.variantId) ?? 0) - usable)));
    const shortfall = buildQuantity(outstanding - usable);
    if (shortfall > 0) {
      requirements.push({
        salesOrderItemId: line.itemId,
        outputVariantId: line.variantId,
        detectedShortfall: shortfall,
        recipeRevision: line.recipeRevision,
      });
    }
  }
  return requirements;
}

export async function recomputeBuildRequirementsForSalesOrder(input: {
  businessId: string;
  salesOrderId: number;
  sourceChannel?: string | null;
}): Promise<PlannedBuildRequirement[]> {
  const orderRows = await imsQuery<{
    id: number; location_id: number; status: string; sales_channel: string | null;
    shopify_order_id: string | null; wholesale_company_id: number | null;
  }>(
    `SELECT id, location_id, status, sales_channel, shopify_order_id, wholesale_company_id
       FROM ims_sales_orders WHERE id = ? AND business_id = ? LIMIT 1`,
    [input.salesOrderId, input.businessId],
  );
  const order = orderRows[0];
  if (!order) throw new Error('Sales order was not found while recomputing build requirements.');

  const lines = await imsQuery<{
    id: number; variant_id: string; qty_ordered: number; qty_fulfilled: number; revision: number;
  }>(
    `SELECT soi.id, soi.variant_id, soi.qty_ordered, soi.qty_fulfilled, rv.revision
       FROM ims_sales_order_items soi
       JOIN ims_product_build_recipes recipe
         ON recipe.business_id = soi.business_id AND recipe.output_variant_id = soi.variant_id AND recipe.is_enabled = 1
       JOIN ims_product_build_recipe_versions rv
         ON rv.id = recipe.active_version_id AND rv.business_id = recipe.business_id
      WHERE soi.business_id = ? AND soi.so_id = ?
      ORDER BY soi.id`,
    [input.businessId, input.salesOrderId],
  );
  const variantIds = [...new Set(lines.map(line => String(line.variant_id)))];
  const stockRows = variantIds.length > 0 ? await imsQuery<{
    variant_id: string; qty_on_hand: number; qty_committed: number;
  }>(
    `SELECT variant_id, qty_on_hand, qty_committed FROM ims_stock
      WHERE business_id = ? AND location_id = ? AND variant_id IN (${variantIds.map(() => '?').join(',')})`,
    [input.businessId, order.location_id, ...variantIds],
  ) : [];
  const requirements = planOrderBuildRequirements({
    status: String(order.status),
    lines: lines.map(line => ({
      itemId: Number(line.id),
      variantId: String(line.variant_id),
      orderedQuantity: Number(line.qty_ordered),
      fulfilledQuantity: Number(line.qty_fulfilled),
      recipeRevision: Number(line.revision),
    })),
    stockByVariant: new Map(stockRows.map(row => [String(row.variant_id), {
      onHand: Number(row.qty_on_hand),
      committed: Number(row.qty_committed),
    }])),
  });
  const sourceChannel = String(input.sourceChannel ?? order.sales_channel
    ?? (order.shopify_order_id ? 'shopify' : order.wholesale_company_id ? 'wholesale' : 'sales_order'));

  for (const requirement of requirements) {
    await imsExecute(
      `INSERT INTO ims_product_build_requirements
         (business_id, sales_order_id, sales_order_item_id, location_id, output_variant_id,
          source_channel, detected_shortfall, state, detected_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         detected_shortfall = VALUES(detected_shortfall), source_channel = VALUES(source_channel),
         detected_at = CASE WHEN state = 'dismissed' THEN detected_at ELSE NOW() END,
         resolved_at = CASE WHEN state = 'dismissed' THEN resolved_at ELSE NULL END,
         linked_build_item_id = CASE WHEN state = 'dismissed' THEN linked_build_item_id ELSE NULL END,
         state = CASE WHEN state = 'dismissed' THEN state ELSE 'open' END`,
      [input.businessId, input.salesOrderId, requirement.salesOrderItemId, order.location_id,
        requirement.outputVariantId, sourceChannel, requirement.detectedShortfall],
    );
  }

  const activeItemIds = requirements.map(requirement => requirement.salesOrderItemId);
  await imsExecute(
    `UPDATE ims_product_build_requirements
        SET state = 'no_longer_needed', resolved_at = NOW()
      WHERE business_id = ? AND sales_order_id = ? AND state = 'open'
        ${activeItemIds.length ? `AND sales_order_item_id NOT IN (${activeItemIds.map(() => '?').join(',')})` : ''}`,
    [input.businessId, input.salesOrderId, ...activeItemIds],
  );
  return requirements;
}

export async function recomputeBuildRequirementsSafely(input: {
  businessId: string;
  salesOrderId: number;
  sourceChannel?: string | null;
}): Promise<PlannedBuildRequirement[]> {
  try {
    return await recomputeBuildRequirementsForSalesOrder(input);
  } catch (error) {
    await reportRuntimeIssue({
      businessId: input.businessId,
      source: 'ims_product_build_requirements',
      operation: 'recompute_sales_order',
      title: 'Order build requirements could not be refreshed',
      error,
      context: { salesOrderId: input.salesOrderId, sourceChannel: input.sourceChannel ?? null },
      reference: { type: 'sales_order', id: input.salesOrderId },
    }).catch(() => {});
    return [];
  }
}

export async function listBuildRequirements(
  businessId: string,
  options: { state?: string; locationId?: number; limit?: number } = {},
) {
  const where = ['requirement.business_id = ?'];
  const params: unknown[] = [businessId];
  if (options.state) { where.push('requirement.state = ?'); params.push(options.state); }
  if (options.locationId) { where.push('requirement.location_id = ?'); params.push(options.locationId); }
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
  params.push(limit);
  return imsQuery(
    `SELECT requirement.*, orders.so_number, products.name AS product_name, variants.sku,
            versions.revision AS current_recipe_revision
       FROM ims_product_build_requirements requirement
       JOIN ims_sales_orders orders ON orders.id = requirement.sales_order_id AND orders.business_id = requirement.business_id
       JOIN ims_product_variants variants ON variants.variant_id = requirement.output_variant_id AND variants.business_id = requirement.business_id
       JOIN ims_products products ON products.product_id = variants.product_id AND products.business_id = requirement.business_id
       LEFT JOIN ims_product_build_recipes recipes ON recipes.output_variant_id = requirement.output_variant_id AND recipes.business_id = requirement.business_id
       LEFT JOIN ims_product_build_recipe_versions versions ON versions.id = recipes.active_version_id
      WHERE ${where.join(' AND ')} ORDER BY requirement.detected_at, requirement.id LIMIT ?`,
    params,
  );
}