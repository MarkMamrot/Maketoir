import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type ShopifyOrderLine = Record<string, any>;

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