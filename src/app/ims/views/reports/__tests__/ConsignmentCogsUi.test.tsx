/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CogsTraceabilityView } from '../CogsTraceabilityView';
import { ConsignmentCogsExclusions } from '../ConsignmentCogsExclusions';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const report = {
  success: true, rows: [], total: 0, allocations: [], availability: {},
  summary: { sales: 500, discount: 0, netSales: 500, cogs: 150, gp: 350, gpPercent: 70, costedRecords: 3, missingCosts: 0, missingRevenue: 0 },
  reconciliation: {
    scope: 'Internal COGS includes consignment; Xero intentionally excludes it.',
    recordedMovementCogs: 150, selectedMovementCogs: 150, ownedMovementCogs: 100,
    excludedConsignmentMovementCogs: 50, excludedConsignmentMovements: 2,
    otherMovementTypesCogs: 0, missingMovementCosts: 0, outsideSalePeriodMovements: 0, allocationRoundingDifference: 0,
    accounting: { totalCOGS: 100, excludedConsignmentCOGS: 50, excludedConsignmentQuantity: 5, excludedConsignmentMovementCount: 2,
      excludedHistoricalMovementCount: 0, orphanedMovementCount: 0, excludedNonStockMovementCount: 0,
      missingCostMovementCount: 0, zeroCostMovementCount: 0, blocked: false },
  },
};

describe('Consignment COGS presentation', () => {
  it('keeps signed exclusions separate from internal cost evidence', () => {
    render(<ConsignmentCogsExclusions calculation={{ excludedConsignmentCOGS: -25, excludedConsignmentQuantity: 3, excludedConsignmentMovementCount: 2 }} />);
    const note = screen.getByRole('note').textContent;
    expect(note).toContain('-$25.00');
    expect(note).toContain('3 units');
    expect(note).toContain('2 movements');
    expect(note).toContain('not a missing-cost or posting gap');
  });

  it('sends an exact ownership filter and permits ownership grouping', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => report });
    vi.stubGlobal('fetch', fetcher);
    render(<CogsTraceabilityView onBack={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Stock Ownership filter'), 'Consignment');
    await waitFor(() => {
      const url = new URL(String(fetcher.mock.calls.at(-1)?.[0]), 'http://localhost');
      expect(JSON.parse(url.searchParams.get('filters') || '[]')).toEqual([{ field: 'ownership', operator: 'equals', value: 'Consignment' }]);
    });
    await userEvent.selectOptions(screen.getByLabelText('Grouping 1'), 'ownership');
    await waitFor(() => expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('groups=ownership'));
  });

  it('distinguishes owned reconciliation and intentional exclusions without removing internal COGS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
    render(<CogsTraceabilityView onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Reconciliation' }));
    expect(await screen.findByText('Recorded owned movement COGS')).toBeTruthy();
    expect(screen.getByText('Internal consignment movement COGS intentionally excluded')).toBeTruthy();
    expect(screen.getByText('Eligible owned accounting COGS')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('$50.00');
    expect(screen.getByTestId('cogs-total-cogs').textContent).toBe('$150.00');
  });
});
