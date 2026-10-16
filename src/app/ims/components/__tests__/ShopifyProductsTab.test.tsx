/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopifyInstanceScope, ShopifyProductsTab } from '../ShopifyView';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderTab() {
  return render(
    <ShopifyInstanceScope instance={{ channelInstanceId: 'shopify-1', displayName: 'Retail Shopify' }}>
      <ShopifyProductsTab />
    </ShopifyInstanceScope>,
  );
}

describe('ShopifyProductsTab', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads exact-store products and places catalogue import after the table', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      success: true,
      data: [{
        product_id: 'product-1',
        name: 'Peeking Pups',
        brand: 'Monsterthreads',
        shopify_status: 'linked',
        variants: [{ price: 49.95 }],
      }],
    }));

    renderTab();

    const linkedButton = await screen.findByRole('button', { name: 'Linked (1)' });
    await user.click(linkedButton);
    expect(screen.getByText('Peeking Pups')).toBeTruthy();
    const table = screen.getByRole('table');
    const importHeading = screen.getByRole('heading', { name: 'Import Products from Shopify' });
    expect(table.compareDocumentPosition(importHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/ims/shopify/products?channelInstanceId=shopify-1');
  });

  it('shows an API failure with a retry instead of false zero counts', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: false, error: 'Product mappings could not be read.' }, 500));

    renderTab();

    expect((await screen.findByRole('alert')).textContent).toContain('Product mappings could not be read.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'All (0)' })).toBeNull();
  });

  it('warns before importing and sends the Product SKU checkbox choice', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [], fetched: 0, has_more: false }));
    renderTab();
    await screen.findByRole('heading', { name: 'Import Products from Shopify' });
    expect(screen.getByText(/Designed for onboarding/)).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Auto-create missing Product SKUs' }));
    await user.click(screen.getByRole('button', { name: 'Import from Shopify' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/ims/shopify/import-products', expect.any(Object)));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/ims/shopify/import-products')?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ channelInstanceId: 'shopify-1', auto_create_product_skus: false });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('normally create products in Solvantis'));
  });

  it('maps different location names and requires the exact safety phrase before apply', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url !== '/api/ims/shopify/opening-stock') return jsonResponse({ success: true, data: [] });
      const body = JSON.parse(String(init?.body));
      if (body.mode === 'locations') return jsonResponse({
        success: true, shopifyLocations: [{ id: 10, name: 'Shop Main' }],
        solvantisLocations: [{ id: 1, name: 'Retail' }],
      });
      if (body.mode === 'preview') return jsonResponse({
        success: true, total_variants: 1, has_more: false,
        apply_batches: [{ offset: 0, variant_ids: ['v1'], snapshot: 'signed' }],
        lines: [{ locationName: 'Retail', quantity: 8, currentQuantity: 1, adjustment: 7, wasNegative: false }],
      });
      return jsonResponse({ success: true, variants: 1, stocktakes: [{ id: 123 }] });
    });
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Load Shopify and Solvantis Locations' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Solvantis location for Shop Main' }), '1');
    await user.click(screen.getByRole('button', { name: 'Preview Inventory Download' }));
    const applyButton = await screen.findByRole('button', { name: 'Replace Solvantis Stock' });
    expect(applyButton.hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Inventory safety phrase' }), 'replace solvantis stock');
    expect(applyButton.hasAttribute('disabled')).toBe(true);
    await user.clear(screen.getByRole('textbox', { name: 'Inventory safety phrase' }));
    await user.type(screen.getByRole('textbox', { name: 'Inventory safety phrase' }), 'REPLACE SOLVANTIS STOCK');
    expect(applyButton.hasAttribute('disabled')).toBe(false);
    await user.click(applyButton);
    await screen.findByText(/Stocktakes: 123/);
    const bodies = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/ims/shopify/opening-stock')
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.find(body => body.mode === 'preview').mappings).toEqual([{ shopifyLocationId: 10, solvantisLocationId: 1 }]);
    expect(bodies.find(body => body.mode === 'apply')).toMatchObject({ confirmation: 'REPLACE SOLVANTIS STOCK', channelInstanceId: 'shopify-1' });
  });

  async function prepareOpeningStock() {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Load Shopify and Solvantis Locations' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Solvantis location for Shop Main' }), '1');
    await user.click(screen.getByRole('button', { name: 'Preview Inventory Download' }));
    await user.type(await screen.findByRole('textbox', { name: 'Inventory safety phrase' }), 'REPLACE SOLVANTIS STOCK');
    return user;
  }

  function openingStockFetch(apply: () => Promise<Response>, batches = 1) {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url !== '/api/ims/shopify/opening-stock') return jsonResponse({ success: true, data: [] });
      const body = JSON.parse(String(init?.body));
      if (body.mode === 'locations') return jsonResponse({
        success: true, shopifyLocations: [{ id: 10, name: 'Shop Main' }], solvantisLocations: [{ id: 1, name: 'Retail' }],
      });
      if (body.mode === 'preview') return jsonResponse({
        success: true, total_variants: batches, has_more: false,
        apply_batches: Array.from({ length: batches }, (_, offset) => ({ offset, variant_ids: [`v${offset}`], snapshot: 'signed' })),
        lines: [{ locationName: 'Retail', quantity: 8, currentQuantity: 1, adjustment: 7, wasNegative: false }],
      });
      if (body.mode === 'prepare') return jsonResponse({ success: true, stocktakes: [{ id: 123 }] });
      return apply();
    });
  }

  it('shows batch progress and clears the busy state when the last batch finishes', async () => {
    let finish!: (response: Response) => void;
    const apply = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, variants: 1, stocktakes: [{ id: 123 }] }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    openingStockFetch(apply, 2);
    const user = await prepareOpeningStock();

    await user.click(screen.getByRole('button', { name: 'Replace Solvantis Stock' }));

    await screen.findByText('Applying batch 2 of 2');
    expect(screen.getByText('1 variant confirmed applied. Keep this page open.')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: 'Opening stock import progress' });
    expect(progress.getAttribute('value')).toBe('1');
    expect(progress.getAttribute('max')).toBe('2');
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    await act(async () => finish(jsonResponse({ success: true, variants: 1, stocktakes: [{ id: 123 }] })));

    expect(await screen.findByText(/Opening stock applied for 2 variants/)).toBeTruthy();
    expect(screen.getByText('Stocktakes: 123')).toBeTruthy();
    expect(screen.getByText('View 1 stocktake')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Applying…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview Inventory Download' }).hasAttribute('disabled')).toBe(false);
  });

  it.each(['timeout', 'proxy timeout', 'server error'])('recovers from %s without silently retrying or leaving Applying stuck', async failure => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const apply = vi.fn(async () => {
      if (failure === 'timeout') throw Object.assign(new Error('Timed out'), { name: 'TimeoutError' });
      if (failure === 'proxy timeout') return new Response('Gateway timeout', { status: 524 });
      return jsonResponse({ success: false, error: 'Stocktake apply failed.' }, 500);
    });
    openingStockFetch(apply);
    const user = await prepareOpeningStock();
    await user.click(screen.getByRole('button', { name: 'Replace Solvantis Stock' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('retry this prepared import without duplicating adjustments');
    if (failure !== 'server error') expect(alert.textContent).toContain('server may still finish');
    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Applying…' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Inventory safety phrase' }).getAttribute('value')).toBe('');
    expect(screen.getByRole('button', { name: 'Replace Solvantis Stock' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Preview Inventory Download' }).hasAttribute('disabled')).toBe(false);
  });

  it('retains confirmed stocktake references after an interruption partway through', async () => {
    const apply = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, variants: 1, stocktakes: [{ id: 123 }] }))
      .mockRejectedValueOnce(new Error('Connection lost'));
    openingStockFetch(apply, 2);
    const user = await prepareOpeningStock();
    await user.click(screen.getByRole('button', { name: 'Replace Solvantis Stock' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Confirmed batches are safe');
    expect(screen.getByText(/1 variant confirmed applied before the interruption/)).toBeTruthy();
    expect(screen.getByText('Stocktakes: 123')).toBeTruthy();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('progressbar')).toBeNull();

    apply.mockImplementation(async () => jsonResponse({ success: true, variants: 1, stocktakes: [{ id: 123 }] }));
    await user.type(screen.getByRole('textbox', { name: 'Inventory safety phrase' }), 'REPLACE SOLVANTIS STOCK');
    await user.click(screen.getByRole('button', { name: 'Replace Solvantis Stock' }));
    expect(await screen.findByText(/Opening stock applied for 2 variants/)).toBeTruthy();
    const preparations = vi.mocked(fetch).mock.calls
      .filter(([url]) => url === '/api/ims/shopify/opening-stock')
      .map(([, init]) => JSON.parse(String(init?.body)))
      .filter(body => body.mode === 'prepare');
    expect(preparations).toHaveLength(2);
    expect(preparations[1]).toEqual(preparations[0]);
    expect(screen.getByText('Stocktakes: 123')).toBeTruthy();
  });
});