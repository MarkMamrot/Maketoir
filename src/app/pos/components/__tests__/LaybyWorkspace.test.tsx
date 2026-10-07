// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaybyWorkspace } from '../LaybyWorkspace';

vi.mock('../../_store', () => ({ loadDeviceConfig: () => ({ business_id: 'business-1' }) }));
const session = { pos_user_id: 4, username: 'staff', full_name: 'Staff', location_id: 1, location_name: 'Branch', register_id: 2, register_name: 'Till' };
const layby = { id: 10, customer_name: 'Customer', total: 129.95, paid_total: 26, fee_percent: 0, layby_state: 'active', retained_fee: 0 };
const storageKey = 'pos_layby_pending:business-1:1:2';
const onReceipt = vi.fn();
const response = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body });
const transaction = { sale: { id: 10, local_id: 'original', total: 129.95, subtotal: 129.95, tax_total: 11.81, discount_total: 0, status: 'layby_active', sale_type: 'layby' }, items: [], payments: [] };
function workspace() {
  return <LaybyWorkspace session={session} onBack={vi.fn()} onReceipt={onReceipt} renderPayment={options => <div role='dialog' aria-label='Record layby payment'>{options.extraContent}<button onClick={() => options.onComplete([{ localId: 'captured-payment', method: 'Card', amount: options.total < 0 ? options.total : 30, reference: 'terminal-reference' }])}>Record payment</button></div>} />;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('Layby workspace recovery and cancellation', () => {
  it('retains an immutable action after a lost response and retries it after remount without payment entry', async () => {
    const fetch = vi.fn((url: string, options?: RequestInit) => options?.method === 'POST' ? Promise.reject(new Error('Connection lost')) : response({ laybys: [layby] }));
    vi.stubGlobal('fetch', fetch);
    const view = render(workspace());
    fireEvent.click(await screen.findByRole('button', { name: 'Add payment' }));
    const checkbox = screen.getByRole('checkbox', { name: 'Collect when fully paid' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByRole('button', { name: 'Retry saved action' });
    const saved = JSON.parse(localStorage.getItem(storageKey)!);
    expect(saved.body).toMatchObject({ action: 'payment', collect: false, payments: [{ amount: 30, payment_method: 'Card' }] });
    expect(saved.layby.customer_name).toBe('');
    view.unmount();
    fetch.mockImplementation((url: string, options?: RequestInit) => options?.method === 'POST' ? response({ transaction }) : response({ laybys: [layby] }));
    render(workspace());
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved action' }));
    await waitFor(() => expect(onReceipt).toHaveBeenCalledOnce());
    const posted = fetch.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(String(options?.body)));
    expect(posted[1]).toEqual(posted[0]);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it('requires a reason for a fee override and records only the exact negative refund', async () => {
    const fetch = vi.fn((url: string, options?: RequestInit) => options?.method === 'POST' ? response({ transaction }) : response({ laybys: [layby] }));
    vi.stubGlobal('fetch', fetch);
    render(workspace());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel layby' }));
    fireEvent.change(screen.getByLabelText('Retained cancellation fee'), { target: { value: '5' } });
    expect((screen.getByRole('button', { name: 'Confirm cancellation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Cancellation fee override reason'), { target: { value: 'Agreed adjustment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refund and cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(onReceipt).toHaveBeenCalledOnce());
    const post = fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ action: 'cancel', fee_override: 5, reason: 'Agreed adjustment', payments: [{ amount: -21 }] });
  });
  it('recovers a saved opening deposit with its original local reference', async () => {
    const opening = { local_id: 'opening-reference', sale_type: 'layby', total: 129.95, payments: [{ payment_method: 'Card', amount: 26 }] };
    localStorage.setItem('pos_layby_opening:business-1:1:2', JSON.stringify(opening));
    const fetch = vi.fn((url: string, options?: RequestInit) => options?.method === 'POST' ? response({ id: 10 }) : url.includes('/sales/') ? response(transaction) : response({ laybys: [layby] }));
    vi.stubGlobal('fetch', fetch);
    render(workspace());
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved deposit' }));
    await waitFor(() => expect(onReceipt).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetch.mock.calls.find(([, options]) => options?.method === 'POST')?.[1]?.body))).toEqual(opening);
    expect(localStorage.getItem('pos_layby_opening:business-1:1:2')).toBeNull();
  });
});