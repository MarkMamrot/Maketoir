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
    qtyOrdered: summary.lines[0].qtyOrdered,
    qtyRemaining: summary.lines[0].qtyRemaining,
    actualCogs: summary.lines[0].actualCogs,
    estimatedRemainingCogs: summary.lines[0].estimatedRemainingCogs,
    isStockItem: true,
  };

  return render(
    <SalesOrderCogsDetail
      lines={[line]}
      summary={summary}
      grossProfit={summary.grossMarginAvailable && summary.actualCogs !== null ? 9 - summary.actualCogs : null}
      grossMarginPct={summary.grossMarginAvailable && summary.actualCogs !== null ? ((9 - summary.actualCogs) / 9) * 100 : null}
    />,
  );
}

describe('SalesOrderCogsDetail', () => {
  it('shows unresolved actual COGS and a separate estimate for a zero-cost shipped line', () => {
    renderCostDetail({ qtyOrdered: 4, qtyFulfilled: 4, capturedUnitCost: 0, estimatedUnitCost: 1.3829 });

    expect(screen.getAllByText('Unresolved').length).toBeGreaterThan(0);
    expect(screen.getByText('Gross margin unavailable: one or more shipped stock lines have unresolved cost.')).toBeTruthy();
    expect(screen.queryByText('$5.53')).toBeNull();
    const itemCells = screen.getAllByRole('row')[1].querySelectorAll('td');
    expect(itemCells[1].textContent).toBe('4 / 4');
    expect(itemCells[3].textContent).toBe('—');
    expect(screen.queryByLabelText('Gross profit and margin')).toBeNull();
  });

  it('shows the current estimate only for remaining units and excludes it from margin', () => {
    renderCostDetail({ qtyOrdered: 6, qtyFulfilled: 4, capturedUnitCost: 2.5, estimatedUnitCost: 3 });

    expect(screen.getByText('Estimate for Remaining (AUD)')).toBeTruthy();
    const itemCells = screen.getAllByRole('row')[1].querySelectorAll('td');
    expect(itemCells[1].textContent).toBe('4 / 6');
    expect(itemCells[2].textContent).toBe('$10.00');
    expect(itemCells[3].textContent).toBe('$6.00');
    expect(screen.getByText('Gross margin available after all units ship with captured cost.')).toBeTruthy();
  });

  it('shows gross profit and margin once when all shipped costs are captured', () => {
    renderCostDetail({ qtyOrdered: 4, qtyFulfilled: 4, capturedUnitCost: 1.38, estimatedUnitCost: 1.38 });

    expect(screen.getByLabelText('Gross profit and margin')).toBeTruthy();
    expect(screen.getByText('Gross Profit')).toBeTruthy();
    expect(screen.getByText('Gross Margin')).toBeTruthy();
    expect(screen.getByText('38.7%')).toBeTruthy();
  });
});