// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesSearchView } from '../SalesSearchView';

vi.mock('../reportFilterHelpers', () => ({
  SBDatePicker: ({ value, onChange }: { value: { label: string }; onChange: (range: unknown) => void }) => <div>
    <span>{value.label}</span>
    <button onClick={() => onChange({ kind: 'window', window: 7, label: '7 Days' })}>Choose 7 Days</button>
    <button onClick={() => onChange({ kind: 'range', from: '2026-10-01', to: '2026-10-10', label: 'Custom range' })}>Choose custom</button>
  </div>,
}));
const apiFetch = vi.fn();
const result = (name = 'Candle') => ({
  rows: [{ variant_id: name, sku: name, product_name: name, option_label: '', brand: '', supplier_name: '',
    qty: 1, revenue: 110, pos_qty: 0, online_qty: 1, wholesale_qty: 0, history_qty: 0 }],
  total: 301, totalQty: 301, totalRevenue: 33110,
});
beforeEach(() => {
  vi.resetAllMocks();
  apiFetch.mockResolvedValue(result());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ instances: [
    { provider: 'shopify', channelInstanceId: 'store-1', displayName: 'Store One' },
    { provider: 'shopify', channelInstanceId: 'store-2', displayName: 'Store Two' },
  ] }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount() {
  render(<SalesSearchView onBack={() => {}} apiFetch={apiFetch} today={() => '2026-10-14'} fmtCurrency={n => `$${n}`} />);
  await screen.findByRole('option', { name: 'Store One' });
  await screen.findByLabelText('Rows per page');
}
const lastParams = () => new URL(`http://localhost${apiFetch.mock.calls.at(-1)![0]}`).searchParams;

describe('Sales Search channel scope', () => {
  it.each(['preset', 'custom'])('preserves %s dates, search and page size on store changes and resets page 1', async kind => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: kind === 'preset' ? 'Choose 7 Days' : 'Choose custom' }));
    fireEvent.change(screen.getByPlaceholderText(/Search product name/), { target: { value: 'candle' } });
    await screen.findByLabelText('Rows per page');
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } });
    await screen.findByRole('button', { name: '2' });
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(lastParams().get('page')).toBe('2'));
    fireEvent.change(screen.getByLabelText('Store / channel'), { target: { value: 'store-1' } });
    await waitFor(() => expect(lastParams().get('channelInstanceId')).toBe('store-1'));
    expect(lastParams().get('page')).toBe('1');
    expect(lastParams().get('pageSize')).toBe('100');
    expect(lastParams().get('q')).toBe('candle');
    if (kind === 'preset') expect(lastParams().get('days')).toBe('7');
    else {
      expect(lastParams().get('from')).toBe('2026-10-01');
      expect(lastParams().get('to')).toBe('2026-10-10');
      expect(lastParams().has('days')).toBe(false);
    }
    expect((screen.getByPlaceholderText(/Search product name/) as HTMLInputElement).value).toBe('candle');
    await screen.findByLabelText('Rows per page');
    expect((screen.getByLabelText('Rows per page') as HTMLSelectElement).value).toBe('100');
    fireEvent.change(screen.getByLabelText('Store / channel'), { target: { value: '' } });
    await waitFor(() => expect(lastParams().has('channelInstanceId')).toBe(false));
    expect(lastParams().get('q')).toBe('candle');
    expect(lastParams().get('pageSize')).toBe('100');
  });
  it('ignores late results from the previous store', async () => {
    await mount();
    let resolveOld!: (value: ReturnType<typeof result>) => void;
    apiFetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(result('Current Store'));
    fireEvent.change(screen.getByLabelText('Store / channel'), { target: { value: 'store-1' } });
    fireEvent.change(screen.getByLabelText('Store / channel'), { target: { value: 'store-2' } });
    await screen.findByText('Current Store', { selector: 'div' });
    await act(async () => { resolveOld(result('Old Store')); });
    expect(screen.queryByText('Old Store', { selector: 'div' })).toBeNull();
    expect(screen.getByText('Current Store', { selector: 'div' })).toBeTruthy();
  });
  it('ignores a late failure from the previous store', async () => {
    await mount();
    let rejectOld!: (error: Error) => void;
    apiFetch.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce(result('Current Store'));
    fireEvent.change(screen.getByLabelText('Store / channel'), { target: { value: 'store-1' } });
    fireEvent.change(screen.getByLabelText('Store / channel'), { target: { value: 'store-2' } });
    await screen.findByText('Current Store', { selector: 'div' });
    await act(async () => { rejectOld(new Error('Old store failed')); });
    expect(screen.queryByText('Old store failed')).toBeNull();
  });
  it('clears old results and disables export on a failed current-store request', async () => {
    await mount();
    apiFetch.mockRejectedValueOnce(new Error('Current store failed'));
    fireEvent.change(screen.getByLabelText('Store / channel'), { target: { value: 'store-1' } });
    await screen.findByText('Current store failed');
    expect(screen.queryByText('Candle', { selector: 'div' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' }).hasAttribute('disabled')).toBe(true);
  });
});
