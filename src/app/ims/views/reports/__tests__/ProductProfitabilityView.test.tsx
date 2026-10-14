// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductProfitabilityView } from '../ProductProfitabilityView';
import { summarise, emptyRow } from '@/lib/ims/cogsTraceability/domain';

vi.mock('../reportFilterHelpers', () => ({
  EMPTY_MULTI: {}, hasMultiFilter: () => false, multiFilterParams: () => ({}),
  ReportMultiFilter: () => <div>Product filters</div>,
  SBDatePicker: ({ onChange }: { onChange: (range: unknown) => void }) =>
    <button onClick={() => onChange({ kind: 'range', from: '2026-10-01', to: '2026-10-10', label: 'Custom' })}>Choose custom</button>,
}));
const fetchMock = vi.fn();
const data = {
  success: true, from: '2026-10-01', to: '2026-10-14', total: 101, excludedNonProductRecords: 0,
  data: [{ variantId: 'v1', sku: 'SKU', name: 'Shirt', brand: 'Brand', qty: 10, rev: 1000,
    cogs: 600, profit: 400, margin: 40, records: 1, missingCosts: 0, missingRevenue: 0 }],
  summary: summarise([{ ...emptyRow('1'), qty: 20, netSales: 2000, cogs: 1200, gp: 800 }]),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => data });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => render(<ProductProfitabilityView onBack={() => {}} fmtCurrency={n => `$${n.toFixed(2)}`} />);

describe('historical Product Profitability view', () => {
  it('shows full-result summary rather than current-page totals', async () => {
    mount();
    await screen.findByText('$800.00');
    expect(screen.getByText('$400.00')).toBeTruthy();
    expect(screen.getByText(/All matching products: 101 results/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![0]).toContain('page=2'));
    await screen.findByText('$800.00');
  });
  it('marks incomplete rows and totals unavailable, not zero', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      ...data, data: [{ ...data.data[0], cogs: null, profit: null, margin: null, missingCosts: 1 }],
      summary: summarise([{ ...emptyRow('1'), netSales: 1000, cogs: null }]),
    }) });
    mount();
    await screen.findByText(/Incomplete evidence/);
    expect(screen.getByText('Incomplete: 1 cost / 0 revenue')).toBeTruthy();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText('$0.00')).toBeNull();
  });
  it('passes custom range bounds to the API', async () => {
    mount();
    await screen.findByText('$800.00');
    fireEvent.click(screen.getByRole('button', { name: 'Choose custom' }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![0]).toContain('from=2026-10-01&to=2026-10-10'));
    expect(fetchMock.mock.calls.at(-1)![0]).not.toContain('window=');
  });
  it('clears stale values and disables export after a load failure', async () => {
    mount();
    await screen.findByText('$800.00');
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: 'Report unavailable' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Choose custom' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('$800.00')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' }).hasAttribute('disabled')).toBe(true);
  });
  it('discards a late response for an earlier period', async () => {
    let resolveInitial!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose custom' }));
    await screen.findByText('$800.00');
    await act(async () => { resolveInitial({ ok: true, json: async () => ({ ...data, total: 999 }) }); });
    expect(screen.queryByText(/999 results/)).toBeNull();
  });
});
