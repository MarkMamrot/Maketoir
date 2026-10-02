/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SalesOrderMoveItemsModal } from '../SalesOrderMoveItemsModal';

const preview = {
  source: { id: 7, orderNumber: 'SO-7', status: 'confirmed', updatedAt: null, conflicts: [] },
  lines: [{
    itemId: 11,
    variantId: 'variant-1',
    sku: 'SKU-1',
    productName: 'Blue Shirt',
    orderedQuantity: 10,
    processedQuantity: 2,
    rules: { outstanding: 8, unavailableNow: 5, readyNow: 3, allocatedIncoming: 4, unallocatedShortage: 1 },
  }],
  eligibleTargets: [{
    id: 8,
    orderNumber: 'SO-8',
    updatedAt: '2026-09-02T10:00:00.000Z',
    customerName: 'Acme Retail',
    locationName: 'Warehouse',
    orderDate: '2026-09-02',
    status: 'backordered',
    externalReference: 'PO-99',
    outstandingQuantity: 2,
    conflicts: [],
  }],
  excludedTargets: [{
    id: 9,
    orderNumber: 'SO-9',
    customerName: 'Acme Retail',
    locationName: 'Other Store',
    orderDate: '2026-09-03',
    status: 'confirmed',
    externalReference: 'PO-99',
    outstandingQuantity: 4,
    conflicts: ['Location does not match.', 'Destination order has payments.'],
  }],
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('SalesOrderMoveItemsModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? response({ success: true, data: { sourceOrderId: 7, targetOrderId: 8 } })
      : response({ success: true, data: preview })));
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'operation-1') });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reviews and submits quantities with an explicit protected incoming mix', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onMoved = vi.fn();
    render(<SalesOrderMoveItemsModal order={{ id: 7, so_number: 'SO-7' }} onClose={onClose} onMoved={onMoved} />);

    expect(await screen.findByText('Blue Shirt')).toBeTruthy();
    expect((screen.getByRole('dialog').firstElementChild as HTMLElement).style.background).toContain('--sv-bg-1');
    expect((screen.getByRole('dialog').firstElementChild as HTMLElement).style.color).toContain('--sv-text-strong');
    expect(fetch).toHaveBeenCalledWith('/api/ims/sales-orders/7/transfers/preview', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await user.click(screen.getByRole('button', { name: /Ready now/ }));
    expect((screen.getByRole('spinbutton', { name: 'Quantity to move' }) as HTMLInputElement).value).toBe('3');
    const incomingInput = screen.getByRole('spinbutton', { name: /Protected incoming to move/ });
    expect((incomingInput as HTMLInputElement).value).toBe('3');
    await user.clear(incomingInput);
    await user.type(incomingInput, '1.5');

    await user.click(screen.getByRole('button', { name: 'Choose destination' }));
    await user.click(screen.getByRole('radio', { name: /SO-8/ }));
    expect(screen.getByRole('status').textContent).toContain('SO-7 to SO-8');

    await user.click(screen.getByText('1 other order(s) cannot receive these items'));
    const excluded = screen.getByText('SO-9').parentElement!;
    expect(within(excluded).getByText(/Location does not match/)).toBeTruthy();
    expect(within(excluded).getByText(/has payments/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Review move' }));
    expect(screen.getByText('1.5 protected incoming follows')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Move selected items' }));

    expect(fetch).toHaveBeenLastCalledWith('/api/ims/sales-orders/7/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationMode: 'existing',
        targetOrderId: 8,
        operationKey: 'operation-1',
        expectedSourceUpdatedAt: null,
        expectedTargetUpdatedAt: '2026-09-02T10:00:00.000Z',
        lines: [{ sourceItemId: 11, quantity: 3, allocatedIncomingQuantity: 1.5 }],
      }),
    });
    expect(onMoved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('can create a new destination from the reviewed source terms', async () => {
    const user = userEvent.setup();
    render(<SalesOrderMoveItemsModal order={{ id: 7, so_number: 'SO-7' }} onClose={vi.fn()} />);

    expect(await screen.findByText('Blue Shirt')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Choose destination' }));
    await user.click(screen.getByRole('radio', { name: /Create new Sales Order/ }));
    expect(screen.getByRole('status').textContent).toContain('a new Confirmed Sales Order');
    await user.click(screen.getByRole('button', { name: 'Review move' }));
    expect(screen.getByText('New Sales Order')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Move selected items' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /I understand SO-7 will close/ }));
    await user.click(screen.getByRole('button', { name: 'Move selected items' }));

    const [, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      destinationMode: 'new',
      targetOrderId: null,
      expectedTargetUpdatedAt: null,
    }));
  });

  it('keeps the destination step unavailable when the source has blockers', async () => {
    vi.mocked(fetch).mockResolvedValue(response({
      success: true,
      data: { ...preview, source: { ...preview.source, conflicts: ['Source order has payments.'] } },
    }));
    render(<SalesOrderMoveItemsModal order={{ id: 7, so_number: 'SO-7' }} onClose={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain('Source order has payments.');
    expect((screen.getByRole('button', { name: 'Choose destination' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('spinbutton', { name: 'Quantity to move' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('shows API failures without stale planning controls', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ success: false, error: 'Sales order was not found.' }, 409));
    render(<SalesOrderMoveItemsModal order={{ id: 7, so_number: 'SO-7' }} onClose={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain('Sales order was not found.');
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});