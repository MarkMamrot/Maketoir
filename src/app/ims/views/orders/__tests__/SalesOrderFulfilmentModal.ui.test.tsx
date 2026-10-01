/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
});