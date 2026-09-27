/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
});