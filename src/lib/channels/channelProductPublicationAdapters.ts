import fs from 'fs';
import path from 'path';

import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { deleteAmazonListingOffer, putAmazonExistingAsinOffer } from '@/lib/channels/amazonSpApi';
import type { ChannelProductPublicationAdapter } from '@/lib/channels/channelProductPublication';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import type { SalesChannelProvider } from '@/lib/channels/types';
import { ImsImagesRepo, ImsProductsRepo } from '@/lib/ims/ImsRepository';
import { getOnlinePickLocationIds, pushInventoryForShopifyInstance, shopifyInventoryPolicyPayload, shopifyVariantPricePayload } from '@/lib/ims/shopifyInventorySync';
import { normalizeOnlineShopPageSlug } from '@/lib/onlineShop/onlineShopPages';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

interface NativeProductRow {
  name: string;
  website_title: string | null;
  is_active: number;
  retail_variant_count: number | string;
  slug: string | null;
}

interface ShopifyMappingRow {
  external_product_id: string;
  variant_id: string;
}

interface AmazonOfferRow {
  variant_id: string;
  seller_sku: string;
  asin: string;
  price_rrp: number | string | null;
  is_active: number;
  is_stock_item: number;
}

function blocked(...issues: string[]) {
  return { outcome: 'blocked' as const, issues };
}

function shopifyImagePayload(image: { url: string; source: string; drive_file_id?: string | null; alt_text?: string | null }, businessId: string) {
  if (/\.(mp4|mov|webm)(\?|$)/i.test(`${image.url} ${image.drive_file_id ?? ''}`)) return null;
  if (/^https?:\/\//i.test(image.url)) return { src: image.url, alt: image.alt_text ?? '' };
  if (image.source !== 'volume' || !image.drive_file_id) return null;
  const filePath = path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'product-images', image.drive_file_id);
  if (!fs.existsSync(filePath)) return null;
  return { attachment: fs.readFileSync(filePath).toString('base64'), alt: image.alt_text ?? '' };
}

async function createShopifyProduct(input: Parameters<ChannelProductPublicationAdapter>[0]) {
  const product = await ImsProductsRepo.get(input.productId, input.businessId);
  if (!product) return blocked('Product not found.');
  if (product.is_active !== 1) return blocked('Product is inactive.');
  const variants = (product.variants ?? []).filter(variant => variant.is_active !== 0);
  if (variants.length === 0) return blocked('At least one active variant is required.');
  if (variants.some(variant => Number(variant.price_rrp ?? 0) <= 0)) {
    return blocked('Every active variant requires a positive retail price.');
  }

  const { credentials } = await getShopifyOperationContext({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
  });
  const service = new ShopifyService(credentials.shopDomain, credentials.token);
  const optionNames = [1, 2, 3].flatMap(position => {
    const key = `option${position}_name` as const;
    const name = variants.find(variant => String(variant[key] ?? '').trim())?.[key];
    return name ? [{ name }] : [];
  });
  const shopifyVariants = variants.map(variant => {
    const prices = shopifyVariantPricePayload(variant.price_rrp, variant.price_rrp_sale);
    const payload: Record<string, unknown> = {
      sku: variant.sku ?? '', barcode: variant.barcode ?? undefined,
      ...prices, ...shopifyInventoryPolicyPayload(product.is_stock_item),
      weight: variant.weight_kg ? variant.weight_kg * 1000 : undefined, weight_unit: 'g',
      option1: optionNames.length > 0 ? (variant.option1_value?.trim() || 'Default') : 'Default Title',
    };
    if (optionNames.length > 1) payload.option2 = variant.option2_value?.trim() || 'Default';
    if (optionNames.length > 2) payload.option3 = variant.option3_value?.trim() || 'Default';
    return payload;
  });
  const created = await service.createProduct({
    title: product.website_title?.trim() || product.name,
    body_html: product.description ?? '', vendor: product.brand ?? '', product_type: product.product_type ?? '',
    tags: product.tags ?? '', status: 'draft', variants: shopifyVariants,
    options: optionNames.length > 0 ? optionNames : undefined,
  });
  const externalProductId = String(created?.id ?? '').trim();
  if (!externalProductId || (created?.variants?.length ?? 0) < variants.length) {
    throw new Error('Shopify created an incomplete product response; the Draft listing requires review.');
  }

  for (const [index, variant] of variants.entries()) {
    const externalVariant = created.variants[index];
    await imsExecute(
      `INSERT INTO ims_sales_channel_product_mappings
         (business_id, channel_instance_id, variant_id, external_product_id, external_variant_id,
          external_inventory_id, mapping_status, metadata_json, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 'linked', ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE external_product_id = VALUES(external_product_id),
         external_variant_id = VALUES(external_variant_id), external_inventory_id = VALUES(external_inventory_id),
         mapping_status = 'linked', metadata_json = VALUES(metadata_json), last_seen_at = CURRENT_TIMESTAMP(3),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [input.businessId, input.channelInstanceId, variant.variant_id, externalProductId,
        String(externalVariant.id), String(externalVariant.inventory_item_id ?? '') || null,
        JSON.stringify({ source: 'solvantis_product_publication' })],
    );
  }

  const images = await ImsImagesRepo.list(input.productId);
  for (const image of images) {
    const payload = shopifyImagePayload(image, input.businessId);
    if (!payload) continue;
    try {
      const createdImage = await service.createProductImage(externalProductId, payload);
      if (createdImage?.src) await ImsImagesRepo.updateUrl(image.id, createdImage.src).catch(() => {});
    } catch { /* The product remains linked; a later product sync can retry individual images. */ }
  }
  await pushInventoryForShopifyInstance({
    businessId: input.businessId, channelInstanceId: input.channelInstanceId,
    variantIds: variants.map(variant => variant.variant_id), force: true,
  });
  await service.updateProduct(externalProductId, { status: 'active' });
  return { outcome: 'applied' as const, providerState: 'published' as const, externalProductId };
}

export const publishNativeShopProduct: ChannelProductPublicationAdapter = async input => {
  if (input.desiredState === 'unpublished') {
    await imsExecute(
      `UPDATE ims_online_shop_products SET is_published = 0, published_at = NULL
        WHERE business_id = ? AND product_id = ?`,
      [input.businessId, input.productId],
    );
    return { outcome: 'applied', providerState: 'unpublished', externalProductId: input.productId };
  }
  const rows = await imsQuery<NativeProductRow>(
    `SELECT product.name, product.website_title, product.is_active, publication.slug,
            COUNT(DISTINCT CASE WHEN variant.is_active = 1 AND variant.price_rrp > 0 THEN variant.variant_id END) AS retail_variant_count
       FROM ims_products product
       LEFT JOIN ims_product_variants variant
         ON BINARY variant.business_id = BINARY product.business_id AND variant.product_id = product.product_id
       LEFT JOIN ims_online_shop_products publication
         ON BINARY publication.business_id = BINARY product.business_id AND publication.product_id = product.product_id
      WHERE product.business_id = ? AND product.product_id = ?
      GROUP BY product.product_id, product.name, product.website_title, product.is_active, publication.slug`,
    [input.businessId, input.productId],
  );
  const product = rows[0];
  if (!product) return blocked('Product not found.');
  if (product.is_active !== 1) return blocked('Product is inactive.');
  if (Number(product.retail_variant_count) < 1) return blocked('At least one active variant with a retail price is required.');
  const baseSlug = normalizeOnlineShopPageSlug(product.website_title || product.name) || 'product';
  const slug = product.slug || `${baseSlug.slice(0, 100)}-${input.productId.slice(0, 8).toLowerCase()}`.slice(0, 120);
  await imsExecute(
    `INSERT INTO ims_online_shop_products (business_id, product_id, slug, is_published, published_at)
     VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE is_published = 1, published_at = COALESCE(published_at, CURRENT_TIMESTAMP)`,
    [input.businessId, input.productId, slug],
  );
  return { outcome: 'applied', providerState: 'published', externalProductId: input.productId };
};

export const publishShopifyProduct: ChannelProductPublicationAdapter = async input => {
  const assignments = await imsQuery<{ external_product_id: string | null; readiness_status: string }>(
    `SELECT external_product_id, readiness_status
       FROM ims_sales_channel_product_assignments
      WHERE business_id = ? AND channel_instance_id = ? AND product_id = ? LIMIT 1`,
    [input.businessId, input.channelInstanceId, input.productId],
  );
  if (assignments[0]?.readiness_status === 'blocked') {
    return blocked('Resolve this product publication blocker before changing Shopify status.');
  }
  const mappings = await imsQuery<ShopifyMappingRow>(
    `SELECT mapping.external_product_id, mapping.variant_id
       FROM ims_sales_channel_product_mappings mapping
       JOIN ims_product_variants variant
         ON BINARY variant.business_id = BINARY mapping.business_id
        AND BINARY variant.variant_id = BINARY mapping.variant_id
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND variant.product_id = ?
        AND mapping.mapping_status = 'linked' AND mapping.external_product_id IS NOT NULL`,
    [input.businessId, input.channelInstanceId, input.productId],
  );
  const productIds = [...new Set([
    ...mappings.map(row => String(row.external_product_id).trim()),
    String(assignments[0]?.external_product_id ?? '').trim(),
  ].filter(Boolean))];
  if (productIds.length === 0) {
    return input.desiredState === 'unpublished'
      ? { outcome: 'applied', providerState: 'unpublished' }
      : createShopifyProduct(input);
  }
  if (productIds.length > 1) return blocked('The product maps to more than one Shopify product in this storefront.');
  const { credentials } = await getShopifyOperationContext({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
  });
  const service = new ShopifyService(credentials.shopDomain, credentials.token);
  if (input.desiredState === 'published' && mappings.length > 0) {
    const inventory = await pushInventoryForShopifyInstance({
      businessId: input.businessId,
      channelInstanceId: input.channelInstanceId,
      variantIds: [...new Set(mappings.map(mapping => mapping.variant_id))],
      force: true,
    });
    if (inventory.errors.length > 0) throw new Error(inventory.errors.join('; '));
  }
  await service.updateProduct(productIds[0], { status: input.desiredState === 'published' ? 'active' : 'draft' });
  return { outcome: 'applied', providerState: input.desiredState, externalProductId: productIds[0] };
};

async function amazonAvailability(variantId: string, locationIds: number[]): Promise<number> {
  if (locationIds.length === 0) throw new Error('No online stock locations are configured.');
  const rows = await imsQuery<{ available: number | string | null }>(
    `SELECT COALESCE(SUM(GREATEST(0, qty_on_hand - qty_committed)), 0) AS available
       FROM ims_stock WHERE variant_id = ? AND location_id IN (${locationIds.map(() => '?').join(',')})`,
    [variantId, ...locationIds],
  );
  return Math.max(0, Math.floor(Number(rows[0]?.available ?? 0)));
}

export const publishAmazonExistingAsinOffers: ChannelProductPublicationAdapter = async input => {
  const offers = await imsQuery<AmazonOfferRow>(
    `SELECT mapping.variant_id, mapping.external_variant_id AS seller_sku,
            mapping.external_product_id AS asin, variant.price_rrp, product.is_active, product.is_stock_item
       FROM ims_sales_channel_product_mappings mapping
       JOIN ims_product_variants variant
         ON BINARY variant.business_id = BINARY mapping.business_id AND variant.variant_id = mapping.variant_id
       JOIN ims_products product
         ON BINARY product.business_id = BINARY variant.business_id AND product.product_id = variant.product_id
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND variant.product_id = ?
        AND mapping.mapping_status = 'linked' AND mapping.external_variant_id IS NOT NULL`,
    [input.businessId, input.channelInstanceId, input.productId],
  );
  if (offers.length === 0) {
    return input.desiredState === 'unpublished'
      ? { outcome: 'applied', providerState: 'unpublished' }
      : blocked('Map at least one variant to an existing Amazon ASIN and seller SKU first.');
  }
  if (input.desiredState === 'published') {
    const issues: string[] = [];
    if (offers.some(offer => offer.is_active !== 1)) issues.push('Product is inactive.');
    if (offers.some(offer => offer.is_stock_item !== 1)) issues.push('Amazon seller-fulfilled offers require tracked inventory.');
    if (offers.some(offer => !String(offer.asin ?? '').trim())) issues.push('Every mapped Amazon variant requires an ASIN.');
    if (offers.some(offer => Number(offer.price_rrp ?? 0) <= 0)) issues.push('Every mapped Amazon variant requires a positive retail price.');
    if (issues.length) return blocked(...issues);
  }
  const access = await getAmazonChannelAccess(input.businessId, input.channelInstanceId);
  if (!access) throw new Error('Amazon authorization is missing.');
  const locationIds = input.desiredState === 'published' ? await getOnlinePickLocationIds(input.businessId) : [];
  for (const offer of offers) {
    if (input.desiredState === 'published') {
      await putAmazonExistingAsinOffer(access.accessToken, access.sellerId, {
        sellerSku: offer.seller_sku,
        asin: offer.asin,
        price: Number(offer.price_rrp),
        quantity: await amazonAvailability(offer.variant_id, locationIds),
      });
    } else {
      await deleteAmazonListingOffer(access.accessToken, access.sellerId, offer.seller_sku);
    }
  }
  return { outcome: 'applied', providerState: input.desiredState, externalProductId: offers[0]?.asin ?? null };
};

export function channelProductPublicationAdapter(provider: SalesChannelProvider): ChannelProductPublicationAdapter {
  if (provider === 'native_shop') return publishNativeShopProduct;
  if (provider === 'shopify') return publishShopifyProduct;
  return publishAmazonExistingAsinOffers;
}