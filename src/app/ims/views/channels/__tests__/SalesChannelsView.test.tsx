/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SalesChannelsView from '../SalesChannelsView';

const capabilities = {
  catalogue: true,
  inventory: true,
  orders: true,
  fulfilments: true,
  returns: true,
  customers: true,
  giftCards: true,
  loyalty: true,
  settlements: true,
};

const instances = [
  { channelInstanceId: 'shopify-1', provider: 'shopify', providerDisplayName: 'Shopify', displayName: 'Retail Shopify', externalAccountKey: 'retail.myshopify.com' },
  { channelInstanceId: 'amazon-1', provider: 'amazon', providerDisplayName: 'Amazon Australia', displayName: 'Amazon AU', externalAccountKey: 'SELLER123' },
  { channelInstanceId: 'native-1', provider: 'native_shop', providerDisplayName: 'Solvantis Online Store', displayName: 'Online Store', externalAccountKey: 'retail' },
].map(instance => ({
  ...instance,
  enabled: true,
  runtimeStatus: 'active',
  readinessStatus: 'ready',
  lastSyncAt: '2026-09-27T06:37:00.000Z',
  safeError: null,
  settings: {},
  capabilities,
}));

describe('SalesChannelsView', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/ims#sales-channels');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, instances }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders every provider with the compact overview and opens Amazon details', async () => {
    const user = userEvent.setup();
    render(<SalesChannelsView canManage />);

    await screen.findByText('Retail Shopify');
    expect(screen.getAllByText('9 supported features')).toHaveLength(3);
    expect(screen.queryByText('Automatic assignment')).toBeNull();
    expect(screen.queryByText('Sync listings')).toBeNull();

    const amazonRow = screen.getByRole('region', { name: 'Amazon AU' });
    await user.click(within(amazonRow).getByRole('button', { name: 'Configure' }));

    await waitFor(() => expect(window.location.hash).toBe('#sales-channels/amazon/amazon-1'));
    expect(screen.getByRole('heading', { name: 'Connection & readiness' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync listings' })).toBeTruthy();
  });
});