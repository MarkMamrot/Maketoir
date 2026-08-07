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

export type PreviousPeriod = 'week' | 'month' | 'quarter' | 'year';

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function previousCalendarPeriod(period: PreviousPeriod, now = new Date()): SBDateRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  let from: Date;
  let to: Date;
  let label: string;

  if (period === 'week') {
    const mondayOffset = (now.getDay() + 6) % 7;
    from = new Date(year, month, now.getDate() - mondayOffset - 7);
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
    label = 'Previous Week';
  } else if (period === 'month') {
    from = new Date(year, month - 1, 1);
    to = new Date(year, month, 0);
    label = 'Previous Month';
  } else if (period === 'quarter') {
    const currentQuarterStartMonth = Math.floor(month / 3) * 3;
    from = new Date(year, currentQuarterStartMonth - 3, 1);
    to = new Date(year, currentQuarterStartMonth, 0);
    label = 'Previous Quarter';
  } else {
    from = new Date(year - 1, 0, 1);
    to = new Date(year - 1, 11, 31);
    label = 'Previous Year';
  }

  return { kind: 'range', from: localIsoDate(from), to: localIsoDate(to), label };
}