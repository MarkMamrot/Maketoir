import { imsQuery } from '@/services/IMSMySQLService';

interface PublicationProduct {
  product_id: string;
  name: string | null;
  website_title: string | null;
  description: string | null;
  is_active: number;
}

interface PublicationVariant {
  product_id: string;
  sku: string | null;
  price_rrp: number | string | null;
  is_active: number;
}

export function channelPublicationIssues(product: PublicationProduct | undefined, variants: PublicationVariant[]): string[] {
  if (!product) return ['Product not found.'];
  const issues: string[] = [];
  if (Number(product.is_active) !== 1) issues.push('Product must be active.');
  if (!(product.website_title?.trim() || product.name?.trim())) issues.push('Title is required.');
  const description = (product.description ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
    .trim();
  if (!description) issues.push('Description is required.');
  const active = variants.filter(variant => Number(variant.is_active) !== 0);
  if (!active.length) issues.push('At least one active variant is required.');
  active.forEach((variant, index) => {
    const label = variant.sku?.trim() || `Variant ${index + 1}`;
    if (!variant.sku?.trim()) issues.push(`${label}: SKU is required.`);
    const price = Number(variant.price_rrp);
    if (!Number.isFinite(price) || price <= 0) issues.push(`${label}: RRP must be greater than zero.`);
  });
  return issues;
}

export async function getChannelProductReadiness(businessId: string, productIds: string[]) {
  if (!productIds.length) throw new Error('Select at least one product to check publication readiness.');
  const placeholders = productIds.map(() => '?').join(',');
  const [products, variants] = await Promise.all([
    imsQuery<PublicationProduct>(
      `SELECT product_id, name, website_title, description, is_active FROM ims_products
        WHERE business_id = ? AND product_id IN (${placeholders})`,
      [businessId, ...productIds],
    ),
    imsQuery<PublicationVariant>(
      `SELECT product_id, sku, price_rrp, is_active FROM ims_product_variants
        WHERE business_id = ? AND product_id IN (${placeholders}) ORDER BY variant_id`,
      [businessId, ...productIds],
    ),
  ]);
  return productIds.map(productId => {
    const product = products.find(product => product.product_id === productId);
    return {
      productId,
      productName: product?.name || productId,
      issues: channelPublicationIssues(product, variants.filter(variant => variant.product_id === productId)),
    };
  });
}
