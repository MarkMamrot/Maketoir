/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseOrderMoveItemsModal } from '../PurchaseOrderMoveItemsModal';

const preview = {
  source: { id: 10, orderNumber: 'PO-10', status: 'partially_received', updatedAt: '2026-09-01T00:00:00.000Z', conflicts: [] },
  lines: [{
    itemId: 101, variantId: 'variant-1', sku: 'SKU-1', productName: 'Blue Shirt', isStockItem: true,
    orderedQuantity: 10, receivedQuantity: 3, outstandingQuantity: 7, protectedQuantity: 5, freeQuantity: 2,
    allocations: [
      { allocationId: 501, revision: 2, salesOrderId: 40, salesOrderItemId: 401,
        salesOrderNumber: 'SO-40', customerName: 'Customer A', promisedDate: '2026-10-20',
        priority: 10, promiseStatus: 'confirmed', movableQuantity: 3 },
      { allocationId: 502, revision: 1, salesOrderId: 41, salesOrderItemId: 411,
        salesOrderNumber: 'SO-41', customerName: 'Customer B', promisedDate: null,
        priority: 20, promiseStatus: 'planned', movableQuantity: 2 },
    ],
  }],
  eligibleTargets: [{
    id: 20, orderNumber: 'PO-20', updatedAt: '2026-09-02T00:00:00.000Z', supplierName: 'Supply Co',
    locationName: 'Warehouse', orderDate: '2026-09-02', status: 'confirmed', outstandingQuantity: 2, conflicts: [],
  }],
  excludedTargets: [],
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('PurchaseOrderMoveItemsModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? response({ success: true, data: { sourceOrderId: 10, targetOrderId: 20 } })
      : response({ success: true, data: preview })));
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'po-operation-1') });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('submits exact named customer promises and their reviewed revisions', async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    render(<PurchaseOrderMoveItemsModal order={{ id: 10, po_number: 'PO-10' }} onClose={vi.fn()} onMoved={onMoved} />);

    expect(await screen.findByText(/Blue Shirt/)).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: /Quantity to move for Blue Shirt/ }) as HTMLInputElement).value).toBe('2');
    await user.click(screen.getByRole('button', { name: 'All outstanding' }));
    expect((screen.getByRole('spinbutton', { name: /Promise quantity for SO-40/ }) as HTMLInputElement).value).toBe('3');
    await user.click(screen.getByRole('button', { name: /Choose destination/ }));
    await user.click(screen.getByRole('radio', { name: /PO-20/ }));
    await user.click(screen.getByRole('button', { name: /Review move/ }));
    expect((screen.getByRole('button', { name: /Move selected items/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /I understand PO-10 will close/ }));
    await user.click(screen.getByRole('button', { name: /Move selected items/ }));

    expect(fetch).toHaveBeenLastCalledWith('/api/ims/purchase-orders/10/transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationMode: 'existing', targetOrderId: 20, operationKey: 'po-operation-1',
        expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z',
        expectedTargetUpdatedAt: '2026-09-02T00:00:00.000Z',
        lines: [{ sourceItemId: 101, quantity: 7, allocations: [
          { allocationId: 501, revision: 2, quantity: 3 },
          { allocationId: 502, revision: 1, quantity: 2 },
        ] }],
      }),
    });
    expect(onMoved).toHaveBeenCalledOnce();
  });

  it('creates a new destination without posting an existing order ID', async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderMoveItemsModal order={{ id: 10, po_number: 'PO-10' }} onClose={vi.fn()} />);

    await screen.findByText(/Blue Shirt/);
    await user.click(screen.getByRole('button', { name: /Choose destination/ }));
    await user.click(screen.getByRole('radio', { name: /Create new Purchase Order/ }));
    await user.click(screen.getByRole('button', { name: /Review move/ }));
    expect(screen.getByText((_, element) => element?.tagName === 'STRONG'
      && element.textContent?.includes('New Purchase Order') === true)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Move selected items/ }));

    const [, request] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(JSON.parse(String(request?.body))).toEqual(expect.objectContaining({
      destinationMode: 'new', targetOrderId: null, expectedTargetUpdatedAt: null,
    }));
  });

  it('blocks destination selection when unselected promises would be stranded', async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderMoveItemsModal order={{ id: 10, po_number: 'PO-10' }} onClose={vi.fn()} />);
    const quantityInput = await screen.findByRole('spinbutton', { name: /Quantity to move for Blue Shirt/ });
    await user.clear(quantityInput);
    await user.type(quantityInput, '7');
    expect(screen.getByRole('alert').textContent).toContain('Select more customer promise quantity');
    expect((screen.getByRole('button', { name: /Choose destination/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains why an existing Purchase Order cannot be selected', async () => {
    const excludedPreview = {
      ...preview,
      excludedTargets: [{
        ...preview.eligibleTargets[0], id: 30, orderNumber: 'PO-30',
        conflicts: ['Supplier does not match the source Purchase Order.'],
      }],
    };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? response({ success: true, data: { sourceOrderId: 10, targetOrderId: 20 } })
      : response({ success: true, data: excludedPreview })));
    const user = userEvent.setup();
    render(<PurchaseOrderMoveItemsModal order={{ id: 10, po_number: 'PO-10' }} onClose={vi.fn()} />);

    await screen.findByText(/Blue Shirt/);
    await user.click(screen.getByRole('button', { name: /Choose destination/ }));
    await user.click(screen.getByText(/Why can’t I select an order\?/));

    expect(screen.getByText('PO-30')).toBeTruthy();
    expect(screen.getByText('Supplier does not match the source Purchase Order.')).toBeTruthy();
  });
});
