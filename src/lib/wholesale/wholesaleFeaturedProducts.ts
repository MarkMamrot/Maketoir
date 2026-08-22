import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

export interface WholesaleFeaturedProductTeaser {
  product_id: string;
  name: string;
  image_url: string | null;
}

export async function getPublicWholesaleProductTeasers(
  businessId: string,
  rawProductIds: readonly string[],
): Promise<WholesaleFeaturedProductTeaser[]> {
  const productIds = [...new Set(rawProductIds.map(id => id.trim()).filter(Boolean))].slice(0, 24);
  if (!productIds.length) return [];

  return runImsForBusiness(businessId, async () => {
    const placeholders = productIds.map(() => '?').join(',');
    const products = await imsQuery<{ product_id: string; name: string }>(
      `SELECT p.product_id, p.name
         FROM ims_products p
        WHERE p.business_id = ?
          AND p.product_id IN (${placeholders})
          AND p.is_active = 1
          AND EXISTS (
            SELECT 1 FROM ims_product_variants v
             WHERE v.product_id = p.product_id
               AND v.is_active = 1
               AND v.price_wholesale > 0
          )`,
      [businessId, ...productIds],
    );
    if (!products.length) return [];

    const images = new Map<string, string>();
    try {
      const imageRows = await imsQuery<{ product_id: string; url: string }>(
        `SELECT product_id, url
           FROM ims_product_images
          WHERE product_id IN (${products.map(() => '?').join(',')})
          ORDER BY product_id, is_primary DESC, sort_order ASC, id ASC`,
        products.map(product => product.product_id),
      );
      for (const row of imageRows) if (!images.has(row.product_id)) images.set(row.product_id, row.url);
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'wholesale_portal',
        operation: 'load_public_featured_product_images',
        severity: 'warning',
        title: 'Wholesale Login featured product images could not be loaded',
        error,
        context: { productCount: products.length },
      });
    }

    const byId = new Map(products.map(product => [product.product_id, product]));
    return productIds.flatMap(productId => {
      const product = byId.get(productId);
      return product ? [{ product_id: product.product_id, name: product.name, image_url: images.get(productId) ?? null }] : [];
    });
  });
}
