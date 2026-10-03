/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { summarizeSalesOrderCogs } from '@/lib/ims/salesOrderCogs';
import { SalesOrderCogsDetail, type SalesOrderCogsDisplayLine } from '../SalesOrderCogsDetail';

afterEach(cleanup);

function renderCostDetail(input: {
  qtyOrdered: number;
  qtyFulfilled: number;
  capturedUnitCost: number | null;
  estimatedUnitCost: number | null;
}) {
  const summary = summarizeSalesOrderCogs([{
    qtyOrdered: input.qtyOrdered,
    qtyFulfilled: input.qtyFulfilled,
    capturedUnitCost: input.capturedUnitCost,
    estimatedUnitCost: input.estimatedUnitCost,
  }]);
  const line: SalesOrderCogsDisplayLine = {
    sku: 'MT-CRFLowerCol',
    qtyFulfilled: summary.lines[0].qtyFulfilled,
    qtyRemaining: summary.lines[0].qtyRemaining,
    actualCogs: summary.lines[0].actualCogs,
    estimatedRemainingCogs: summary.lines[0].estimatedRemainingCogs,
    revenue: 9,
    marginPct: summary.grossMarginAvailable && summary.lines[0].actualCogs !== null
      ? ((9 - summary.lines[0].actualCogs) / 9) * 100
      : null,
    isStockItem: true,
  };

  return render(
    <SalesOrderCogsDetail
      lines={[line]}
      summary={summary}
      revenue={9}
      currency="AUD"
      grossProfit={summary.grossMarginAvailable && summary.actualCogs !== null ? 9 - summary.actualCogs : null}
      grossMarginPct={summary.grossMarginAvailable && summary.actualCogs !== null ? ((9 - summary.actualCogs) / 9) * 100 : null}
    />,
  );
}

describe('SalesOrderCogsDetail', () => {
  it('shows unresolved actual COGS and a separate estimate for a zero-cost shipped line', () => {
    renderCostDetail({ qtyOrdered: 4, qtyFulfilled: 4, capturedUnitCost: 0, estimatedUnitCost: 1.3829 });

    expect(screen.getAllByText('Unresolved').length).toBeGreaterThan(0);
    expect(screen.getByText('Some shipped stock has no positive cost captured; actual COGS and gross margin are unresolved.')).toBeTruthy();
    expect(screen.queryByText('$5.53')).toBeNull();
    const itemCells = screen.getAllByRole('row')[1].querySelectorAll('td');
    expect(itemCells[4].textContent).toBe('—');
    expect(itemCells[6].textContent).toBe('—');
  });

  it('shows the current estimate only for remaining units and excludes it from margin', () => {
    renderCostDetail({ qtyOrdered: 6, qtyFulfilled: 4, capturedUnitCost: 2.5, estimatedUnitCost: 3 });

    expect(screen.getByText('Estimate (AUD)')).toBeTruthy();
    const itemCells = screen.getAllByRole('row')[1].querySelectorAll('td');
    expect(itemCells[3].textContent).toBe('$10.00');
    expect(itemCells[4].textContent).toBe('$6.00');
    expect(itemCells[6].textContent).toBe('—');
  });
});