/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesOrderFulfilmentModal } from '../SalesOrderFulfilmentModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SalesOrderFulfilmentModal', () => {
  it('shows a direct full fulfilment action and reveals remainder choices only for a partial quantity', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <SalesOrderFulfilmentModal
        order={{ id: 42, so_number: 'SO-42', updated_at: '2026-10-02T00:00:00.000Z' }}
        items={[{ id: 7, sku: 'SKU-7', qty_ordered: 1, qty_fulfilled: 0 }]}
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Fulfil order' })).toBeTruthy();
    expect(screen.queryByText('Partially fulfil now')).toBeNull();
    expect(screen.queryByText('Create backorder for remainder')).toBeNull();

    const quantity = screen.getByTestId('so-fulfil-qty-7');
    await user.clear(quantity);
    await user.type(quantity, '0.5');

    expect(screen.getByText('Partially fulfil now')).toBeTruthy();
    expect(screen.getByText('Create backorder for remainder')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue fulfilment' })).toBeTruthy();

    await user.click(screen.getByTestId('so-fulfil-mode-backorder'));
    await user.clear(quantity);
    await user.type(quantity, '1');
    await user.click(screen.getByRole('button', { name: 'Fulfil order' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/ims/sales-orders/42/fulfil', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('warns that actual COGS will remain unresolved before confirming negative stock', async () => {
    const fulfilResponses = [
      new Response(JSON.stringify({
        code: 'STOCK_SHORTFALL',
        shortfalls: [{
          itemId: 7,
          quantityOnHand: 0,
          requestedQuantity: 1,
          resultingQuantityOnHand: -1,
          actualCostUnavailable: true,
        }],
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('build-preview')
        ? new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : fulfilResponses.shift()!
    ));
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onResolved = vi.fn();
    const user = userEvent.setup();

    render(
      <SalesOrderFulfilmentModal
        order={{ id: 42, so_number: 'SO-42', updated_at: '2026-10-02T00:00:00.000Z' }}
        items={[{ id: 7, sku: 'SKU-7', qty_ordered: 1, qty_fulfilled: 0 }]}
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Fulfil order' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(
      'actual COGS for these shipped units will remain unresolved',
    ));
    const retryPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryPayload).toMatchObject({ allowNegativeStock: true, shipmentQuantities: [{ itemId: 7, quantity: 1 }] });
    expect(onResolved).toHaveBeenCalledOnce();
  });
});