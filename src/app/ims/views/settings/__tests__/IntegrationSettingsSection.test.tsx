/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationSettingsSection } from '../IntegrationSettingsSection';

vi.mock('../../../../setup/page', () => ({ ConnectionsTab: () => <div>Credential setup</div> }));
function response(enabled = false, canManage = true) {
  return new Response(JSON.stringify({ success: true, businessId: 'sandbox', canManage, integrations: {
    cin7: { enabled, configured: true }, google: { enabled: false, configured: false },
    meta: { enabled: false, configured: false }, klaviyo: { enabled: false, configured: false },
    gmail: { enabled: false, configured: false },
  } }));
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response())); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function section() {
  render(<IntegrationSettingsSection businessId="sandbox" businessName="Sandbox" provider="cin7"
    onNavigate={vi.fn()} onHelp={vi.fn()} xeroEnabled={false} saveXeroEnabled={vi.fn()} />);
}
describe('enable-first integrations', () => {
  it('saves the Klaviyo availability toggle immediately without a Save action', async () => {
    const enabledResponse = JSON.parse(await response().text());
    enabledResponse.integrations.klaviyo.enabled = true;
    vi.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify(enabledResponse)));
    render(<IntegrationSettingsSection businessId="sandbox" businessName="Sandbox" provider="klaviyo"
      onNavigate={vi.fn()} onHelp={vi.fn()} xeroEnabled={false} saveXeroEnabled={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('switch'));
    expect(await screen.findByText('Credential setup')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save availability' })).toBeNull();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({
      provider: 'klaviyo', enabled: true, expectedBusinessId: 'sandbox',
    });
  });

  it('keeps the saved Klaviyo toggle off when an immediate save fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Save failed' }), { status: 500 }));
    render(<IntegrationSettingsSection businessId="sandbox" businessName="Sandbox" provider="klaviyo"
      onNavigate={vi.fn()} onHelp={vi.fn()} xeroEnabled={false} saveXeroEnabled={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('switch'));
    expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('Credential setup')).toBeNull();
  });
  it('does not mount credentials or test connections while off', async () => {
    section();
    await screen.findByRole('switch');
    expect(screen.queryByText('Credential setup')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ims/integrations');
  });

  describe('Xero availability', () => {
    function xeroSection(enabled: boolean, save = vi.fn().mockResolvedValue(undefined)) {
      render(<IntegrationSettingsSection businessId="sandbox" businessName="Sandbox" provider="xero"
        onNavigate={vi.fn()} onHelp={vi.fn()} xeroEnabled={enabled} saveXeroEnabled={save} />);
      return save;
    }

    it('saves immediately when enabled and shows connection setup only after saving succeeds', async () => {
      let finishSave!: () => void;
      const save = vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
      xeroSection(false, save);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('switch'));

      expect(save).toHaveBeenCalledExactlyOnceWith(true);
      expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
      expect(screen.queryByText('Credential setup')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save availability' })).toBeNull();
      expect(screen.getByRole('status').textContent).toBe('Saving Xero availability...');

      await act(async () => finishSave());

      expect(await screen.findByText('Credential setup')).toBeTruthy();
      expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false);
      expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('restores the saved switch value and allows retry after an enablement failure', async () => {
      const save = vi.fn().mockRejectedValueOnce(new Error('Xero could not be enabled')).mockResolvedValueOnce(undefined);
      xeroSection(false, save);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('switch'));

      expect((await screen.findByRole('alert')).textContent).toBe('Xero could not be enabled');
      expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
      expect(screen.queryByText('Credential setup')).toBeNull();

      await user.click(screen.getByRole('switch'));
      expect(await screen.findByText('Credential setup')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(save).toHaveBeenCalledTimes(2);
    });

    it('does not turn Xero off when the pause confirmation is cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const save = xeroSection(true);
      const user = userEvent.setup();
      await screen.findByText('Credential setup');

      await user.click(screen.getByRole('switch'));

      expect(save).not.toHaveBeenCalled();
      expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText('Credential setup')).toBeTruthy();
    });

    it('saves a confirmed disable immediately and retains the connection on failure', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const save = vi.fn().mockRejectedValueOnce(new Error('Xero could not be disabled')).mockResolvedValueOnce(undefined);
      xeroSection(true, save);
      const user = userEvent.setup();
      await screen.findByText('Credential setup');

      await user.click(screen.getByRole('switch'));

      expect((await screen.findByRole('alert')).textContent).toBe('Xero could not be disabled');
      expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText('Credential setup')).toBeTruthy();
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('New accounting sync and posting will pause'));

      await user.click(screen.getByRole('switch'));

      await waitFor(() => expect(screen.queryByText('Credential setup')).toBeNull());
      expect(save).toHaveBeenLastCalledWith(false);
      expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
    });

    it('does not allow read-only users to enable Xero', async () => {
      vi.mocked(fetch).mockResolvedValue(response(false, false));
      const save = xeroSection(false);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('switch'));

      expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
      expect(save).not.toHaveBeenCalled();
    });
  });
  it('persists enablement before showing setup', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(response(true));
    const user = userEvent.setup(); section();
    await user.click(await screen.findByRole('switch'));
    expect(screen.queryByText('Credential setup')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    expect(await screen.findByText('Credential setup')).toBeTruthy();
    const [, request] = vi.mocked(fetch).mock.calls[1];
    expect(request?.method).toBe('PUT');
    expect(JSON.parse(String(request?.body))).toEqual({ provider: 'cin7', enabled: true, expectedBusinessId: 'sandbox' });
  });
  it('retains the draft and hides credentials after a failed availability save', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Save failed' }), { status: 500 }));
    const user = userEvent.setup(); section();
    await user.click(await screen.findByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('Credential setup')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
  });
  it('prevents availability changes for read-only roles', async () => {
    vi.mocked(fetch).mockResolvedValue(response(false, false)); section();
    expect((await screen.findByRole('switch')).hasAttribute('disabled')).toBe(true);
  });
  it('rejects availability returned for a different business', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true, businessId: 'another-business', integrations: {} })));
    section();
    expect((await screen.findByRole('alert')).textContent).toContain('active business changed');
    expect(screen.queryByRole('switch')).toBeNull();
  });
  it('confirms the pause impact before turning an integration off', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup(); section();
    await screen.findByText('Credential setup');
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    expect(await screen.findByText('Integration turned off. Saved configuration has been retained.')).toBeTruthy();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Existing stock and order records are retained'));
    expect(screen.queryByText('Credential setup')).toBeNull();
  });
  it('keeps credential drafts mounted but blocks keyboard authorisation while availability is unsaved', async () => {
    vi.mocked(fetch).mockResolvedValue(response(true));
    const activate = vi.fn(event => event.preventDefault());
    const user = userEvent.setup();
    render(<IntegrationSettingsSection businessId="sandbox" businessName="Sandbox" provider="cin7"
      onNavigate={vi.fn()} onHelp={vi.fn()} xeroEnabled={false} saveXeroEnabled={vi.fn()}>
      <a href="/authorise" onClick={activate}>Authorise</a>
    </IntegrationSettingsSection>);
    await screen.findByRole('link', { name: 'Authorise' });
    await user.click(screen.getByRole('switch'));
    const link = screen.getByRole('link', { name: 'Authorise' });
    expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(false);
    fireEvent.click(link);
    expect(activate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(link);
    expect(activate).toHaveBeenCalledOnce();
  });
});
