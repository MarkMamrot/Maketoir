export type DashboardComparisonMode = 'prior_period' | 'year_ago';

export type DailySalesTotal = {
  saleDate: string;
  sales: number;
};

export type DashboardSalesComparison = {
  days: number;
  label: string;
  current: { from: string; to: string; sales: number };
  comparison: { from: string; to: string; sales: number };
  change: number;
  changePercent: number | null;
};

const PERIODS = [
  { days: 1, endOffset: 0, label: 'Today so far' },
  { days: 1, endOffset: -1, label: 'Yesterday' },
  { days: 7, endOffset: 0, label: '7 Days' },
  { days: 30, endOffset: 0, label: '30 Days' },
  { days: 90, endOffset: 0, label: '90 Days' },
  { days: 365, endOffset: 0, label: '1 Year' },
] as const;

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function subtractCalendarYear(value: string): string {
  const date = parseDate(value);
  const year = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(year, month, Math.min(day, lastDay))));
}

function sumRange(totals: Map<string, number>, from: string, to: string): number {
  let total = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    total += totals.get(date) ?? 0;
  }
  return total;
}

export function buildDashboardSalesComparisons(
  rows: DailySalesTotal[],
  earliestSaleDate: string | null,
  today: string,
  mode: DashboardComparisonMode,
): DashboardSalesComparison[] {
  if (!earliestSaleDate) return [];

  const totals = new Map(rows.map(row => [row.saleDate, Number(row.sales ?? 0)]));

  return PERIODS.flatMap(({ days, endOffset, label }) => {
    const currentTo = addDays(today, endOffset);
    const currentFrom = addDays(currentTo, -(days - 1));
    const comparisonTo = mode === 'prior_period'
      ? addDays(currentFrom, -1)
      : subtractCalendarYear(currentTo);
    const comparisonFrom = mode === 'prior_period'
      ? addDays(comparisonTo, -(days - 1))
      : subtractCalendarYear(currentFrom);

    if (earliestSaleDate > comparisonFrom) return [];

    const currentSales = sumRange(totals, currentFrom, currentTo);
    const comparisonSales = sumRange(totals, comparisonFrom, comparisonTo);
    const change = currentSales - comparisonSales;

    return [{
      days,
      label,
      current: { from: currentFrom, to: currentTo, sales: currentSales },
      comparison: { from: comparisonFrom, to: comparisonTo, sales: comparisonSales },
      change,
      changePercent: comparisonSales === 0 ? null : (change / comparisonSales) * 100,
    }];
  });
}

export function earliestDashboardComparisonDate(today: string): string {
  const currentFrom = addDays(today, -364);
  return [addDays(currentFrom, -365), subtractCalendarYear(currentFrom)].sort()[0];
}