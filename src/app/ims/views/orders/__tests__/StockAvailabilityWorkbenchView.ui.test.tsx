/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockAvailabilityWorkbenchView } from '../StockAvailabilityWorkbenchView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StockAvailabilityWorkbenchView', () => {
  it('shows required-date/FIFO priority and physical readiness', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: [{
        so_id: 42,
        so_item_id: 10,
        so_number: 'SO-42',
        status: 'confirmed',
        customer_name: 'Example Retailer',
        location_name: 'Main Warehouse',
        sku: 'SKU-1',
        product_name: 'Example product',
        variant_label: null,
        supplier_names: 'Example Supplier',
        expected_date: '2026-10-08',
        earliest_incoming_date: '2026-10-10',
        qty_on_hand: 5,
        outstanding: 4,
        protected: 2,
        ready: 1,
        incoming: 1,
        unsourced: 2,
        priorityPosition: 2,
        readyNowQuantity: 3,
        protectedIncomingQuantity: 1,
        shortfallNowQuantity: 1,
        issues: ['unsourced', 'ready', 'incoming'],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    render(<StockAvailabilityWorkbenchView isAdvisor={false} onOpenSalesOrder={vi.fn()} />);

    expect(await screen.findByText('SO-42')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('Ready now')).toBeTruthy();
    expect(screen.getByText('Protected incoming')).toBeTruthy();
    expect(screen.getByText('Shortfall')).toBeTruthy();
    expect(screen.getByText('Required')).toBeTruthy();
  });

  it('reviews and submits selected suggestions as one batch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('suggestions=true')) return new Response(JSON.stringify({
        success: true,
        data: [{
          soId: 42, soItemId: 10, soNumber: 'SO-42', customerName: 'Example Retailer',
          requiredDate: '2026-10-08', priorityPosition: 1, sku: 'SKU-1', productName: 'Product',
          locationName: 'Main', poId: 20, poItemId: 21, poNumber: 'PO-20', supplierName: 'Supplier',
          expectedDate: '2026-10-10', quantity: 3,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<StockAvailabilityWorkbenchView isAdvisor={false} onOpenSalesOrder={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Review suggestions' }));
    expect(await screen.findByText('SO-42')).toBeTruthy();
    expect(screen.getByText('PO-20')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Apply selected' }));

    const batchCall = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/api/ims/stock-allocations') && init?.method === 'POST');
    expect(batchCall).toBeTruthy();
    expect(JSON.parse(String(batchCall?.[1]?.body))).toMatchObject({
      allocations: [{ soItemId: 10, poItemId: 21, quantity: 3, priority: 1 }],
    });
  });
});