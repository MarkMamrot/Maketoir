export const SALES_SUMMARY_DIMENSIONS = [
  'location',
  'supplier',
  'brand',
  'product_type',
  'day_of_week',
  'hour_of_day',
] as const;

export type SalesSummaryDimension = typeof SALES_SUMMARY_DIMENSIONS[number];

export function parseSalesSummaryDimensions(value: string | string[]): SalesSummaryDimension[] {
  const requested = (Array.isArray(value) ? value : value.split(','))
    .map(item => item.trim())
    .filter(Boolean);
  const allowed = new Set<string>(SALES_SUMMARY_DIMENSIONS);
  const invalid = requested.filter(item => !allowed.has(item));
  if (invalid.length > 0) throw new Error(`Unknown groupBy dimension: ${invalid[0]}`);
  const unique = [...new Set(requested)] as SalesSummaryDimension[];
  if (unique.length === 0) throw new Error('Select at least one groupBy dimension.');
  return unique;
}

export function salesSummaryDimensionLabel(dimension: SalesSummaryDimension): string {
  return {
    location: 'Location',
    supplier: 'Supplier',
    brand: 'Brand',
    product_type: 'Product Type',
    day_of_week: 'Day of Week',
    hour_of_day: 'Hour of Day',
  }[dimension];
}

export function dayOfWeekLabel(day: number | null): string {
  if (day == null) return 'Unknown';
  return ['Unknown', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] ?? 'Unknown';
}

export function hourOfDayLabel(hour: number | null): string {
  if (hour == null || hour < 0 || hour > 23) return 'Unknown';
  const suffix = hour < 12 ? 'am' : 'pm';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}

export function addLocationAllRollups<T extends Record<string, unknown>>(
  rows: T[],
  groupingKeys: string[],
  metricKeys: string[],
): T[] {
  const otherKeys = groupingKeys.filter(key => key !== 'location_id' && key !== 'location_name');
  const rollups = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = JSON.stringify(otherKeys.map(field => row[field] ?? null));
    const current = rollups.get(key) ?? {
      ...Object.fromEntries(otherKeys.map(field => [field, row[field] ?? null])),
      location_id: null,
      location_name: 'ALL',
      ...Object.fromEntries(metricKeys.map(field => [field, 0])),
    };
    for (const metric of metricKeys) current[metric] = Number(current[metric] ?? 0) + Number(row[metric] ?? 0);
    rollups.set(key, current);
  }
  return [...rollups.values() as Iterable<T>, ...rows];
}

export interface SalesSummaryDimensionDomain {
  keys: string[];
  values: Array<Record<string, unknown>>;
}

export function completeSalesSummaryCombinations<T extends Record<string, unknown>>(
  rows: T[],
  domains: SalesSummaryDimensionDomain[],
  metricKeys: string[],
): T[] {
  if (domains.length < 2) return rows;

  const rowsByCombination = new Map<string, T>();
  const allKeys = domains.flatMap(domain => domain.keys);
  for (const row of rows) {
    rowsByCombination.set(JSON.stringify(allKeys.map(key => row[key] ?? null)), row);
  }

  const combinations = domains.reduce<Array<Record<string, unknown>>>(
    (current, domain) => current.flatMap(combination => domain.values.map(value => ({ ...combination, ...value }))),
    [{}],
  );

  return combinations.map(combination => {
    const key = JSON.stringify(allKeys.map(field => combination[field] ?? null));
    return rowsByCombination.get(key) ?? {
      ...combination,
      ...Object.fromEntries(metricKeys.map(metric => [metric, 0])),
    } as T;
  });
}

export interface AttachedCogsMetricsInput {
  salesAmountIncTax: number;
  coveredSalesAmountIncTax: number;
  attachedCogs: number;
}

export function attachedCogsMetrics(input: AttachedCogsMetricsInput) {
  const salesAmount = Number(input.salesAmountIncTax) || 0;
  const coveredSalesAmount = Number(input.coveredSalesAmountIncTax) || 0;
  const cogs = Number(input.attachedCogs) || 0;
  const coveredSalesExTax = coveredSalesAmount / 1.1;
  const grossProfit = coveredSalesExTax - cogs;
  const roundMoney = (value: number) => Math.round(value * 100) / 100;
  const roundPercent = (value: number) => Math.round(value * 10000) / 10000;
  return {
    grossProfit: roundMoney(grossProfit),
    grossProfitPercent: coveredSalesExTax > 0 ? roundPercent((grossProfit / coveredSalesExTax) * 100) : null,
    cogsCoveragePercent: salesAmount > 0 ? roundPercent(Math.min(100, Math.max(0, (coveredSalesAmount / salesAmount) * 100))) : 100,
  };
}