/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsTab } from '../page';
import { DEFAULT_KLAVIYO_INTEGRATION_SETTINGS } from '@/lib/klaviyo/contracts';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock('@/components/help/UnifiedHelpDrawer', () => ({ UnifiedHelpDrawer: () => null }));
vi.mock('@/components/BusinessContextSwitcher', () => ({ switchBusinessContext: vi.fn() }));
const business = { name: 'Sandbox', userId: '', databaseId: 'sandbox' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const credentials = () => json({ success: true, connections: {} });

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('connection settings loading', () => {
  it('does not expose default Klaviyo policies after a failed load and supports retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(json({ error: 'Policy unavailable' }, 500))
      .mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(json({ configured: true, connected: true, oauth: true }))
      .mockResolvedValueOnce(json({ settings: DEFAULT_KLAVIYO_INTEGRATION_SETTINGS, tenantReady: true }));
    render(<ConnectionsTab business={business} provider="klaviyo" onHelp={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Policy unavailable');
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByRole('button', { name: 'Reconnect Klaviyo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('ignores a previous business policy response after switching providers', async () => {
    let resolvePolicy!: (response: Response) => void;
    const delayedPolicy = new Promise<Response>(resolve => { resolvePolicy = resolve; });
    vi.mocked(fetch).mockResolvedValueOnce(credentials()).mockReturnValueOnce(delayedPolicy)
      .mockResolvedValueOnce(json({ success: true, connections: { Cin7AccountId: 'current-account' } }));
    const { rerender } = render(<ConnectionsTab business={business} provider="klaviyo" onHelp={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    rerender(<ConnectionsTab business={{ ...business, databaseId: 'current-business' }} provider="cin7" onHelp={vi.fn()} />);
    await screen.findByDisplayValue('current-account');
    await act(async () => { resolvePolicy(json({ error: 'Old policy failure' }, 500)); await delayedPolicy; });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByDisplayValue('current-account')).toBeTruthy();
  });
  it('retains saved secrets on blank saves and clears replacement secrets after success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ success: true, connections: { Cin7AccountId: 'account', Cin7ApiKey: 'present' } }))
      .mockResolvedValueOnce(json({ success: true })).mockResolvedValueOnce(json({ success: true }));
    const user = userEvent.setup();
    render(<ConnectionsTab business={business} provider="cin7" onHelp={vi.fn()} />);
    const secret = await screen.findByPlaceholderText('Saved; leave blank to retain');
    expect((secret as HTMLInputElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await screen.findByText('Saved');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).connections).toEqual({ Cin7AccountId: 'account' });
    await user.type(secret, 'replacement-test-key');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect((secret as HTMLInputElement).value).toBe(''));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body)).connections.Cin7ApiKey).toBe('replacement-test-key');
  });

  it('shows OAuth instead of a private key and saves the master toggle immediately', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(json({ configured: true, connected: true, oauth: true }))
      .mockResolvedValueOnce(json({ settings: DEFAULT_KLAVIYO_INTEGRATION_SETTINGS, tenantReady: true }))
      .mockImplementation(async (_url, init) => json({ settings: JSON.parse(String(init?.body)).settings }));
    render(<ConnectionsTab business={business} provider="klaviyo" onHelp={vi.fn()} />);
    const toggle = await screen.findByLabelText('Enable customer and commerce sync');
    expect(screen.queryByText('Private API Key')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    await userEvent.setup().click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    const saves = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/klaviyo/settings');
    expect(saves).toHaveLength(1);
    expect(JSON.parse(String(saves[0][1]?.body))).toMatchObject({ databaseId: 'sandbox', settings: { enabled: true } });
    expect(screen.queryByRole('button', { name: 'Cancel changes' })).toBeNull();
  });

  it('keeps the last saved switch state and shows an error if autosave fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(json({ configured: true, connected: true, oauth: true }))
      .mockResolvedValueOnce(json({ settings: DEFAULT_KLAVIYO_INTEGRATION_SETTINGS, tenantReady: true }))
      .mockResolvedValueOnce(json({ error: 'Policy could not be saved' }, 500));
    render(<ConnectionsTab business={business} provider="klaviyo" onHelp={vi.fn()} />);
    const toggle = await screen.findByLabelText('Enable customer and commerce sync');
    await userEvent.setup().click(toggle);
    await screen.findByText('Policy could not be saved');
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel changes' })).toBeNull();
  });

  it('requires Shopify acknowledgement first and enables required profile sync with a source', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(json({ configured: true, connected: true, oauth: true }))
      .mockResolvedValueOnce(json({ settings: { ...DEFAULT_KLAVIYO_INTEGRATION_SETTINGS, enabled: true }, tenantReady: true }))
      .mockImplementation(async (_url, init) => json({ settings: JSON.parse(String(init?.body)).settings }));
    render(<ConnectionsTab business={business} provider="klaviyo" onHelp={vi.fn()} />);
    const shopify = await screen.findByLabelText('Shopify orders');
    expect(shopify.hasAttribute('disabled')).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/I have confirmed this store/));
    await waitFor(() => expect(shopify.hasAttribute('disabled')).toBe(false));
    await user.click(shopify);
    await waitFor(() => expect((shopify as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText('Sync customer profiles') as HTMLInputElement).checked).toBe(true);
    const saves = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/klaviyo/settings');
    expect(JSON.parse(String(saves[1][1]?.body)).settings).toMatchObject({
      profilesEnabled: true, shopifyDuplicateRiskAcknowledged: true, sources: { shopify: true },
    });
  });
});
