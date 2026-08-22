import { describe, expect, it } from 'vitest';

import {
  buildDashboardSalesComparisons,
  earliestDashboardComparisonDate,
} from '../dashboardSalesComparison';

describe('buildDashboardSalesComparisons', () => {
  const rows = [
    { saleDate: '2026-08-15', sales: 80 },
    { saleDate: '2026-08-16', sales: 100 },
    { saleDate: '2025-08-16', sales: 50 },
  ];

  it('compares matched prior periods and reports the variance', () => {
    const result = buildDashboardSalesComparisons(rows, '2024-01-01', '2026-08-16', 'prior_period');

    expect(result[0]).toMatchObject({
      days: 1,
      current: { from: '2026-08-16', to: '2026-08-16', sales: 100 },
      comparison: { from: '2026-08-15', to: '2026-08-15', sales: 80 },
      change: 20,
      changePercent: 25,
    });
  });

  it('adds yesterday as its own period compared with the preceding day', () => {
    const result = buildDashboardSalesComparisons([
      { saleDate: '2026-08-14', sales: 60 },
      { saleDate: '2026-08-15', sales: 80 },
      { saleDate: '2026-08-16', sales: 100 },
    ], '2024-01-01', '2026-08-16', 'prior_period');

    expect(result.slice(0, 2)).toMatchObject([
      { label: 'Today so far', current: { from: '2026-08-16', sales: 100 }, comparison: { from: '2026-08-15', sales: 80 } },
      { label: 'Yesterday', current: { from: '2026-08-15', sales: 80 }, comparison: { from: '2026-08-14', sales: 60 }, changePercent: 100 / 3 },
    ]);
  });

  it('hides periods whose comparison baseline predates the first sale', () => {
    const result = buildDashboardSalesComparisons(rows, '2026-08-10', '2026-08-16', 'prior_period');

    expect(result.map(period => period.label)).toEqual(['Today so far', 'Yesterday']);
  });

  it('uses the same calendar dates last year', () => {
    const result = buildDashboardSalesComparisons(rows, '2025-01-01', '2026-08-16', 'year_ago');

    expect(result[0]).toMatchObject({
      comparison: { from: '2025-08-16', to: '2025-08-16', sales: 50 },
      changePercent: 100,
    });
  });

  it('clamps leap day to the final day of February', () => {
    const result = buildDashboardSalesComparisons([], '2023-01-01', '2024-02-29', 'year_ago');

    expect(result[0].comparison).toMatchObject({ from: '2023-02-28', to: '2023-02-28' });
  });
});

describe('earliestDashboardComparisonDate', () => {
  it('covers the widest baseline needed by either comparison mode', () => {
    expect(earliestDashboardComparisonDate('2026-08-16')).toBe('2024-08-17');
  });
});