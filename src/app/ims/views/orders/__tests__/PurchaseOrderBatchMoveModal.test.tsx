/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseOrderBatchMoveModal } from '../PurchaseOrderBatchMoveModal';

const orders = [
  { id: 10, po_number: 'PO-10', supplier_name: 'Supply Co', location_name: 'Warehouse', status: 'confirmed' },
  { id: 20, po_number: 'PO-20', supplier_name: 'Supply Co', location_name: 'Warehouse', status: 'partially_received' },
];

function preview(sourceId: number) {
  const targetId = sourceId === 10 ? 20 : 10;
  return {
    source: { id: sourceId, orderNumber: `PO-${sourceId}`, status: sourceId === 20 ? 'partially_received' : 'confirmed', updatedAt: `2026-09-0${sourceId === 10 ? 3 : 1}T00:00:00.000Z`, conflicts: [] },
    lines: [{
      itemId: sourceId * 10 + 1, variantId: `variant-${sourceId}`, sku: `SKU-${sourceId}`,
      productName: `Product ${sourceId}`, isStockItem: true, orderedQuantity: 6, receivedQuantity: sourceId === 20 ? 2 : 0,
      outstandingQuantity: sourceId === 20 ? 4 : 6, protectedQuantity: sourceId === 20 ? 2 : 0,
      freeQuantity: sourceId === 20 ? 2 : 6,
      allocations: sourceId === 20 ? [{ allocationId: 501, revision: 2, salesOrderId: 40, salesOrderItemId: 401,
        salesOrderNumber: 'SO-40', customerName: 'Customer A', promisedDate: null, priority: 10,
        promiseStatus: 'confirmed', movableQuantity: 2 }] : [],
    }],
    eligibleTargets: [{ id: targetId, orderNumber: `PO-${targetId}`, updatedAt: null, supplierName: 'Supply Co',
      locationName: 'Warehouse', orderDate: '2026-09-01', status: 'confirmed', outstandingQuantity: 2, conflicts: [] }],
    excludedTargets: [],
  };
}

function response(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('PurchaseOrderBatchMoveModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ success: true, data: { targetOrderId: 10 } });
      const sourceId = Number(url.match(/purchase-orders\/(\d+)\//)?.[1]);
      return response({ success: true, data: preview(sourceId) });
    }));
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'po-batch-operation-1') });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requires each named promise and submits all outstanding supply atomically', async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    render(<PurchaseOrderBatchMoveModal orders={orders} onClose={vi.fn()} onMoved={onMoved} />);

    await screen.findByText('Combine 2 Purchase Orders');
    await user.click(screen.getByRole('radio', { name: /PO-10/ }));
    await user.click(screen.getByRole('button', { name: 'Review promises' }));
    expect((screen.getByRole('button', { name: 'Review move' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /SO-40/ }));
    await user.click(screen.getByRole('button', { name: 'Review move' }));
    await user.click(screen.getByRole('checkbox', { name: /source Purchase Orders will close/ }));
    await user.click(screen.getByRole('button', { name: 'Move into one order' }));

    expect(fetch).toHaveBeenLastCalledWith('/api/ims/purchase-orders/transfers/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetOrderId: 10,
        expectedTargetUpdatedAt: '2026-09-03T00:00:00.000Z',
        operationKey: 'po-batch-operation-1',
        sources: [{ sourceOrderId: 20, expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z', lines: [{
          sourceItemId: 201, quantity: 4,
          allocations: [{ allocationId: 501, revision: 2, quantity: 2 }],
        }] }],
      }),
    });
    expect(onMoved).toHaveBeenCalledOnce();
  });
});
