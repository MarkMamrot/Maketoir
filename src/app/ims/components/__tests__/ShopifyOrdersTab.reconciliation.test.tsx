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
});