/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesOrderBatchMoveModal } from '../SalesOrderBatchMoveModal';

const orders = [
  { id: 10, so_number: 'SO-10', customer_name: 'Acme', location_name: 'Warehouse', status: 'confirmed' },
  { id: 20, so_number: 'SO-20', customer_name: 'Acme', location_name: 'Warehouse', status: 'backordered' },
  { id: 30, so_number: 'SO-30', customer_name: 'Acme', location_name: 'Warehouse', status: 'partially_fulfilled' },
];

function preview(sourceId: number, targetIds: number[]) {
  return {
    source: {
      id: sourceId,
      orderNumber: `SO-${sourceId}`,
      status: sourceId === 20 ? 'backordered' : 'confirmed',
      updatedAt: `2026-09-${sourceId === 10 ? '03' : sourceId === 20 ? '01' : '02'}T00:00:00.000Z`,
      conflicts: [],
    },
    lines: [{
      itemId: sourceId * 10 + 1,
      variantId: `variant-${sourceId}`,
      sku: `SKU-${sourceId}`,
      productName: `Product ${sourceId}`,
      orderedQuantity: sourceId === 30 ? 5 : 2,
      processedQuantity: sourceId === 30 ? 2 : 0,
      rules: {
        outstanding: sourceId === 30 ? 3 : 2,
        unavailableNow: 1,
        readyNow: 1,
        allocatedIncoming: sourceId === 20 ? 1.5 : 0,
        unallocatedShortage: 0,
      },
    }],
    eligibleTargets: targetIds.map(id => ({
      id, orderNumber: `SO-${id}`, updatedAt: null, customerName: 'Acme', locationName: 'Warehouse',
      orderDate: '2026-09-01', status: 'confirmed', externalReference: null, outstandingQuantity: 1, conflicts: [],
    })),
    excludedTargets: [],
  };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('SalesOrderBatchMoveModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ success: true, data: { targetOrderId: 10 } });
      const sourceId = Number(url.match(/sales-orders\/(\d+)\//)?.[1]);
      return response({ success: true, data: preview(sourceId, [10, 20, 30].filter(id => id !== sourceId)) });
    }));
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'batch-operation-1') });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('submits every source outstanding quantity and reviewed protected incoming amount atomically', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onMoved = vi.fn();
    render(<SalesOrderBatchMoveModal orders={orders} onClose={onClose} onMoved={onMoved} />);

    expect(await screen.findByText('Combine 3 Sales Orders')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /SO-10/ }));
    await user.click(screen.getByRole('button', { name: 'Review quantities' }));

    const protectedInput = screen.getByRole('spinbutton', { name: /Protected incoming from SO-20 for Product 20/ });
    expect((protectedInput as HTMLInputElement).value).toBe('1.5');
    await user.clear(protectedInput);
    await user.type(protectedInput, '1');
    await user.click(screen.getByRole('button', { name: 'Review move' }));

    const submit = screen.getByRole('button', { name: 'Move into one order' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /source Sales Orders will close/ }));
    await user.click(submit);

    expect(fetch).toHaveBeenLastCalledWith('/api/ims/sales-orders/transfers/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetOrderId: 10,
        expectedTargetUpdatedAt: '2026-09-03T00:00:00.000Z',
        operationKey: 'batch-operation-1',
        sources: [{
          sourceOrderId: 20,
          expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z',
          lines: [{ sourceItemId: 201, quantity: 2, allocatedIncomingQuantity: 1 }],
        }, {
          sourceOrderId: 30,
          expectedSourceUpdatedAt: '2026-09-02T00:00:00.000Z',
          lines: [{ sourceItemId: 301, quantity: 3, allocatedIncomingQuantity: 0 }],
        }],
      }),
    });
    expect(onMoved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables a destination rejected by another selected source preview', async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const sourceId = Number(url.match(/sales-orders\/(\d+)\//)?.[1]);
      const data = preview(sourceId, [10, 20, 30].filter(id => id !== sourceId));
      if (sourceId === 20) {
        data.eligibleTargets = data.eligibleTargets.filter(target => target.id !== 10);
        data.excludedTargets = [{
          id: 10, orderNumber: 'SO-10', updatedAt: null, customerName: 'Acme', locationName: 'Warehouse',
          orderDate: '2026-09-01', status: 'confirmed', externalReference: null, outstandingQuantity: 1,
          conflicts: ['Customer PO reference does not match.'],
        }];
      }
      return response({ success: true, data });
    });
    render(<SalesOrderBatchMoveModal orders={orders} onClose={vi.fn()} />);

    const destination = await screen.findByRole('radio', { name: /SO-10/ });
    expect((destination as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/SO-20: Customer PO reference does not match/)).toBeTruthy();
  });
});
