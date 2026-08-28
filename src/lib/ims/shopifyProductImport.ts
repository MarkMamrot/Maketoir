export interface ShopifyImportProduct {
  id: string | number;
  variants?: Array<{
    id: string | number;
    sku?: string | null;
    barcode?: string | null;
  }>;
}

export interface ExistingShopifyImportProduct {
  productId: string;
  shopifyProductId?: string | null;
}

export interface ExistingShopifyImportVariant {
  variantId: string;
  productId: string;
  shopifyVariantId?: string | null;
  sku?: string | null;
  barcode?: string | null;
}

export type ShopifyProductImportPlan =
  | { action: 'create' }
  | { action: 'use_existing'; productId: string }
  | { action: 'skip'; reason: string };

function normalizedKey(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || null;
}

function uniqueProductIds(matches: ExistingShopifyImportVariant[]): string[] {
  return [...new Set(matches.map(match => match.productId))];
}

export function planShopifyProductImport(
  shopifyProduct: ShopifyImportProduct,
  products: ExistingShopifyImportProduct[],
  variants: ExistingShopifyImportVariant[],
): ShopifyProductImportPlan {
  const shopifyProductId = String(shopifyProduct.id);
  const directlyLinked = products.filter(product => String(product.shopifyProductId ?? '') === shopifyProductId);
  if (directlyLinked.length === 1) {
    return { action: 'use_existing', productId: directlyLinked[0].productId };
  }
  if (directlyLinked.length > 1) {
    return { action: 'skip', reason: `Shopify product ${shopifyProductId} is linked to multiple Solvantis products.` };
  }

  const shopifyVariantIds = new Set((shopifyProduct.variants ?? []).map(variant => String(variant.id)));
  const variantIdProducts = uniqueProductIds(
    variants.filter(variant => variant.shopifyVariantId && shopifyVariantIds.has(String(variant.shopifyVariantId))),
  );
  if (variantIdProducts.length === 1) {
    return { action: 'use_existing', productId: variantIdProducts[0] };
  }
  if (variantIdProducts.length > 1) {
    return { action: 'skip', reason: `Shopify product ${shopifyProductId} has variant links across multiple Solvantis products.` };
  }

  const skuKeys = new Set((shopifyProduct.variants ?? []).map(variant => normalizedKey(variant.sku)).filter(Boolean));
  const barcodeKeys = new Set((shopifyProduct.variants ?? []).map(variant => normalizedKey(variant.barcode)).filter(Boolean));
  const identifierProducts = uniqueProductIds(variants.filter(variant => {
    const sku = normalizedKey(variant.sku);
    const barcode = normalizedKey(variant.barcode);
    return (sku !== null && skuKeys.has(sku)) || (barcode !== null && barcodeKeys.has(barcode));
  }));

  if (identifierProducts.length === 1) {
    return { action: 'use_existing', productId: identifierProducts[0] };
  }
  if (identifierProducts.length > 1) {
    return { action: 'skip', reason: `Shopify product ${shopifyProductId} matches SKUs or barcodes on multiple Solvantis products.` };
  }
  return { action: 'create' };
}
