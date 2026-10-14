/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BuiltInSalesChannels from '../BuiltInSalesChannels';

function mockOverview(settings = { business_requires_pos: 'yes', sells_wholesale: 'yes' }, locations = [
  { is_active: 1, has_pos: 1, pos_location_code: null },
  { is_active: 1, has_pos: 0, pos_location_code: 'SHOP2' },
  { is_active: 0, has_pos: 1, pos_location_code: 'CLOSED' },
  { is_active: 1, has_pos: 0, pos_location_code: null },
]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
    JSON.stringify({ success: true, data: url === '/api/ims/settings' ? settings : locations }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ))));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BuiltInSalesChannels', () => {
  it('shows one POS row, counts only active POS locations and opens existing settings', async () => {
    mockOverview();
    const user = userEvent.setup();
    const onConfigure = vi.fn();
    const onManageLocations = vi.fn();
    render(<BuiltInSalesChannels canManage refreshKey={0} onConfigure={onConfigure} onManageLocations={onManageLocations} />);

    const pos = await screen.findByRole('region', { name: 'Point of Sale' });
    expect(screen.getAllByRole('region', { name: 'Point of Sale' })).toHaveLength(1);
    expect(within(pos).getByText('2 active POS locations')).toBeTruthy();
    expect(within(pos).getByText('Enabled')).toBeTruthy();
    await user.click(within(pos).getByRole('button', { name: 'Configure' }));
    expect(onConfigure).toHaveBeenLastCalledWith('pos');
    await user.click(within(pos).getByRole('button', { name: 'Manage locations' }));
    expect(onManageLocations).toHaveBeenCalledOnce();

    const wholesale = screen.getByRole('region', { name: 'B2B Wholesale Portal' });
    await user.click(within(wholesale).getByRole('button', { name: 'Configure' }));
    expect(onConfigure).toHaveBeenLastCalledWith('wholesale');
    const preview = within(wholesale).getByRole('link', { name: 'Preview portal' });
    expect(preview.getAttribute('href')).toBe('/wholesale/preview');
    expect(preview.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText(/Last successful sync/)).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('shows disabled channels without offering a disabled portal preview', async () => {
    mockOverview({ business_requires_pos: 'no', sells_wholesale: 'no' });
    render(<BuiltInSalesChannels canManage refreshKey={0} onConfigure={vi.fn()} />);
    await screen.findByRole('region', { name: 'Point of Sale' });
    expect(screen.getAllByText('Disabled')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Preview portal' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Configure' })).toHaveLength(2);
  });

  it('shows POS setup pending when enabled without active POS locations', async () => {
    mockOverview(undefined, []);
    render(<BuiltInSalesChannels canManage refreshKey={0} />);
    const pos = await screen.findByRole('region', { name: 'Point of Sale' });
    expect(within(pos).getByText('Setup pending')).toBeTruthy();
    expect(within(pos).getByText('0 active POS locations')).toBeTruthy();
  });

  it('does not offer settings changes to non-administrators', async () => {
    mockOverview();
    render(<BuiltInSalesChannels canManage={false} refreshKey={0} onConfigure={vi.fn()} onManageLocations={vi.fn()} />);
    await screen.findByRole('region', { name: 'Point of Sale' });
    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage locations' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Preview portal' })).toBeTruthy();
  });

  it.each(['/api/ims/settings', '/api/ims/locations'])('shows failures from %s explicitly and retries', async failingUrl => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      JSON.stringify(url === failingUrl
        ? { success: false, error: 'Service unavailable' }
        : { success: true, data: url === '/api/ims/settings' ? {} : [] }),
      { status: url === failingUrl ? 500 : 200 },
    ))));
    render(<BuiltInSalesChannels canManage refreshKey={0} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Service unavailable');
    expect(screen.queryByRole('region', { name: 'Point of Sale' })).toBeNull();
    mockOverview();
    await user.click(screen.getByRole('button', { name: 'Retry built-in channels' }));
    expect(await screen.findByText('2 active POS locations')).toBeTruthy();
  });
});
