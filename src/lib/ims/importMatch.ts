export type ImportMatchAction = 'new_product' | 'new_variant' | 'update' | 'error';

export interface ResolveImportMatchInput {
  sku: string;
  barcode: string;
  product_sku: string;
  product_name: string;
  variantBySkuMap: Map<string, { variant: { variant_id: string; barcode?: string | null; sku?: string | null }; product: { product_id: string } }>;
  productByNameMap: Map<string, any>;
  productByBaseSkuMap: Map<string, any>;
}

export interface ResolveImportMatchResult {
  action: ImportMatchAction;
  existing_variant_id?: string;
  existing_product_id?: string;
  errorMsg?: string;
}

const normStr = (value: string = '') => value.trim().toLowerCase();

function findDefaultVariantForProduct(product: any, productSku: string, productName: string, barcode: string) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const normalizedProductSku = normStr(productSku);
  const normalizedProductName = normStr(productName);
  const normalizedBarcode = normStr(barcode);

  return variants.find((variant: any) => {
    const variantSku = normStr(variant?.sku ?? '');
    const variantBarcode = normStr(variant?.barcode ?? '');
    const variantLabel = normStr(variant?.variant_label ?? '');

    if (normalizedProductSku && (variantSku === normalizedProductSku || variantLabel === normalizedProductSku)) return true;
    if (normalizedBarcode && variantBarcode === normalizedBarcode) return true;
    if (!variantSku && !variantBarcode) return true;
    if (!normalizedProductSku && !normalizedProductName) return true;
    return false;
  }) ?? (variants.length === 1 ? variants[0] : null);
}

export function resolveImportMatch({
  sku,
  barcode,
  product_sku,
  product_name,
  variantBySkuMap,
  productByNameMap,
  productByBaseSkuMap,
}: ResolveImportMatchInput): ResolveImportMatchResult {
  if (!product_name && !sku && !product_sku && !barcode) {
    return { action: 'error', errorMsg: 'Missing Product_Name and SKU' };
  }

  const normalizedSku = normStr(sku);
  const normalizedBarcode = normStr(barcode);
  const normalizedProductSku = normStr(product_sku);
  const normalizedProductName = normStr(product_name);

  if (normalizedSku) {
    const match = variantBySkuMap.get(normalizedSku);
    if (match) {
      return {
        action: 'update',
        existing_variant_id: match.variant.variant_id,
        existing_product_id: match.product.product_id,
      };
    }
  }

  if (normalizedBarcode) {
    const byBarcode = Array.from(variantBySkuMap.values()).find(({ variant }) => normStr((variant as any).barcode ?? '') === normalizedBarcode);
    if (byBarcode) {
      return {
        action: 'update',
        existing_variant_id: byBarcode.variant.variant_id,
        existing_product_id: byBarcode.product.product_id,
      };
    }
  }

  const productSkuMatch = normalizedProductSku ? variantBySkuMap.get(normalizedProductSku) : undefined;
  if (productSkuMatch) {
    return {
      action: 'update',
      existing_variant_id: productSkuMatch.variant.variant_id,
      existing_product_id: productSkuMatch.product.product_id,
    };
  }

  const existingProduct =
    (normalizedProductSku && productByBaseSkuMap.get(normalizedProductSku)) ||
    (normalizedProductName && productByNameMap.get(normalizedProductName));

  if (existingProduct) {
    const defaultVariant = findDefaultVariantForProduct(existingProduct, product_sku, product_name, barcode);
    if (defaultVariant) {
      return {
        action: 'update',
        existing_variant_id: defaultVariant.variant_id,
        existing_product_id: existingProduct.product_id,
      };
    }

    return {
      action: 'new_variant',
      existing_product_id: existingProduct.product_id,
    };
  }

  return { action: 'new_product' };
}
