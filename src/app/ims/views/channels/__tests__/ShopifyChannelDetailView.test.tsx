/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/ShopifyView', () => ({
  ShopifyInstanceScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ShopifyProductsTab: () => <div>Product catalogue</div>,
  ShopifyLogTab: () => <div>Activity log</div>,
  ShopifyOrdersTab: ({ section }: { section: string; canManage?: boolean }) => <div>{section} workflow</div>,
  ShopifyGiftCardsTab: ({ section }: { section: string }) => <div>{section} workflow</div>,
}));

vi.mock('../ChannelProductRulesDialog', () => ({ default: () => null }));

import ShopifyChannelDetailView from '../ShopifyChannelDetailView';

const instance = {
  channelInstanceId: 'shopify-1',
  provider: 'shopify' as const,
  providerDisplayName: 'Shopify',
  displayName: 'Retail Shopify',
  externalAccountKey: 'retail.myshopify.com',
  enabled: true,
  runtimeStatus: 'active' as const,
  readinessStatus: 'ready' as const,
  lastSyncAt: null,
  safeError: null,
  settings: {},
};

describe('ShopifyChannelDetailView', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        configuration: {
          displayName: 'Retail Shopify',
          shopDomain: 'retail.myshopify.com',
          authMode: 'client_credentials',
          clientId: '',
          secretConfigured: true,
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, settings: {} }), { status: 200 })));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('separates Shopify configuration into task-specific sections', async () => {
    const user = userEvent.setup();
    render(<ShopifyChannelDetailView instance={instance} canManage xeroAccountingEnabled onBack={vi.fn()} onChanged={vi.fn()} />);

    for (const label of ['Connection', 'Products', 'Orders', 'Inventory', 'Customers', 'Gift Cards', 'Accounting', 'Activity']) {
      expect(screen.getByRole('button', { name: label }).classList.contains('sv-button-flat')).toBe(true);
    }
    expect(screen.getByText('webhooks workflow')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Orders' }));
    expect(screen.getByText('orders workflow')).toBeTruthy();
    expect(screen.queryByText('inventory workflow')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Inventory' }));
    expect(screen.getByText('inventory workflow')).toBeTruthy();
    expect(screen.queryByText('orders workflow')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Customers' }));
    expect(screen.getByText('customers workflow')).toBeTruthy();
    expect(screen.queryByText('giftCards workflow')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Gift Cards' }));
    expect(screen.getByText('giftCards workflow')).toBeTruthy();
    expect(screen.queryByText('customers workflow')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Accounting' }));
    expect(screen.getByText('Daily online-sales batch sync')).toBeTruthy();
    expect(screen.getByText('Allow Shopify payout posting')).toBeTruthy();
    expect(screen.getByText('Automatically post balanced payouts')).toBeTruthy();
  });
});