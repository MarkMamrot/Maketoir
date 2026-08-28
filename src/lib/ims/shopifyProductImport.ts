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

export type ShopifyVariantImportPlan =
  | { action: 'create' }
  | { action: 'use_existing'; variantId: string }
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
  const identifierMatches = variants.filter(variant => {
    const sku = normalizedKey(variant.sku);
    const barcode = normalizedKey(variant.barcode);
    return (sku !== null && skuKeys.has(sku)) || (barcode !== null && barcodeKeys.has(barcode));
  });

  const linkedProductIds = new Set(products
    .filter(product => normalizedKey(product.shopifyProductId) !== null)
    .map(product => product.productId));
  const variantLinkedProductIds = new Set(identifierMatches
    .filter(variant => normalizedKey(variant.shopifyVariantId) !== null)
    .map(variant => variant.productId));
  const adoptableProductIds = uniqueProductIds(identifierMatches.filter(variant =>
    !linkedProductIds.has(variant.productId)
    && !variantLinkedProductIds.has(variant.productId)
    && normalizedKey(variant.shopifyVariantId) === null,
  ));
  if (adoptableProductIds.length > 1) {
    return { action: 'skip', reason: `Shopify product ${shopifyProductId} matches SKUs or barcodes on multiple Solvantis products.` };
  }
  if (adoptableProductIds.length === 1) {
    return { action: 'use_existing', productId: adoptableProductIds[0] };
  }
  return { action: 'create' };
}

export function planShopifyVariantImport(
  shopifyVariant: NonNullable<ShopifyImportProduct['variants']>[number],
  targetProductId: string,
  variants: ExistingShopifyImportVariant[],
): ShopifyVariantImportPlan {
  const shopifyVariantId = String(shopifyVariant.id);
  const directlyLinked = variants.filter(variant => String(variant.shopifyVariantId ?? '') === shopifyVariantId);
  if (directlyLinked.length === 1) {
    return directlyLinked[0].productId === targetProductId
      ? { action: 'use_existing', variantId: directlyLinked[0].variantId }
      : { action: 'skip', reason: `Shopify variant ${shopifyVariantId} is linked to another Solvantis product.` };
  }
  if (directlyLinked.length > 1) {
    return { action: 'skip', reason: `Shopify variant ${shopifyVariantId} is linked to multiple Solvantis variants.` };
  }

  const sku = normalizedKey(shopifyVariant.sku);
  const barcode = normalizedKey(shopifyVariant.barcode);
  const identifierMatches = variants.filter(variant =>
    (sku !== null && normalizedKey(variant.sku) === sku)
    || (barcode !== null && normalizedKey(variant.barcode) === barcode),
  );
  if (identifierMatches.some(variant =>
    variant.productId !== targetProductId && normalizedKey(variant.shopifyVariantId) === null,
  )) {
    return { action: 'skip', reason: `Shopify variant ${shopifyVariantId} matches a SKU or barcode on another Solvantis product.` };
  }

  const adoptableMatches = identifierMatches.filter(variant =>
    variant.productId === targetProductId && normalizedKey(variant.shopifyVariantId) === null,
  );
  if (adoptableMatches.length === 1) {
    return { action: 'use_existing', variantId: adoptableMatches[0].variantId };
  }
  if (adoptableMatches.length > 1) {
    return { action: 'skip', reason: `Shopify variant ${shopifyVariantId} matches multiple unlinked Solvantis variants.` };
  }
  return { action: 'create' };
}
