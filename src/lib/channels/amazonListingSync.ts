import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import type { AmazonListingItem } from './amazonSpApi';

interface VariantRow { variant_id: string; sku: string | null }
interface MappingRow { external_variant_id: string; variant_id: string | null }

export type AmazonListingMappingStatus = 'linked' | 'unmatched' | 'conflict';

export function matchAmazonListingSku(
  skuInput: unknown,
  variants: VariantRow[],
): { variantId: string | null; status: AmazonListingMappingStatus } {
  const sku = String(skuInput ?? '').trim().toLocaleLowerCase('en-AU');
  if (!sku) return { variantId: null, status: 'unmatched' };
  const matches = variants.filter(variant => String(variant.sku ?? '').trim().toLocaleLowerCase('en-AU') === sku);
  if (matches.length === 1) return { variantId: matches[0].variant_id, status: 'linked' };
  return { variantId: null, status: matches.length > 1 ? 'conflict' : 'unmatched' };
}

export async function syncAmazonListingMappings(input: {
  businessId: string;
  channelInstanceId: string;
  items: AmazonListingItem[];
}): Promise<{ linked: number; unmatched: number; conflicts: number }> {
  const variants = await imsQuery<VariantRow>(
    `SELECT variant_id, sku FROM ims_product_variants WHERE business_id = ? AND is_active = 1`,
    [input.businessId],
  );
  const mappings = await imsQuery<MappingRow>(
    `SELECT external_variant_id, variant_id
       FROM ims_sales_channel_product_mappings
      WHERE business_id = ? AND channel_instance_id = ?`,
    [input.businessId, input.channelInstanceId],
  );
  const existing = new Map(mappings.map(mapping => [mapping.external_variant_id, mapping.variant_id]));
  const variantIds = new Set(variants.map(variant => variant.variant_id));
  let linked = 0;
  let unmatched = 0;
  let conflicts = 0;
  for (const item of input.items) {
    const sellerSku = String(item.sku ?? '').trim();
    if (!sellerSku) continue;
    const retainedVariantId = existing.get(sellerSku);
    const match = retainedVariantId && variantIds.has(retainedVariantId)
      ? { variantId: retainedVariantId, status: 'linked' as const }
      : matchAmazonListingSku(sellerSku, variants);
    const summary = item.summaries?.[0];
    await imsExecute(
      `INSERT INTO ims_sales_channel_product_mappings
         (business_id, channel_instance_id, variant_id, external_product_id, external_variant_id,
          mapping_status, metadata_json, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE variant_id = VALUES(variant_id), external_product_id = VALUES(external_product_id),
         mapping_status = VALUES(mapping_status), metadata_json = VALUES(metadata_json),
         last_seen_at = VALUES(last_seen_at), updated_at = CURRENT_TIMESTAMP(3)`,
      [input.businessId, input.channelInstanceId, match.variantId, String(summary?.asin ?? '').trim() || null,
        sellerSku, match.status, JSON.stringify({ itemName: summary?.itemName ?? null, statuses: summary?.status ?? [],
          issues: item.issues ?? [], fulfillmentAvailability: item.fulfillmentAvailability ?? [] })],
    );
    if (match.status === 'linked') linked++;
    else if (match.status === 'conflict') conflicts++;
    else unmatched++;
  }
  return { linked, unmatched, conflicts };
}