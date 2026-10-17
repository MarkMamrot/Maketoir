/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopifyInstanceScope, ShopifyOrdersTab } from '../ShopifyView';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ShopifyOrdersTab fulfilment reconciliation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/ims/locations') return json({ success: true, data: [] });
      if (url.endsWith('/shopify/settings')) return json({
        success: true,
        settings: { orders: { enabled: true, syncFrom: '2026-09-01', locationId: 7 } },
      });
      if (url.endsWith('/shopify/reconcile-fulfilments')) return json({
        success: true,
        windowStart: '2026-09-30T12:00:00.000Z',
        windowEnd: '2026-10-02T00:00:00.000Z',
        scanned: 5,
        providerFulfilled: 3,
        repaired: [{ salesOrderId: 44, shopifyOrderId: '1001' }],
        alreadyCurrent: 1,
        missingLocal: [],
        reviewRequired: [],
        failures: [],
      });
      throw new Error(`Unexpected request: ${url}`);
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs only the scoped storefront and displays the returned counts', async () => {
    const user = userEvent.setup();
    render(
      <ShopifyInstanceScope instance={{ channelInstanceId: 'store-1', displayName: 'Retail Store' }}>
        <ShopifyOrdersTab section="orders" canManage />
      </ShopifyInstanceScope>,
    );

    const hours = await screen.findByRole('spinbutton', { name: 'Hours to check' });
    await user.clear(hours);
    await user.type(hours, '72');
    const button = screen.getByRole('button', { name: 'Check last 72 hours' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await user.click(button);

    expect(window.confirm).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/api/ims/channels/store-1/shopify/reconcile-fulfilments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours: 72 }),
    });
    expect(await screen.findByText('Repaired')).toBeTruthy();
    expect(screen.getByText('Repaired').parentElement?.textContent).toBe('Repaired1');
    expect(screen.getByText('Already current').parentElement?.textContent).toBe('Already current1');
  });

  it('disables the action for read-only users', async () => {
    render(
      <ShopifyInstanceScope instance={{ channelInstanceId: 'store-1', displayName: 'Retail Store' }}>
        <ShopifyOrdersTab section="orders" canManage={false} />
      </ShopifyInstanceScope>,
    );

    const button = await screen.findByRole('button', { name: 'Check last 36 hours' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Administrator access is required.')).toBeTruthy();
  });

  it('reports active import requests as queued without completed-import counts', async () => {
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/ims/shopify/import-orders') {
        return json({ success: true, queued: true, channelInstanceId: 'store-1' }, 202);
      }
      return original(input, init);
    });
    render(<ShopifyInstanceScope instance={{ channelInstanceId: 'store-1', displayName: 'Retail Store' }}>
      <ShopifyOrdersTab section="orders" canManage />
    </ShopifyInstanceScope>);
    await userEvent.click(await screen.findByRole('button', { name: '📦 Import Orders from Shopify' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('queued for scheduled recovery'));
    expect(screen.queryByText('✓ Import complete')).toBeNull();
    expect(screen.queryByText('Newly imported:')).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/ims/shopify/import-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelInstanceId: 'store-1' }),
    });
  });

  it('retains completed-import counts in legacy mode', async () => {
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/ims/shopify/import-orders') {
        return json({ success: true, total_from_shopify: 7, imported: 4, skipped_existing: 3, skipped_no_items: 0 });
      }
      return original(input, init);
    });
    render(<ShopifyInstanceScope instance={{ channelInstanceId: 'store-1', displayName: 'Retail Store' }}>
      <ShopifyOrdersTab section="orders" canManage />
    </ShopifyInstanceScope>);
    await userEvent.click(await screen.findByRole('button', { name: '📦 Import Orders from Shopify' }));
    await screen.findByText('✓ Import complete');
    expect(screen.getByText('Newly imported:').textContent).toBe('Newly imported: 4');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not let read-only users request an order import', async () => {
    render(<ShopifyInstanceScope instance={{ channelInstanceId: 'store-1', displayName: 'Retail Store' }}>
      <ShopifyOrdersTab section="orders" canManage={false} />
    </ShopifyInstanceScope>);
    const button = await screen.findByRole('button', { name: '📦 Import Orders from Shopify' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(button);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/ims/shopify/import-orders')).toBe(false);
  });
});