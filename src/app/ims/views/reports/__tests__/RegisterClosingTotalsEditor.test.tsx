// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterClosingTotalsEditor } from '../RegisterClosingTotalsEditor';
import type { PosRegisterSession } from '../PosRegistersReportView';

const fetchMock = vi.fn();
const onSaved = vi.fn();
const onClose = vi.fn();
const session: PosRegisterSession = {
  id: 4, register_name: 'Till 1', location_name: 'Sydney', location_id: 2, status: 'closed',
  opened_at: null, opened_by: null, opening_float: '200', closed_at: null, closed_by: null,
  total_expected: 618, total_counted: 818, total_variance: 0,
  reconciliations: [{
    id: 8, payment_method: 'Cash', expected_amount: 618, counted_amount: 818, variance: 0,
    xero_invoice_id: 'invoice-1', xero_synced_at: null, till_variance: null, variance_status: null, xero_variance_id: null,
  }],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(input = session) {
  render(<RegisterClosingTotalsEditor session={input} onSaved={onSaved} onClose={onClose} />);
}
function submit() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Verified closing count' } });
  fireEvent.change(screen.getByLabelText(/Cash counted/), { target: { value: '815.99' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save closing totals' }));
}

describe('closing totals dialog', () => {
  it('keeps the editor and values available after stale-save rejection without claiming success', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Closing counts changed. Reload the report before editing.' }) });
    mount(); submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Closing counts changed');
    expect(screen.queryByRole('status')).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Cash counted/)).toHaveProperty('value', '815.99');
    expect(screen.getByRole('button', { name: 'Save closing totals' }).hasAttribute('disabled')).toBe(false);
  });
  it('shows transport errors without closing or refreshing', async () => {
    fetchMock.mockRejectedValue(new Error('Network unavailable'));
    mount(); submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Network unavailable');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('disables closure and saves while the correction is in flight', async () => {
    let finish!: (response: unknown) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); submit();
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    finish({ ok: true, json: async () => ({ correctionId: 11 }) });
    await screen.findByRole('status');
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Save closing totals' })).toBeNull();
  });
  it('shows the latest correction with its old and new values', () => {
    mount({ ...session, latest_closing_correction: {
      id: 11, actor_name: 'Alex', reason: 'Closing sheet checked', created_at: '2026-10-16 10:00:00',
      counts_snapshot: [{ id: 8, payment_method: 'Cash', previous_counted: 818, counted_amount: 815.99 }],
    } });
    expect(screen.getByRole('region', { name: 'Last closing correction' }).textContent).toContain('Closing sheet checked');
    expect(screen.getByText('Cash: $818.00 to $815.99')).toBeTruthy();
  });
});
