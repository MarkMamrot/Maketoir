/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureToggleProvider } from '../../../components/FeatureToggleProvider';
import { ConsignmentTrackingSettings } from '../../settings/ConsignmentTrackingSettings';
import { ConsignmentStatementsView } from '../ConsignmentStatementsView';
import { ConsignmentActivityView } from '../../reports/ConsignmentActivityView';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const statement = { id: 1, number: 'CS-1', supplier_id: 2, period_from: '2026-10-01', period_to: '2026-10-15', status: 'Draft', total: 11, version: 3 };
const detail = { statement, events: [], projection: { rows: [], exceptions: [] }, audit: [], deliveries: [] };
const response = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) });
const renderStatements = (enabled: boolean) => render(<FeatureToggleProvider loaded settings={{ feature_toggle_consignment_tracking: enabled ? 'yes' : 'no' }}>
  <ConsignmentStatementsView canManage />
</FeatureToggleProvider>);

describe('Consignment operational UI', () => {
  it('requires audited cutover acknowledgement and uses only the dedicated transition endpoint', async () => {
    const onChanged = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(response({ enabled: false, blockers: [], handover: { eventCount: 0, total: 0 } }));
    vi.stubGlobal('fetch', fetcher);
    render(<ConsignmentTrackingSettings enabled={false} disabled={false} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Consignment Tracking' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm enable tracking' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Cutover date'), '2026-10-16');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(true));
    expect(fetcher).toHaveBeenLastCalledWith('/api/ims/consignment/tracking', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ enabled: true, cutoverDate: '2026-10-16', acknowledgeExternal: true }),
    }));
  });

  it('shows disable handover blockers without allowing a transition', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ enabled: true, blockers: ['Statement 1 is Draft; account or cancel it first.'], handover: { eventCount: 2, total: 11 } }));
    vi.stubGlobal('fetch', fetcher);
    render(<ConsignmentTrackingSettings enabled disabled={false} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('switch'));
    await screen.findByText('Statement 1 is Draft; account or cancel it first.');
    await userEvent.type(screen.getByLabelText('Handover reason'), 'External reconciliation');
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirm disable tracking' }).hasAttribute('disabled')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps historical statements and exports readable while tracking is off, without mutation controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('contacts') ? [{ id: 2, name: 'Supplier' }] : url.endsWith('/1') ? detail : [statement])));
    renderStatements(false);
    await userEvent.click(await screen.findByRole('button', { name: 'CS-1' }));
    await screen.findByRole('heading', { name: 'CS-1 — Draft' });
    expect(screen.getByRole('link', { name: 'Export PDF' }).getAttribute('href')).toContain('/1/export?format=pdf');
    expect(screen.queryByRole('button', { name: 'Create Draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Finalise statement' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send statement email' })).toBeNull();
  });

  it('sends reviewed version, displays conflicts, and never automatically retries', async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => options?.method === 'PATCH'
      ? { ok: false, json: async () => ({ success: false, error: 'Statement changed; reload before retrying.' }) }
      : response(url.includes('contacts') ? [{ id: 2, name: 'Supplier' }] : url.endsWith('/1') ? detail : [statement]));
    vi.stubGlobal('fetch', fetcher);
    renderStatements(true);
    await userEvent.click(await screen.findByRole('button', { name: 'CS-1' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Finalise statement' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Statement changed');
    const mutations = fetcher.mock.calls.filter(([, options]) => options?.method === 'PATCH');
    expect(mutations).toHaveLength(1);
    expect(JSON.parse(String(mutations[0][1]?.body))).toMatchObject({ action: 'finalise', version: 3 });
  });

  it('keeps independent activity reporting and exports available without tracking', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/activity?')
      ? { rows: [], events: [], totals: { quantitySold: 0, quantityRefunded: 0, netQuantity: 0, subtotal: 0, tax: 0, total: 0 }, exceptions: [] }
      : [])));
    render(<FeatureToggleProvider loaded settings={{}}><ConsignmentActivityView onBack={vi.fn()} /></FeatureToggleProvider>);
    const csv = await screen.findByRole('link', { name: 'Export CSV' });
    expect(csv.getAttribute('href')).toMatch(/from=\d{4}-\d{2}-\d{2}&to=/);
    expect(csv.getAttribute('href')).toContain('format=csv');
    expect(screen.getByText(/Activity report — not a settlement/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Manage settlement statements' })).toBeNull();
  });

  it('does not send automatically and requires an explicit recipient confirmation', async () => {
    const finalised = { ...detail, statement: { ...statement, status: 'Finalised' } };
    const fetcher = vi.fn(async (url: string) => url.endsWith('/send')
      ? { ok: false, json: async () => ({ success: false, error: 'Email delivery service unavailable.' }) }
      : response(url.includes('contacts') ? [] : url.endsWith('/1') ? finalised : [finalised.statement]));
    vi.stubGlobal('fetch', fetcher);
    renderStatements(true);
    await userEvent.click(await screen.findByRole('button', { name: 'CS-1' }));
    const send = await screen.findByRole('button', { name: 'Send statement email' });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/send'))).toBe(false);
    await userEvent.type(screen.getByLabelText('Recipient email'), 'supplier@example.com');
    expect(send.hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByLabelText('I confirm the recipient and request sending this statement.'));
    await userEvent.click(send);
    expect((await screen.findByRole('alert')).textContent).toContain('Email delivery service unavailable');
    const sends = fetcher.mock.calls.filter(([url]) => url.endsWith('/send'));
    expect(sends).toHaveLength(1);
  });

  it('blocks uncertain resends and requires reviewed provider evidence for resolution', async () => {
    const uncertain = { ...detail, statement: { ...statement, status: 'Finalised' }, deliveries: [{ id: 9, status: 'Unconfirmed', recipient: 'supplier@example.com', created_at: '2026-10-16' }] };
    const fetcher = vi.fn(async (url: string) => response(url.includes('contacts') ? [] : url.endsWith('/1') ? uncertain : [uncertain.statement]));
    vi.stubGlobal('fetch', fetcher);
    renderStatements(true);
    await userEvent.click(await screen.findByRole('button', { name: 'CS-1' }));
    expect((await screen.findByRole('button', { name: 'Send statement email' })).hasAttribute('disabled')).toBe(true);
    const resolve = screen.getByRole('button', { name: 'Record reviewed outcome' });
    await userEvent.selectOptions(screen.getByLabelText('Unresolved email'), '9');
    await userEvent.selectOptions(screen.getByLabelText('Reviewed outcome'), 'Sent');
    await userEvent.type(screen.getByLabelText('Resolution reason and evidence'), 'Reviewed provider log');
    await userEvent.click(screen.getByLabelText('I reviewed the provider evidence and confirm this outcome.'));
    expect(resolve.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Provider reference'), 'provider-123');
    expect(resolve.hasAttribute('disabled')).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/send'))).toBe(false);
  });
});
