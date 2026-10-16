// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosRegistersReportView } from '../PosRegistersReportView';

vi.mock('../ReportScrollTable', () => ({
  ReportScrollTable: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
}));
const fetchMock = vi.fn();
const session = {
  id: 4, register_name: 'Till 1', location_name: 'Sydney', location_id: 2, status: 'open',
  opened_at: '2026-10-14 09:00:00', opened_by: 'Alex', opening_float: '200', closed_at: null, closed_by: null,
  reconciliations: [], total_expected: 0, total_counted: 0, total_variance: 0,
};
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/ims/settings') return json({ data: { business_timezone: 'Australia/Sydney' } });
    if (url === '/api/ims/settings/accounts') return json({ recipients: ['accounts@example.com'] });
    if (options?.method === 'PATCH') return json({ success: true, correctionId: 9 });
    if (options?.method === 'POST') return json({ success: true });
    return json({ sessions: [session] });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount(canEditFloat = true) {
  render(<PosRegistersReportView onBack={() => {}} xeroAccountingEnabled={false} canEditFloat={canEditFloat} XeroStatusBadge={() => null} />);
  await screen.findByText('Till 1', { selector: 'td' });
}
async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit opening float for Sydney Till 1' }));
  await screen.findByRole('dialog');
}
describe('register opening float editor', () => {
  it('renders one popup outside the table when several registers are listed', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => url.includes('?date=')
      ? Promise.resolve(json({ sessions: [session, { ...session, id: 5, register_name: 'Till 2' }] }))
      : original(url, options));
    await mount(); await openEditor();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog').closest('table')).toBeNull();
  });
  it('hides edit actions for non-admins', async () => {
    await mount(false);
    expect(screen.queryByRole('button', { name: /Edit opening float/ })).toBeNull();
  });
  it('closes with Escape and restores focus to the edit button', async () => {
    await mount(); await openEditor();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit opening float for Sydney Till 1' }));
  });
  it('edits an open register without an accounting acknowledgement or sending email', async () => {
    await mount(); await openEditor();
    fireEvent.change(screen.getByLabelText('Opening float ($)'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Count verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening float' }));
    await screen.findByText('Opening float corrected. No accounting sync was triggered.');
    const patch = fetchMock.mock.calls.find(call => call[1]?.method === 'PATCH');
    expect(JSON.parse(patch![1].body)).toEqual({
      sessionId: 4, status: 'open', previousFloat: '200', openingFloat: '250', reason: 'Count verified',
    });
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('locks closed-session float editing while preserving email retry for historical corrections', async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/ims/settings') return json({ data: {} });
      if (url === '/api/ims/settings/accounts') return json({ recipients: ['accounts@example.com'] });
      if (options?.method === 'PATCH') return json({ correctionId: 9 });
      if (options?.method === 'POST') return json({ success: true });
      return json({ sessions: [{ ...session, status: 'closed', latest_correction: {
        id: 9, session_status: 'closed', previous_float: '200', opening_float: '250', actor_name: 'Alex', reason: 'Count verified',
      } }] });
    });
    await mount();
    expect(screen.queryByRole('button', { name: /Edit opening float/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review float correction' }));
    await screen.findByRole('dialog');
    expect(screen.getByText('Manual accounting correction required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save opening float' })).toBeNull();
    await screen.findByRole('button', { name: 'Email bookkeeper about last correction' });
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
    expect(screen.getByText('Bookkeeping/accounts recipients: accounts@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Email bookkeeper about last correction' }));
    await screen.findByText('Correction emailed to the bookkeeper/accounts recipients.');
    expect(JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === 'POST')![1].body)).toEqual({ correctionId: 9 });
  });
  it('only offers closing-total editing for closed sessions with reconciliation rows and admin access', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => url.includes('?date=')
      ? Promise.resolve(json({ sessions: [session, { ...session, id: 5, status: 'closed', register_name: 'Till 2' }, {
        ...session, id: 6, status: 'closed', register_name: 'Till 3',
        reconciliations: [{ id: 8, payment_method: 'Cash', counted_amount: 818, expected_amount: 618, variance: 0 }],
      }] }))
      : original(url, options));
    await mount();
    expect(screen.getAllByRole('button', { name: /Edit opening float/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Edit closing totals/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit closing totals for Sydney Till 3' }));
    expect(screen.getByRole('dialog').closest('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save closing totals' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/Cash counted/), { target: { value: '815.99' } });
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Closing sheet checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save closing totals' }));
    await screen.findByRole('status');
    const patch = fetchMock.mock.calls.find(call => call[1]?.method === 'PATCH');
    expect(patch![0]).toBe('/api/ims/reports/pos-registers/closing');
    expect(JSON.parse(patch![1].body)).toEqual({
      sessionId: 6, previousFloat: '200', reason: 'Closing sheet checked', acknowledgeAccounting: true,
      entries: [{ id: 8, previousCount: 818, expectedAmount: 618, countedAmount: '815.99' }],
    });
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit closing totals for Sydney Till 3' }));
  });
  it('hides closing-total actions for non-admins', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => url.includes('?date=')
      ? Promise.resolve(json({ sessions: [{ ...session, status: 'closed',
        reconciliations: [{ id: 8, payment_method: 'Cash', counted_amount: 818, expected_amount: 618, variance: 0 }],
      }] }))
      : original(url, options));
    await mount(false);
    expect(screen.queryByRole('button', { name: /Edit closing totals/ })).toBeNull();
  });
  it('shows a stale-save error and keeps the editor available', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => options?.method === 'PATCH'
      ? Promise.resolve(json({ error: 'The register changed. Reload the report before editing its float.' }, false))
      : original(url, options));
    await mount(); await openEditor();
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Count verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening float' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Opening float corrected. No accounting sync was triggered.')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save opening float' }).hasAttribute('disabled')).toBe(false));
  });
});
