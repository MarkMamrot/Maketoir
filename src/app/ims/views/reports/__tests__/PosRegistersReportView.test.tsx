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
      sessionId: 4, status: 'open', previousFloat: '200', openingFloat: '250', reason: 'Count verified', acknowledgeAccounting: false,
    });
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('requires acknowledgement for closed sessions and offers a separate configured-recipient email action', async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/ims/settings') return json({ data: {} });
      if (url === '/api/ims/settings/accounts') return json({ recipients: ['accounts@example.com'] });
      if (options?.method === 'PATCH') return json({ correctionId: 9 });
      if (options?.method === 'POST') return json({ success: true });
      return json({ sessions: [{ ...session, status: 'closed' }] });
    });
    await mount(); await openEditor();
    expect(screen.getByText('Manual accounting correction required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save opening float' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Opening float ($)'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Count verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening float' }));
    await screen.findByRole('button', { name: 'Email bookkeeper about this correction' });
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
    expect(screen.getByText('Bookkeeping/accounts recipients: accounts@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Email bookkeeper about this correction' }));
    await screen.findByText('Correction emailed to the bookkeeper/accounts recipients.');
    expect(JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === 'POST')![1].body)).toEqual({ correctionId: 9 });
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
