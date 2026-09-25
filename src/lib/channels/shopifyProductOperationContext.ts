import { imsQuery } from '@/services/IMSMySQLService';

import { getShopifyOperationContext, type ShopifyOperationContext } from './shopifyOperationContext';

export class ShopifyProductOwnershipError extends Error {}

export async function getShopifyProductOperationContext(input: {
  businessId: string;
  productId: string;
  channelInstanceId?: string | null;
}): Promise<ShopifyOperationContext & { externalProductId: string }> {
  const requestedInstanceId = String(input.channelInstanceId ?? '').trim();
  const rows = await imsQuery<{ channel_instance_id: string; external_product_id: string }>(
    `SELECT DISTINCT mapping.channel_instance_id, mapping.external_product_id
       FROM ims_sales_channel_product_mappings mapping
       JOIN ims_product_variants variant
         ON BINARY variant.business_id = BINARY mapping.business_id AND variant.variant_id = mapping.variant_id
      WHERE mapping.business_id = ? AND variant.product_id = ?
        AND mapping.mapping_status = 'linked' AND mapping.external_product_id IS NOT NULL
        ${requestedInstanceId ? 'AND mapping.channel_instance_id = ?' : ''}`,
    requestedInstanceId
      ? [input.businessId, input.productId, requestedInstanceId]
      : [input.businessId, input.productId],
  );
  const owners = [...new Map(rows.map(row => [
    `${row.channel_instance_id}:${row.external_product_id}`,
    { channelInstanceId: String(row.channel_instance_id), externalProductId: String(row.external_product_id) },
  ])).values()];
  if (owners.length === 0) throw new ShopifyProductOwnershipError('This product is not mapped to the selected Shopify storefront.');
  if (owners.length !== 1) throw new ShopifyProductOwnershipError('This product is mapped to multiple Shopify storefronts. Select one explicitly.');
  const owner = owners[0];
  if (requestedInstanceId && owner.channelInstanceId !== requestedInstanceId) {
    throw new ShopifyProductOwnershipError('The selected Shopify storefront does not own this product mapping.');
  }
  const context = await getShopifyOperationContext({
    businessId: input.businessId,
    channelInstanceId: owner.channelInstanceId,
  });
  return { ...context, externalProductId: owner.externalProductId };
}

export async function assertShopifyExternalProductOwnership(input: {
  businessId: string;
  channelInstanceId: string;
  externalProductId: string;
  externalVariantId?: string | null;
}): Promise<void> {
  const rows = await imsQuery<{ owned: number }>(
    `SELECT 1 AS owned
       FROM ims_sales_channel_product_mappings
      WHERE business_id = ? AND channel_instance_id = ? AND external_product_id = ?
        AND mapping_status = 'linked'
        ${input.externalVariantId ? 'AND external_variant_id = ?' : ''}
      LIMIT 1`,
    input.externalVariantId
      ? [input.businessId, input.channelInstanceId, input.externalProductId, input.externalVariantId]
      : [input.businessId, input.channelInstanceId, input.externalProductId],
  );
  if (!rows.length) throw new ShopifyProductOwnershipError('The selected Shopify storefront does not own this product mapping.');
}