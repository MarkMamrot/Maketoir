/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('does not mount credentials or test connections while off', async () => {
    section();
    await screen.findByRole('switch');
    expect(screen.queryByText('Credential setup')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ims/integrations');
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
