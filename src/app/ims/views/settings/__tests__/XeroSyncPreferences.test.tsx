/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_XERO_DOCUMENT_POLICY } from '@/lib/xero/documentPolicies';
import { XeroSyncPreferences } from '../XeroSyncPreferences';

const fetchMock = vi.fn();
const cogs = { enabled: false, frequency: 'monthly', reliableFrom: null, nextPeriodStart: null, heldReason: null, heldPeriodStart: null };
let policy = { ...DEFAULT_XERO_DOCUMENT_POLICY, postingEnabled: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  policy = { ...DEFAULT_XERO_DOCUMENT_POLICY, postingEnabled: false };
  fetchMock.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/xero/status')) return json({ connected: false });
    if (url.startsWith('/api/xero/cogs/settings')) return json(options?.method === 'PUT' ? { success: true } : { settings: cogs });
    if (options?.method === 'PUT') return json({ success: true, policy: JSON.parse(String(options.body)).policy });
    return json({ success: true, policy });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = (canManage = true) => render(<XeroSyncPreferences businessId="biz-1" canManage={canManage} />);

describe('connection-independent Xero preferences', () => {
  it('shows three separate saved switches while disconnected', async () => {
    setup();
    await screen.findByRole('switch', { name: /Allow posting to Xero/ });
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.getByRole('switch', { name: /Allow posting to Xero/ }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('switch', { name: /Automatic Sales COGS/ }).matches(':checked')).toBe(false);
  });

  it('changes stocktake posting without overwriting unrelated policies or Sales COGS', async () => {
    setup();
    await screen.findByRole('switch', { name: /Stocktake adjustments/ });
    await userEvent.click(screen.getByRole('switch', { name: /Stocktake adjustments/ }));
    policy = { ...policy, poApprovedAction: 'authorised' };
    await userEvent.click(screen.getByRole('button', { name: 'Save posting preferences' }));
    await screen.findByText('Posting preferences saved.');
    const writes = fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toMatchObject({
      databaseId: 'biz-1', policy: { stocktakeJournalEnabled: false, poApprovedAction: 'authorised', postingEnabled: false },
    });
  });

  it('retains a failed posting draft for retry', async () => {
    setup();
    await screen.findByRole('switch', { name: /Allow posting to Xero/ });
    await userEvent.click(screen.getByRole('switch', { name: /Allow posting to Xero/ }));
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => options?.method === 'PUT' ? Promise.resolve(json({ error: 'Save failed' }, 500)) : original(url, options));
    await userEvent.click(screen.getByRole('button', { name: 'Save posting preferences' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
    expect(screen.getByRole('switch', { name: /Allow posting to Xero/ }).matches(':checked')).toBe(true);
  });

  it('preserves saved posting intent when Xero becomes disconnected', async () => {
    policy = { ...policy, postingEnabled: true, stocktakeJournalEnabled: true };
    setup();
    await screen.findByText('Not connected');
    expect(screen.getByRole('switch', { name: /Allow posting to Xero/ }).matches(':checked')).toBe(true);
    expect(screen.getByRole('switch', { name: /Stocktake adjustments/ }).matches(':checked')).toBe(true);
    expect(screen.getByText(/unfinished Xero post still needs attention/)).toBeTruthy();
  });

  it('does not overwrite a newer master switch when only stocktake adjustments changed', async () => {
    policy = { ...policy, postingEnabled: true };
    setup();
    await screen.findByRole('switch', { name: /Stocktake adjustments/ });
    await userEvent.click(screen.getByRole('switch', { name: /Stocktake adjustments/ }));
    policy = { ...policy, postingEnabled: false };
    await userEvent.click(screen.getByRole('button', { name: 'Save posting preferences' }));
    await screen.findByText('Posting preferences saved.');
    const write = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!;
    expect(JSON.parse(write[1].body).policy).toMatchObject({ postingEnabled: false, stocktakeJournalEnabled: false });
  });

  it('does not substitute disabled defaults on a COGS read failure', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => String(url).includes('/cogs/settings') ? Promise.resolve(json({ error: 'Settings unavailable' }, 500)) : original(url, options));
    setup();
    expect((await screen.findByRole('alert')).textContent).toContain('Settings unavailable');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('lets non-administrators read but not change disconnected preferences', async () => {
    setup(false);
    await screen.findByRole('switch', { name: /Allow posting to Xero/ });
    for (const control of screen.getAllByRole('switch')) expect(control.hasAttribute('disabled')).toBe(true);
  });

  it('requires a reliable date and saves Sales COGS independently', async () => {
    setup();
    await screen.findByRole('switch', { name: /Automatic Sales COGS/ });
    await userEvent.click(screen.getByRole('switch', { name: /Automatic Sales COGS/ }));
    expect(screen.getByRole('button', { name: 'Save Sales COGS schedule' }).hasAttribute('disabled')).toBe(true);
    const date = screen.getByLabelText('First reliable COGS date');
    fireEvent.change(date, { target: { value: '2026-07-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save Sales COGS schedule' }));
    await waitFor(() => expect(screen.getByText('Sales COGS schedule saved.')).toBeTruthy());
    const writes = fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/api/xero/cogs/settings');
    expect(JSON.parse(writes[0][1].body)).toEqual({ databaseId: 'biz-1', enabled: true, frequency: 'monthly', reliableFrom: '2026-07-01' });
  });
});
