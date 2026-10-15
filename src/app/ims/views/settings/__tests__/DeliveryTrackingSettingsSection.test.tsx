/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryTrackingSettingsSection } from '../DeliveryTrackingSettingsSection';
import { DEFAULT_DELIVERY_TRACKING_CHANNELS } from '@/lib/ims/shipping/deliveryTrackingSettings';

function response(channels = { ...DEFAULT_DELIVERY_TRACKING_CHANNELS }, businessId = 'tenant-a', readOnly = false) {
  return new Response(JSON.stringify({ success: true, businessId, channels, readOnly }), { status: 200 });
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response())); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('per-business channel delivery switches', () => {
  it('loads Amazon-only defaults, explains both gates, and never starts a poll', async () => {
    render(<DeliveryTrackingSettingsSection businessId="tenant-a" />);
    const amazon = await screen.findByRole('switch', { name: 'Amazon delivery tracking' });
    expect(amazon.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Shopify delivery tracking' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Solvantis Online Store delivery tracking' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/platform-wide Online channel delivery tracking job/).textContent).toContain('starts Off');
    expect(screen.getByText(/Amazon's 30-day PII review rules/)).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ims/shipping/delivery-settings');
  });
  it('keeps edits local until saved and persists the complete map with expected business scope', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ amazon: true, shopify: true, native_shop: false }));
    render(<DeliveryTrackingSettingsSection businessId="tenant-a" />);
    await user.click(await screen.findByRole('switch', { name: 'Shopify delivery tracking' }));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save delivery tracking' }));
    expect(await screen.findByText('Delivery tracking settings saved.')).toBeTruthy();
    const [, init] = vi.mocked(fetch).mock.calls[1];
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedBusinessId: 'tenant-a', channels: { amazon: true, shopify: true, native_shop: false },
    });
  });
  it('keeps unavailable settings disabled instead of showing fallback On states', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValueOnce(response());
    const user = userEvent.setup();
    render(<DeliveryTrackingSettingsSection businessId="tenant-a" />);
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save delivery tracking' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Reload saved settings' }));
    expect(await screen.findByRole('switch', { name: 'Amazon delivery tracking' })).toBeTruthy();
  });
  it('does not allow advisor edits', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ...DEFAULT_DELIVERY_TRACKING_CHANNELS }, 'tenant-a', true));
    const user = userEvent.setup();
    render(<DeliveryTrackingSettingsSection businessId="tenant-a" />);
    const shopify = await screen.findByRole('switch', { name: 'Shopify delivery tracking' });
    await user.click(shopify);
    expect(shopify.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Save delivery tracking' }).hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it('rejects a settings response for another business', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ...DEFAULT_DELIVERY_TRACKING_CHANNELS }, 'tenant-b'));
    render(<DeliveryTrackingSettingsSection businessId="tenant-a" />);
    expect((await screen.findByRole('alert')).textContent).toContain('active business changed');
    expect(screen.queryByRole('switch')).toBeNull();
  });
  it('ignores late responses from the previous business', async () => {
    let resolveFirst!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(response({ amazon: false, shopify: true, native_shop: false }, 'tenant-b'));
    const view = render(<DeliveryTrackingSettingsSection businessId="tenant-a" />);
    view.rerender(<DeliveryTrackingSettingsSection businessId="tenant-b" />);
    expect((await screen.findByRole('switch', { name: 'Amazon delivery tracking' })).getAttribute('aria-checked')).toBe('false');
    resolveFirst(response());
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Shopify delivery tracking' }).getAttribute('aria-checked')).toBe('true'));
  });
  it('surfaces save conflicts without reporting success or changing the master gate', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('{}', { status: 409 }));
    const user = userEvent.setup();
    render(<DeliveryTrackingSettingsSection businessId="tenant-a" />);
    await screen.findByRole('switch', { name: 'Amazon delivery tracking' });
    await user.click(screen.getByRole('button', { name: 'Save delivery tracking' }));
    expect((await screen.findByRole('alert')).textContent).toContain('active business changed');
    expect(screen.queryByText('Delivery tracking settings saved.')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === '/api/ims/shipping/delivery-settings')).toBe(true);
  });
  it('opens contextual Help without starting tracking', async () => {
    const help = vi.fn(); const user = userEvent.setup();
    render(<DeliveryTrackingSettingsSection businessId="tenant-a" onHelp={help} />);
    await screen.findByRole('switch', { name: 'Amazon delivery tracking' });
    await user.click(screen.getByRole('button', { name: 'Delivery tracking help' }));
    expect(help).toHaveBeenCalledOnce(); expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
