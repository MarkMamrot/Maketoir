import { deriveVariantSku } from './importSku';
import { generateProductSku } from './productSku';
import type { ProductSettings } from './productSettings';

export interface ProductOptionSet {
  name: string;
  values: string;
}

export interface BulkVariantDraft {
  clientId: string;
  variantId?: string;
  option1Value: string;
  option2Value: string;
  option3Value: string;
  sku: string;
  [key: string]: unknown;
}

export interface BulkProductSkuDraft {
  brand?: string;
  baseSku?: string;
  [key: string]: unknown;
}

export type BulkProductFieldOwner = 'product' | 'variant';
export type BulkProductEditorType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean';

export interface BulkFillVisibleRow {
  id: string;
  owner: BulkProductFieldOwner;
  productClientId: string;
  variantClientId?: string;
}

export interface BulkProductFieldDefinition {
  id: string;
  label: string;
  owner: BulkProductFieldOwner;
  editor: BulkProductEditorType;
  width: number;
  required?: boolean;
  defaultVisible?: boolean;
  fillDown?: boolean;
  enabled?: (settings: ProductSettings, useForeignCurrencies: boolean) => boolean;
}

export const BULK_PRODUCT_FIELDS: BulkProductFieldDefinition[] = [
  { id: 'name', label: 'Product Name', owner: 'product', editor: 'text', width: 260, required: true, defaultVisible: true, fillDown: true },
  { id: 'base_sku', label: 'Product SKU', owner: 'product', editor: 'text', width: 170, required: true, defaultVisible: true },
  { id: 'brand', label: 'Brand', owner: 'product', editor: 'select', width: 170, defaultVisible: true, fillDown: true },
  { id: 'supplier_contact_id', label: 'Default Supplier', owner: 'product', editor: 'select', width: 190, defaultVisible: true, fillDown: true },
  { id: 'product_type', label: 'Product Type', owner: 'product', editor: 'select', width: 160, fillDown: true, enabled: settings => settings.showProductType },
  { id: 'category', label: 'Category', owner: 'product', editor: 'text', width: 150, fillDown: true, enabled: settings => settings.showCategories },
  { id: 'subcategory', label: 'Subcategory', owner: 'product', editor: 'text', width: 150, fillDown: true, enabled: settings => settings.showCategories },
  { id: 'tags', label: 'Tags', owner: 'product', editor: 'text', width: 190, fillDown: true, enabled: settings => settings.showTags },
  { id: 'description', label: 'Description', owner: 'product', editor: 'textarea', width: 300, fillDown: true },
  { id: 'is_active', label: 'Product Active', owner: 'product', editor: 'boolean', width: 115, fillDown: true },
  { id: 'is_stock_item', label: 'Tracks Inventory', owner: 'product', editor: 'boolean', width: 130, fillDown: true },
  { id: 'is_online', label: 'Online', owner: 'product', editor: 'boolean', width: 95, fillDown: true },
  { id: 'website_title', label: 'Website Title', owner: 'product', editor: 'text', width: 220, fillDown: true },
  { id: 'allow_indent_wholesale', label: 'Allow Wholesale Indent', owner: 'product', editor: 'boolean', width: 175, fillDown: true },
  { id: 'sku', label: 'Variant SKU', owner: 'variant', editor: 'text', width: 180, required: true, defaultVisible: true },
  { id: 'barcode', label: 'Barcode', owner: 'variant', editor: 'text', width: 170, defaultVisible: true, fillDown: true },
  { id: 'price_rrp', label: 'RRP $ (GST Inc)', owner: 'variant', editor: 'number', width: 130, defaultVisible: true, fillDown: true },
  { id: 'price_wholesale', label: 'Wholesale $', owner: 'variant', editor: 'number', width: 115, fillDown: true, enabled: settings => settings.showWholesalePrice },
  { id: 'price_rrp_sale', label: 'Sale $', owner: 'variant', editor: 'number', width: 105, fillDown: true },
  { id: 'discount_start_date', label: 'Sale From', owner: 'variant', editor: 'date', width: 135, fillDown: true },
  { id: 'discount_end_date', label: 'Sale To', owner: 'variant', editor: 'date', width: 135, fillDown: true },
  { id: 'cost_aud', label: 'Cost $ (GST Exc)', owner: 'variant', editor: 'number', width: 135, defaultVisible: true, fillDown: true },
  { id: 'weight_kg', label: 'Weight kg', owner: 'variant', editor: 'number', width: 110, fillDown: true, enabled: settings => settings.showWeight },
  { id: 'cost_foreign', label: 'Foreign Costs', owner: 'variant', editor: 'text', width: 180, fillDown: true, enabled: (_settings, useForeignCurrencies) => useForeignCurrencies },
  { id: 'is_active_variant', label: 'Variant Active', owner: 'variant', editor: 'boolean', width: 115, fillDown: true },
];

export function optionCombinations(optionSets: ProductOptionSet[]): [string, string, string][] {
  const active = optionSets
    .slice(0, 3)
    .filter(option => option.name.trim() && option.values.trim());
  if (!active.length) return [['', '', '']];

  const valueSets = active.map(option => option.values.split(',').map(value => value.trim()).filter(Boolean));
  let combinations: string[][] = [[]];
  for (const values of valueSets) {
    combinations = combinations.flatMap(combination => values.map(value => [...combination, value]));
  }
  return combinations.map(values => [values[0] ?? '', values[1] ?? '', values[2] ?? '']);
}

export function reconcileVariantMatrix(
  baseSku: string,
  optionSets: ProductOptionSet[],
  variants: BulkVariantDraft[],
  createClientId: () => string,
): { variants: BulkVariantDraft[]; unmatchedExisting: BulkVariantDraft[] } {
  const combinations = optionCombinations(optionSets);
  const activeOptions = optionSets.some(option => option.name.trim() && option.values.trim());
  const candidates = activeOptions
    ? variants.filter(variant => variant.variantId || variant.option1Value || variant.option2Value || variant.option3Value)
    : variants;
  const matchedIds = new Set<string>();

  const nextVariants = combinations.map(([option1Value, option2Value, option3Value]) => {
    const existing = candidates.find(variant =>
      (variant.option1Value === option1Value || (!option1Value && variant.option1Value.trim().toLowerCase() === 'default'))
      && variant.option2Value === option2Value
      && variant.option3Value === option3Value,
    );
    if (existing) {
      matchedIds.add(existing.clientId);
      return existing;
    }
    return {
      clientId: createClientId(),
      option1Value,
      option2Value,
      option3Value,
      sku: deriveVariantSku(baseSku.trim(), [option1Value, option2Value, option3Value]),
    };
  });

  const unmatchedExisting = variants.filter(variant => variant.variantId && !matchedIds.has(variant.clientId));
  return { variants: [...nextVariants, ...unmatchedExisting], unmatchedExisting };
}

export function populateBlankProductSkus<T extends BulkProductSkuDraft>(rows: T[], now = new Date()): T[] {
  let generatedCount = 0;
  return rows.map(row => {
    if (row.baseSku?.trim()) return row;
    const generatedAt = new Date(now.getTime() + generatedCount * 1000);
    generatedCount += 1;
    return { ...row, baseSku: generateProductSku(row.brand ?? '', generatedAt) };
  });
}

export function enabledBulkProductFields(
  settings: ProductSettings,
  useForeignCurrencies: boolean,
): BulkProductFieldDefinition[] {
  return BULK_PRODUCT_FIELDS.filter(field => field.id !== 'sku' && (!field.enabled || field.enabled(settings, useForeignCurrencies)));
}

export function sanitizeBulkProductFieldSelection(
  selectedIds: unknown,
  availableFields: BulkProductFieldDefinition[],
): string[] {
  const allowed = new Set(availableFields.map(field => field.id));
  const required = availableFields.filter(field => field.required).map(field => field.id);
  const requested = Array.isArray(selectedIds)
    ? selectedIds.filter((id): id is string => typeof id === 'string' && allowed.has(id))
    : availableFields.filter(field => field.defaultVisible).map(field => field.id);
  return [...new Set([...required, ...requested])];
}

export function canFillBulkProductField(fieldId: string, rowOwner: BulkProductFieldOwner): boolean {
  const field = BULK_PRODUCT_FIELDS.find(candidate => candidate.id === fieldId);
  return Boolean(field?.fillDown && field.owner === rowOwner);
}

export function bulkFillTargets(
  rows: BulkFillVisibleRow[],
  sourceRowId: string,
  targetRowId: string,
  owner: BulkProductFieldOwner,
): BulkFillVisibleRow[] {
  const sourceIndex = rows.findIndex(row => row.id === sourceRowId);
  const targetIndex = rows.findIndex(row => row.id === targetRowId);
  if (sourceIndex < 0 || targetIndex < 0) return [];
  const [from, to] = sourceIndex <= targetIndex ? [sourceIndex, targetIndex] : [targetIndex, sourceIndex];
  return rows.slice(from, to + 1).filter(row => row.owner === owner);
}