/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureToggleSettings } from '../FeatureToggleSettings';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(overrides: Partial<React.ComponentProps<typeof FeatureToggleSettings>> = {}) {
  const props = { settings: {}, loaded: true, loadError: '', canManage: true, saveSettings: vi.fn().mockResolvedValue(undefined), ...overrides };
  render(<FeatureToggleSettings {...props} />);
  return props;
}

describe('Feature Toggle settings', () => {
  it('preserves nine default-on switches and presents default-off reviewed tracking', () => {
    setup();
    expect(screen.getAllByRole('switch')).toHaveLength(10);
    for (const element of screen.getAllByRole('switch')) expect(element.getAttribute('aria-checked')).toBe(element.getAttribute('aria-label') === 'Consignment Tracking' ? 'false' : 'true');
    for (const name of ['Workspaces', 'Products & Channels', 'Reports', 'Automations']) expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save feature toggles' }).hasAttribute('disabled')).toBe(true);
  });

  it('saves only changed feature fields and confirms success', async () => {
    const props = setup({ settings: { feature_toggle_crm: 'no', business_name: 'Example' } });
    await userEvent.click(screen.getByRole('switch', { name: 'CRM' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Possible Losses' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save feature toggles' }));
    expect(props.saveSettings).toHaveBeenCalledWith({ feature_toggle_crm: 'yes', feature_toggle_possible_losses: 'no' });
    expect(screen.getByRole('status').textContent).toContain('saved');
    expect(screen.getByRole('switch', { name: 'CRM' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Possible Losses' }).getAttribute('aria-checked')).toBe('false');
  });

  it('retains unsaved choices and displays a failed save for retry', async () => {
    const props = setup({ saveSettings: vi.fn().mockRejectedValueOnce(new Error('Save failed.')).mockResolvedValue(undefined) });
    await userEvent.click(screen.getByRole('switch', { name: 'Shipping Workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save feature toggles' }));
    expect(screen.getByRole('alert').textContent).toBe('Save failed.');
    expect(screen.getByRole('switch', { name: 'Shipping Workspace' }).getAttribute('aria-checked')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Save feature toggles' }));
    await waitFor(() => expect(props.saveSettings).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Cancel restores the saved state without writing anything', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('switch', { name: 'Bulk Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('switch', { name: 'Bulk Edit' }).getAttribute('aria-checked')).toBe('true');
    expect(props.saveSettings).not.toHaveBeenCalled();
  });

  it('never sends an operational tracking transition through generic feature saves', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { enabled: false, blockers: [], handover: { eventCount: 0, total: 0 } } }) });
    vi.stubGlobal('fetch', fetcher);
    const props = setup();
    await userEvent.click(screen.getByRole('switch', { name: 'Consignment Tracking' }));
    await userEvent.type(await screen.findByLabelText('Cutover date'), '2026-10-16');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm enable tracking' }));
    await screen.findByText('Consignment tracking updated.');
    await userEvent.click(screen.getByRole('switch', { name: 'CRM' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save feature toggles' }));
    expect(props.saveSettings).toHaveBeenCalledWith({ feature_toggle_crm: 'no' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{ canManage: false }, { loaded: false }, { loaded: false, loadError: 'Settings unavailable.' }])('disables editing when access or loading prevents it: %j', overrides => {
    setup(overrides);
    for (const element of screen.getAllByRole('switch')) expect(element.hasAttribute('disabled')).toBe(true);
  });
});
