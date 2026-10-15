import { generateProductSku } from './productSku';

export interface ProductSkuVariant {
  sku?: string | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
}

function optionOrders(options: string[]): string[][] {
  if (options.length <= 1) return [options];
  return options.flatMap((option, index) =>
    optionOrders(options.filter((_, other) => other !== index)).map(rest => [option, ...rest]));
}

export function inferShopifyProductSku(variants: ProductSkuVariant[]): string | null {
  if (!variants.length || variants.some(variant => !variant.sku?.trim())) return null;
  const bases = variants.map(variant => {
    const sku = variant.sku!.trim();
    const options = [variant.option1_value, variant.option2_value, variant.option3_value]
      .map(value => value?.trim()).filter((value): value is string => Boolean(value) && value !== 'Default Title');
    if (!options.length) return variants.length === 1 ? sku : null;
    for (const order of optionOrders(options)) {
      const suffix = order.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[/\\-]');
      const match = sku.match(new RegExp(`^(.+?)[/\\-]${suffix}$`, 'i'));
      if (match?.[1].trim()) return match[1].trim();
    }
    return null;
  });
  const base = bases[0];
  return base && base.length <= 100 && bases.every(value => value?.toLowerCase() === base.toLowerCase()) ? base : null;
}

export function createMissingShopifyProductSku(
  brand: unknown,
  variants: ProductSkuVariant[],
  usedSkus: Set<string>,
  now = new Date(),
): { sku: string; inferred: boolean } {
  const inferred = inferShopifyProductSku(variants);
  if (inferred && !usedSkus.has(inferred.toLowerCase())) {
    usedSkus.add(inferred.toLowerCase());
    return { sku: inferred, inferred: true };
  }
  let generatedAt = now;
  let sku = generateProductSku(brand, generatedAt);
  while (usedSkus.has(sku.toLowerCase())) {
    generatedAt = new Date(generatedAt.getTime() + 1000);
    sku = generateProductSku(brand, generatedAt);
  }
  usedSkus.add(sku.toLowerCase());
  return { sku, inferred: false };
}
