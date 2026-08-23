import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { sanitizeStorefrontHtml } from '@/lib/storefront/layoutValidation';
import type { StorefrontProductImage, StorefrontProductProjection } from '@/lib/storefront/commerce';
import { imsQuery } from '@/services/IMSMySQLService';

interface ProductVariantRow {
  product_id: string; slug: string; name: string; description: string | null; brand: string | null; category: string | null;
  variant_id: string; sku: string | null; barcode: string | null; option1_value: string | null;
  option2_value: string | null; option3_value: string | null; retail_price: number | string;
  compare_at_price: number | string | null; available_units: number | string;
}
interface ProductImageRow { id: number | string; product_id: string; url: string; alt_text: string | null; sort_order: number }

export function projectOnlineShopProducts(rows: readonly ProductVariantRow[], imageRows: readonly ProductImageRow[]): StorefrontProductProjection[] {
  const images = new Map<string, StorefrontProductImage[]>();
  for (const image of imageRows) {
    const list = images.get(image.product_id) ?? [];
    list.push({ id: String(image.id), url: image.url, altText: image.alt_text?.trim() || '', sortOrder: Number(image.sort_order) || 0 });
    images.set(image.product_id, list);
  }
  const products = new Map<string, StorefrontProductProjection>();
  for (const row of rows) {
    let product = products.get(row.product_id);
    if (!product) {
      product = { productId: row.product_id, slug: row.slug, name: row.name,
        descriptionHtml: sanitizeStorefrontHtml(row.description ?? ''), brand: row.brand, category: row.category,
        images: images.get(row.product_id) ?? [], variants: [] };
      products.set(row.product_id, product);
    }
    const price = Math.max(0, Number(row.retail_price) || 0);
    const compare = Number(row.compare_at_price);
    product.variants.push({ variantId: row.variant_id, sku: row.sku, barcode: row.barcode,
      optionValues: [row.option1_value, row.option2_value, row.option3_value].map(value => value?.trim() ?? '').filter(Boolean),
      price: { amount: price, currency: 'AUD' }, compareAtPrice: compare > price ? { amount: compare, currency: 'AUD' } : null,
      availableUnits: Math.max(0, Math.floor(Number(row.available_units) || 0)) });
  }
  return [...products.values()];
}

const productSql = `SELECT pub.product_id, pub.slug, p.name, p.description, p.brand, p.category,
  v.variant_id, v.sku, v.barcode, v.option1_value, v.option2_value, v.option3_value,
  CASE WHEN v.price_rrp_sale IS NOT NULL AND v.price_rrp_sale > 0
    AND (v.discount_start_date IS NULL OR v.discount_start_date <= CURRENT_DATE)
    AND (v.discount_end_date IS NULL OR v.discount_end_date >= CURRENT_DATE)
    THEN v.price_rrp_sale ELSE v.price_rrp END AS retail_price,
  CASE WHEN v.price_rrp_sale IS NOT NULL AND v.price_rrp_sale > 0
    AND (v.discount_start_date IS NULL OR v.discount_start_date <= CURRENT_DATE)
    AND (v.discount_end_date IS NULL OR v.discount_end_date >= CURRENT_DATE)
    THEN v.price_rrp ELSE NULL END AS compare_at_price,
  FLOOR(GREATEST(0, COALESCE(stock.available_units, 0))) AS available_units
  FROM ims_online_shop_products pub
  JOIN ims_products p ON p.product_id = pub.product_id AND p.business_id = pub.business_id AND p.is_active = 1
  JOIN ims_product_variants v ON v.product_id = p.product_id AND v.business_id = p.business_id AND v.is_active = 1
  LEFT JOIN (SELECT s.variant_id, SUM(GREATEST(0, s.qty_on_hand - s.qty_committed)) AS available_units
    FROM ims_stock s JOIN ims_locations l ON l.id = s.location_id AND l.business_id = s.business_id
      AND l.is_active = 1 AND l.has_online = 1
    WHERE s.business_id = ? GROUP BY s.variant_id) stock ON stock.variant_id = v.variant_id
  WHERE pub.business_id = ? AND pub.is_published = 1
    AND (CASE WHEN v.price_rrp_sale IS NOT NULL AND v.price_rrp_sale > 0
      AND (v.discount_start_date IS NULL OR v.discount_start_date <= CURRENT_DATE)
      AND (v.discount_end_date IS NULL OR v.discount_end_date >= CURRENT_DATE)
      THEN v.price_rrp_sale ELSE v.price_rrp END) > 0`;

async function loadImages(productIds: readonly string[]): Promise<ProductImageRow[]> {
  if (!productIds.length) return [];
  return imsQuery<ProductImageRow>(`SELECT id, product_id, url, alt_text, sort_order FROM ims_product_images
    WHERE product_id IN (${productIds.map(() => '?').join(',')}) ORDER BY product_id, is_primary DESC, sort_order, id`, [...productIds]);
}

export const OnlineShopCatalogueRepository = {
  async listPublished(businessId: string, input: { limit?: number; offset?: number } = {}): Promise<StorefrontProductProjection[]> {
    const limit = Math.min(100, Math.max(1, Number.isSafeInteger(input.limit) ? Number(input.limit) : 24));
    const offset = Math.max(0, Number.isSafeInteger(input.offset) ? Number(input.offset) : 0);
    return runImsForBusiness(businessId, async () => {
      const published = await imsQuery<{ product_id: string }>(`SELECT pub.product_id FROM ims_online_shop_products pub
        JOIN ims_products p ON p.product_id = pub.product_id AND p.business_id = pub.business_id AND p.is_active = 1
        WHERE pub.business_id = ? AND pub.is_published = 1 ORDER BY p.name, pub.product_id LIMIT ${limit} OFFSET ${offset}`, [businessId]);
      const productIds = published.map(row => row.product_id);
      if (!productIds.length) return [];
      const rows = await imsQuery<ProductVariantRow>(`${productSql} AND pub.product_id IN (${productIds.map(() => '?').join(',')})
        ORDER BY p.name, pub.product_id, v.id`, [businessId, businessId, ...productIds]);
      return projectOnlineShopProducts(rows, await loadImages(productIds));
    });
  },

  async getPublishedBySlug(businessId: string, slug: string): Promise<StorefrontProductProjection | null> {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(normalizedSlug)) return null;
    return runImsForBusiness(businessId, async () => {
      const rows = await imsQuery<ProductVariantRow>(`${productSql} AND pub.slug = ? ORDER BY v.id`, [businessId, businessId, normalizedSlug]);
      if (!rows.length) return null;
      return projectOnlineShopProducts(rows, await loadImages([rows[0].product_id]))[0] ?? null;
    });
  },

  async getPublishedByVariantIds(businessId: string, rawVariantIds: readonly string[]): Promise<StorefrontProductProjection[]> {
    const variantIds = [...new Set(rawVariantIds.map(id => id.trim()).filter(id => /^[a-zA-Z0-9_-]{1,100}$/.test(id)))].slice(0, 100);
    if (!variantIds.length) return [];
    return runImsForBusiness(businessId, async () => {
      const rows = await imsQuery<ProductVariantRow>(`${productSql} AND v.variant_id IN (${variantIds.map(() => '?').join(',')})
        ORDER BY p.name, pub.product_id, v.id`, [businessId, businessId, ...variantIds]);
      const productIds = [...new Set(rows.map(row => row.product_id))];
      return projectOnlineShopProducts(rows, await loadImages(productIds));
    });
  },
};