import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ShopifyOrderReviewRequiredError } from '@/lib/ims/shopifyOrderReview';

type ShopifyOrderLine = Record<string, unknown>;
type OrderVariantMapping = { external_variant_id: string; variant_id: string };

export async function loadShopifyOrderMappings(
  connection: PoolConnection, businessId: string, channelInstanceId: string,
): Promise<OrderVariantMapping[]> {
  const [rows] = await connection.execute<Array<OrderVariantMapping & RowDataPacket>>(
    `SELECT m.external_variant_id, m.variant_id FROM ims_sales_channel_product_mappings m
       JOIN ims_product_variants v ON v.variant_id = m.variant_id AND v.business_id = m.business_id
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = m.business_id
      WHERE m.business_id = ? AND m.channel_instance_id = ?
        AND m.mapping_status = 'linked' AND m.variant_id IS NOT NULL
      FOR SHARE`,
    [businessId, channelInstanceId],
  );
  return rows;
}

export function assertShopifyOrderLineMappings(
  lines: ShopifyOrderLine[],
  mappings: OrderVariantMapping[],
): void {
  const variants = new Map<string, string>();
  for (const mapping of mappings) {
    const externalId = String(mapping.external_variant_id);
    if (variants.has(externalId)) throw new ShopifyOrderReviewRequiredError(
      'ambiguous_variant_mapping', `Shopify variant ${externalId} has ambiguous linked mappings.`,
    );
    variants.set(externalId, String(mapping.variant_id));
  }
  for (const line of lines) {
    if (line.gift_card || Math.max(Number(line.quantity ?? 0), Number(line.current_quantity ?? 0)) <= 0) continue;
    const externalId = String(line.variant_id ?? '').trim();
    if (line.variant_inventory_management !== null
      && (externalId || line.variant_inventory_management === 'shopify') && !variants.has(externalId)) {
      throw new ShopifyOrderReviewRequiredError(
        'missing_variant_mapping', `Shopify variant ${externalId || '(missing)'} requires an exact linked mapping before stock can be applied.`,
      );
    }
  }
  const lineIds = lines.map(line => optionalText(line.id));
  if (lineIds.some(id => !id) || new Set(lineIds).size !== lineIds.length) {
    throw new ShopifyOrderReviewRequiredError(
      'invalid_source_line_identity', 'Shopify source line identities must be present and unique.',
    );
  }
}

export type UnmappedShopifyOrderLine = {
  externalOrderItemId: string | null;
  externalProductId: string | null;
  externalVariantId: string;
  sku: string | null;
  title: string | null;
};

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function unmappedTrackedShopifyOrderLines(
  lines: ShopifyOrderLine[],
  mappedExternalVariantIds: ReadonlySet<string>,
): UnmappedShopifyOrderLine[] {
  return lines
    .filter(line => !line?.gift_card && line?.variant_inventory_management === 'shopify')
    .filter(line => !mappedExternalVariantIds.has(String(line?.variant_id ?? '')))
    .map(line => ({
      externalOrderItemId: optionalText(line.id),
      externalProductId: optionalText(line.product_id),
      externalVariantId: String(line.variant_id ?? '').trim(),
      sku: optionalText(line.sku),
      title: optionalText(line.name ?? line.title),
    }));
}

export async function reportUnmappedShopifyOrderLines(input: {
  businessId: string;
  channelInstanceId: string;
  externalOrderId: string;
  externalOrderName: string | null;
  lines: UnmappedShopifyOrderLine[];
}): Promise<void> {
  if (input.lines.length === 0) return;
  await reportRuntimeIssue({
    businessId: input.businessId,
    source: 'shopify_order_import',
    operation: 'unmapped_catalogue_line',
    severity: 'warning',
    title: 'Shopify order used the miscellaneous fallback item',
    error: new Error('A tracked Shopify catalogue variant has no linked Solvantis variant.'),
    reference: { type: 'shopify_order', id: input.externalOrderId },
    context: {
      channelInstanceId: input.channelInstanceId,
      externalOrderId: input.externalOrderId,
      externalOrderName: input.externalOrderName,
      lines: input.lines,
    },
  });
}