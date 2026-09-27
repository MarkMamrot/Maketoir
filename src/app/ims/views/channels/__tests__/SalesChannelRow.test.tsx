/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SalesChannelRow, { type SalesChannelRowInstance } from '../SalesChannelRow';

const instance: SalesChannelRowInstance = {
  channelInstanceId: 'channel-1',
  providerDisplayName: 'Shopify',
  displayName: 'Monsterthreads Shopify',
  externalAccountKey: 'monsterthreads.myshopify.com',
  enabled: true,
  runtimeStatus: 'active',
  readinessStatus: 'ready',
  lastSyncAt: '2026-09-27T06:37:00.000Z',
  safeError: null,
};

afterEach(cleanup);

describe('SalesChannelRow', () => {
  it('shows operational identity and a compact capability summary', () => {
    render(<SalesChannelRow instance={instance} capabilityCount={9} canManage testing={false} activationChanging={false} onConfigure={vi.fn()} />);

    expect(screen.getByText('Monsterthreads Shopify')).toBeTruthy();
    expect(screen.getByText('monsterthreads.myshopify.com')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('9 supported features')).toBeTruthy();
    expect(screen.getByText(/Last successful sync:/)).toBeTruthy();
    expect(screen.queryByText('Automatic assignment')).toBeNull();
    expect(screen.queryByText('Automatic publication')).toBeNull();
  });

  it('uses a read-only details action without an administrator menu', async () => {
    const onConfigure = vi.fn();
    const user = userEvent.setup();
    render(<SalesChannelRow instance={instance} capabilityCount={9} canManage={false} testing={false} activationChanging={false} onConfigure={onConfigure} />);

    await user.click(screen.getByRole('button', { name: 'View details' }));

    expect(onConfigure).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('runs test and activation commands from the overflow menu', async () => {
    const onTest = vi.fn();
    const onChangeActivation = vi.fn();
    const user = userEvent.setup();
    render(
      <SalesChannelRow
        instance={instance}
        capabilityCount={9}
        canManage
        testing={false}
        activationChanging={false}
        onConfigure={vi.fn()}
        onTest={onTest}
        onChangeActivation={onChangeActivation}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'More actions for Monsterthreads Shopify' }));
    await user.click(screen.getByRole('menuitem', { name: 'Test connection' }));
    expect(onTest).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'More actions for Monsterthreads Shopify' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
    expect(onChangeActivation).toHaveBeenCalledOnce();
  });

  it('returns focus to the menu button when Escape closes the menu', async () => {
    const user = userEvent.setup();
    render(<SalesChannelRow instance={instance} capabilityCount={9} canManage testing={false} activationChanging={false} onConfigure={vi.fn()} onTest={vi.fn()} />);
    const menuButton = screen.getByRole('button', { name: 'More actions for Monsterthreads Shopify' });

    await user.click(menuButton);
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menuButton);
  });

  it('shows the latest safe error beneath the row', () => {
    render(<SalesChannelRow instance={{ ...instance, runtimeStatus: 'error', safeError: 'Inventory access was revoked.' }} capabilityCount={9} canManage testing={false} activationChanging={false} onConfigure={vi.fn()} />);

    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Inventory access was revoked.')).toBeTruthy();
  });
});