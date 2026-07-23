export interface FilterSelection {
  type: 'product' | 'brand' | 'supplier' | 'product_type' | 'category' | 'subcategory';
  value: string;
  label: string;
  meta?: string;
}

export interface MultiFilter {
  product: FilterSelection | null;
  supplier: FilterSelection | null;
  brand: FilterSelection | null;
  type_: FilterSelection | null;
  category: FilterSelection | null;
  subcategory: FilterSelection | null;
}

export const EMPTY_MULTI: MultiFilter = {
  product: null,
  supplier: null,
  brand: null,
  type_: null,
  category: null,
  subcategory: null,
};

export function multiFilterParams(f: MultiFilter): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.product) p.productId = f.product.value;
  if (f.supplier) p.supplierId = f.supplier.value;
  if (f.brand) p.brand = f.brand.value;
  if (f.type_) p.productType = f.type_.value;
  if (f.category) p.category = f.category.value;
  if (f.subcategory) p.subcategory = f.subcategory.value;
  return p;
}

export function hasMultiFilter(f: MultiFilter) {
  return !!(f.product || f.supplier || f.brand || f.type_);
}

export const WINDOW_OPTS = [
  { value: 7, label: '7 Days' },
  { value: 90, label: '90 Days' },
  { value: 180, label: '180 Days' },
  { value: 365, label: '12 Months' },
];

export type SBDateRange =
  | { kind: 'window'; window: number; label: string }
  | { kind: 'range'; from: string; to: string; label: string };