export interface ShopifyOptionVariant {
  option1_name?: string | null;
  option1_value?: string | null;
  option2_name?: string | null;
  option2_value?: string | null;
  option3_name?: string | null;
  option3_value?: string | null;
}

export interface ShopifyVariantOptions {
  option1: string;
  option2?: string;
  option3?: string;
}

export function isShopifyPlaceholderOptionValue(value: string | null | undefined): boolean {
  return !value?.trim() || /^(default|default title)$/i.test(value.trim());
}

export function isSimpleShopifyProduct(variants: ShopifyOptionVariant[]): boolean {
  return variants.length === 1 && [variants[0].option1_value, variants[0].option2_value, variants[0].option3_value]
    .every(isShopifyPlaceholderOptionValue);
}

export function buildShopifyProductOptions(variants: ShopifyOptionVariant[]): {
  options: Array<{ name: string }> | undefined;
  variantOptions: ShopifyVariantOptions[];
} {
  const axes = ([1, 2, 3] as const).flatMap(position => {
    const nameKey = `option${position}_name` as const;
    const valueKey = `option${position}_value` as const;
    const name = variants.find(variant => variant[nameKey]?.trim())?.[nameKey]?.trim();
    return name && variants.some(variant => !isShopifyPlaceholderOptionValue(variant[valueKey])) ? [{ name, valueKey }] : [];
  });
  if (variants.length > 1 && axes.length === 0) {
    throw new Error('Multiple Solvantis variants have no real Shopify options. Review their option names and values before uploading.');
  }
  return {
    options: axes.length ? axes.map(axis => ({ name: axis.name })) : undefined,
    variantOptions: variants.map(variant => {
      const values = axes.map(axis => variant[axis.valueKey]?.trim() || 'Default');
      return {
        option1: values[0] ?? 'Default Title',
        ...(values[1] !== undefined ? { option2: values[1] } : {}),
        ...(values[2] !== undefined ? { option3: values[2] } : {}),
      };
    }),
  };
}

export interface ShopifyProductOptionsSnapshot {
  id: string;
  title: string;
  options: Array<{ id: string; name: string; values: string[]; optionValues?: Array<{ id: string; name: string }> }>;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      barcode: string | null;
      price: string;
      inventoryItem: { id: string };
      selectedOptions: Array<{ name: string; value: string }>;
    }>;
    pageInfo: { hasNextPage: boolean };
  };
}

export interface ShopifyDefaultOptionMapping {
  variant_id: string;
  external_product_id: string;
  external_variant_id: string;
  external_inventory_id: string | null;
}

export function previewShopifyDefaultOptionRepair(
  variants: Array<ShopifyOptionVariant & { variant_id: string; sku: string | null; is_active: number }>,
  mappings: ShopifyDefaultOptionMapping[],
  remote: ShopifyProductOptionsSnapshot,
): { outcome: 'candidate' | 'already_simple' | 'review'; reason: string } {
  if (!isSimpleShopifyProduct(variants) || variants[0].is_active !== 1) {
    return { outcome: 'review', reason: 'Solvantis does not have exactly one active default-only variant.' };
  }
  if (remote.variants.nodes.length !== 1 || remote.variants.pageInfo.hasNextPage) {
    return { outcome: 'review', reason: 'Shopify does not have exactly one variant; no options may be collapsed.' };
  }
  const mapping = mappings[0];
  const remoteVariant = remote.variants.nodes[0];
  if (mappings.length !== 1 || mapping.variant_id !== variants[0].variant_id
    || `gid://shopify/Product/${mapping.external_product_id}` !== remote.id
    || `gid://shopify/ProductVariant/${mapping.external_variant_id}` !== remoteVariant.id
    || !mapping.external_inventory_id
    || `gid://shopify/InventoryItem/${mapping.external_inventory_id}` !== remoteVariant.inventoryItem.id) {
    return { outcome: 'review', reason: 'Product, variant and inventory-item mappings are not uniquely consistent.' };
  }
  if (!variants[0].sku?.trim() || variants[0].sku !== remoteVariant.sku) {
    return { outcome: 'review', reason: 'The Solvantis and Shopify SKUs are blank or differ.' };
  }
  if (!remote.options.length || !remoteVariant.selectedOptions.length
    || remote.options.some(option => !option.values.length || option.values.some(value => !isShopifyPlaceholderOptionValue(value)))
    || remoteVariant.selectedOptions.some(option => !isShopifyPlaceholderOptionValue(option.value))) {
    return { outcome: 'review', reason: 'Shopify has real or incomplete option values; leave them unchanged.' };
  }
  const alreadySimple = remote.options.length === 1 && remote.options[0].name === 'Title'
    && remote.options[0].values.length === 1 && remote.options[0].values[0] === 'Default Title'
    && remoteVariant.selectedOptions.length === 1
    && remoteVariant.selectedOptions[0].name === 'Title' && remoteVariant.selectedOptions[0].value === 'Default Title';
  return alreadySimple
    ? { outcome: 'already_simple', reason: 'Shopify already uses its hidden default variant.' }
    : { outcome: 'candidate', reason: 'Only artificial default options are present on the same mapped variant.' };
}

export function assertShopifyDefaultOptionRepairPreserved(
  before: ShopifyProductOptionsSnapshot,
  after: ShopifyProductOptionsSnapshot,
): void {
  const previous = before.variants.nodes[0];
  const current = after.variants.nodes[0];
  if (before.variants.nodes.length !== 1 || before.variants.pageInfo.hasNextPage
    || after.variants.nodes.length !== 1 || after.variants.pageInfo.hasNextPage
    || before.id !== after.id || before.title !== after.title
    || previous.id !== current.id || previous.inventoryItem.id !== current.inventoryItem.id
    || previous.sku !== current.sku || previous.barcode !== current.barcode || previous.price !== current.price) {
    throw new Error('Shopify option repair did not preserve product, variant, inventory-item, SKU, barcode or price evidence.');
  }
  if (after.options.length !== 1 || after.options[0].name !== 'Title'
    || after.options[0].values.length !== 1 || after.options[0].values[0] !== 'Default Title'
    || current.selectedOptions.length !== 1 || current.selectedOptions[0].name !== 'Title'
    || current.selectedOptions[0].value !== 'Default Title') {
    throw new Error('Shopify option repair did not produce a hidden Default Title variant.');
  }
}
