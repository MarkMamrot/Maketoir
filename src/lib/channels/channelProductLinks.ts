import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { getShopifyChannelAdminCredentials } from '@/lib/shopifyCredentials';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

import type { SalesChannelInstance } from './types';

export interface ChannelProductLinks {
  storefrontUrl: string | null;
  adminUrl: string | null;
}

async function externalProductIds(input: {
  businessId: string;
  channelInstanceId: string;
  productId: string;
}): Promise<string[]> {
  const rows = await imsQuery<{ external_product_id: string | null }>(
    `SELECT DISTINCT mapping.external_product_id
       FROM ims_sales_channel_product_mappings mapping
       JOIN ims_product_variants variant
         ON BINARY variant.business_id = BINARY mapping.business_id AND variant.variant_id = mapping.variant_id
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND variant.product_id = ?
        AND mapping.mapping_status = 'linked' AND mapping.external_product_id IS NOT NULL`,
    [input.businessId, input.channelInstanceId, input.productId],
  );
  return [...new Set(rows.map(row => String(row.external_product_id ?? '').trim()).filter(Boolean))];
}

export async function getChannelProductLinks(input: {
  businessId: string;
  productId: string;
  instance: SalesChannelInstance;
}): Promise<ChannelProductLinks> {
  if (input.instance.provider === 'native_shop') {
    const [profile, publications] = await Promise.all([
      OnlineShopProfileRepository.getByBusinessId(input.businessId),
      imsQuery<{ slug: string | null }>(
        `SELECT slug FROM ims_online_shop_products
          WHERE business_id = ? AND product_id = ? LIMIT 1`,
        [input.businessId, input.productId],
      ),
    ]);
    const productSlug = String(publications[0]?.slug ?? '').trim();
    return {
      storefrontUrl: profile?.slug && productSlug
        ? `/shop/${encodeURIComponent(profile.slug)}/products/${encodeURIComponent(productSlug)}`
        : null,
      adminUrl: '/ims#online-shop',
    };
  }

  const productIds = await externalProductIds({ ...input, channelInstanceId: input.instance.channelInstanceId });
  if (productIds.length !== 1) return { storefrontUrl: null, adminUrl: null };
  const externalProductId = productIds[0];
  if (input.instance.provider === 'amazon') {
    return { storefrontUrl: `https://www.amazon.com.au/dp/${encodeURIComponent(externalProductId)}`, adminUrl: null };
  }

  const credentials = await getShopifyChannelAdminCredentials(input.businessId, input.instance.channelInstanceId);
  if (!credentials) return { storefrontUrl: null, adminUrl: null };
  const service = new ShopifyService(credentials.shopDomain, credentials.token);
  const product = await service.getProduct(externalProductId).catch(() => null);
  return {
    storefrontUrl: product?.handle ? `https://${credentials.shopDomain}/products/${encodeURIComponent(product.handle)}` : null,
    adminUrl: `https://admin.shopify.com/store/${encodeURIComponent(credentials.shopName)}/products/${encodeURIComponent(externalProductId)}`,
  };
}