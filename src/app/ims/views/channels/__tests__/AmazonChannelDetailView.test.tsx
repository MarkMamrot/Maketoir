/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AmazonChannelDetailView from '../AmazonChannelDetailView';

afterEach(cleanup);

function props(canManage = true) {
  return {
    instance: {
      displayName: 'Amazon Australia',
      externalAccountKey: 'SELLER123',
      enabled: true,
      readinessStatus: 'ready' as const,
      settings: { refundsAmbiguousCount: 2 },
    },
    canManage,
    readinessChecks: [{ key: 'inventory', label: 'Inventory', passed: false, detail: 'Run inventory sync.' }],
    testing: false,
    syncingListings: false,
    syncingInventory: false,
    syncingOrders: false,
    syncingReturns: false,
    checkingReadiness: false,
    changingActivation: false,
    assignmentAutomatic: false,
    assignmentWorking: false,
    publicationEnabled: true,
    publicationWorking: false,
    onBack: vi.fn(),
    onRename: vi.fn(),
    onTest: vi.fn(),
    onChangeActivation: vi.fn(),
    onProductRules: vi.fn(),
    onChangeAssignment: vi.fn(),
    onChangePublication: vi.fn(),
    onReconcileProducts: vi.fn(),
    onSyncListings: vi.fn(),
    onManageListings: vi.fn(),
    onSyncInventory: vi.fn(),
    onOrderSetup: vi.fn(),
    onSyncOrders: vi.fn(),
    onSyncReturns: vi.fn(),
    onResolveRefunds: vi.fn(),
    onCheckReadiness: vi.fn(),
  };
}

describe('AmazonChannelDetailView', () => {
  it('groups the provider workflows and preserves their actions', async () => {
    const viewProps = props();
    const user = userEvent.setup();
    render(<AmazonChannelDetailView {...viewProps} />);

    expect(screen.getByRole('heading', { name: 'Connection & readiness' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Listings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Orders & inventory' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Returns' })).toBeTruthy();
    expect(screen.getByText('Inventory:')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Manage listings' }));
    await user.click(screen.getByRole('button', { name: 'Sync inventory' }));
    await user.click(screen.getByRole('button', { name: 'Resolve refunds (2)' }));

    expect(viewProps.onManageListings).toHaveBeenCalledOnce();
    expect(viewProps.onSyncInventory).toHaveBeenCalledOnce();
    expect(viewProps.onResolveRefunds).toHaveBeenCalledOnce();
  });

  it('keeps configuration actions visible but disabled for read-only users', () => {
    render(<AmazonChannelDetailView {...props(false)} />);

    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Manage listings' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Automatic publication' }) as HTMLInputElement).disabled).toBe(true);
  });
});