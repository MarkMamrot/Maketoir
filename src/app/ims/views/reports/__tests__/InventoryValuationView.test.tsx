/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValuationResult } from '@/lib/ims/inventoryValuation';
import { InventoryValuationView } from '../InventoryValuationView';
import { SBDatePicker } from '../reportFilterHelpers';

vi.mock('../reportFilterHelpers', async importOriginal => {
  const actual = await importOriginal<typeof import('../reportFilterHelpers')>();
  return {
    ...actual,
    ReportMultiFilter: ({ onChange }: { onChange: (value: typeof actual.EMPTY_MULTI) => void }) =>
      <button onClick={() => onChange({ ...actual.EMPTY_MULTI, brand: { type: 'brand', value: 'Acme', label: 'Acme' } })}>Choose Acme</button>,
  };
});

const report = (date = '2026-10-14', total = 21): ValuationResult => ({
  success: true, as_at: date, business_today: '2026-10-14', time_zone: 'Australia/Sydney',
  historical: date !== '2026-10-14', costing_method: 'average_cost', cost_epoch_id: null,
  data: [{
    variant_id: 'v1', sku: 'SKU-1', name: 'Product', brand: 'Acme', supplier_name: 'Supplier',
    cost: total / 3, soh: 3, total_value: total, layer_quantity: null, reconciliation_delta: 0,
    cost_source: date !== '2026-10-14' ? 'current_fallback' : undefined,
  }],
  reconciliation: { status: 'balanced', mismatched_sku_count: 0, mismatched_location_count: 0, stock_quantity: 3, valued_quantity: 3, mismatches: [] },
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const renderView = () => render(<InventoryValuationView onBack={() => {}} fmtCurrency={value => `$${value.toFixed(2)}`} />);
async function selectDate(date: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'As at date' }));
  await user.click(screen.getByRole('button', { name: 'Custom Date' }));
  fireEvent.change(screen.getByLabelText('As at date', { selector: 'input' }), { target: { value: date } });
  await user.click(screen.getByRole('button', { name: 'Apply' }));
}

describe('Inventory Valuation view', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(report()))));
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('loads Today without requesting reconstruction and sends only a selected past date', async () => {
    renderView();
    await screen.findByText('Total Inventory Value — 2026-10-14');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain('asAt=');
    vi.mocked(fetch).mockResolvedValue(response(report('2026-09-30', 30)));
    await selectDate('2026-09-30');
    await screen.findByText('Total Inventory Value — 2026-09-30');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('asAt=2026-09-30');
    expect(screen.getByText(/Stock at the end of 2026-09-30/)).toBeTruthy();
    expect(screen.getByText("Today's cost (estimate)")).toBeTruthy();
  });
  it('retains the date when choosing and clearing catalogue filters', async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Total Inventory Value — 2026-10-14');
    vi.mocked(fetch).mockResolvedValue(response(report('2026-09-30')));
    await selectDate('2026-09-30');
    await screen.findByText('Total Inventory Value — 2026-09-30');
    await user.click(screen.getByRole('button', { name: 'Choose Acme' }));
    await waitFor(() => expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain('brand=Acme&asAt=2026-09-30'));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect(String(vi.mocked(fetch).mock.calls[3][0])).toContain('asAt=2026-09-30');
      expect(String(vi.mocked(fetch).mock.calls[3][0])).not.toContain('brand=');
    });
  });
  it('returns to the live path and ignores a late response from an older date', async () => {
    let resolvePast!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(response(report()))
      .mockReturnValueOnce(new Promise(resolve => { resolvePast = resolve; }))
      .mockResolvedValueOnce(response(report('2026-10-14', 42)));
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Total Inventory Value — 2026-10-14');
    await selectDate('2026-09-30');
    expect(screen.queryByText('Product')).toBeNull();
    expect((screen.getByRole('button', { name: '⬇ Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'As at date' }));
    await user.click(screen.getByRole('button', { name: 'Presets' }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await screen.findByText('Total Inventory Value — 2026-10-14');
    expect(String(vi.mocked(fetch).mock.calls[2][0])).not.toContain('asAt=');
    await act(async () => resolvePast(response(report('2026-09-30', 999))));
    expect(screen.getByText('Total Inventory Value — 2026-10-14')).toBeTruthy();
    expect(screen.queryByText('$999.00')).toBeNull();
    expect(screen.getAllByText('$42.00')).toHaveLength(2);
  });
  it('invalidates old totals and disables export after a failed date request', async () => {
    renderView();
    await screen.findByText('Total Inventory Value — 2026-10-14');
    vi.mocked(fetch).mockResolvedValue(response({ success: false, error: 'History unavailable' }, 500));
    await selectDate('2026-09-30');
    expect((await screen.findByRole('alert')).textContent).toContain('History unavailable');
    expect(screen.queryByText('Product')).toBeNull();
    expect(screen.queryByText('$21.00')).toBeNull();
    expect((screen.getByRole('button', { name: '⬇ Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps consignment value distinct from owned assets when showing all ownership', async () => {
    renderView();
    await screen.findByText('Total Inventory Value — 2026-10-14');
    const owned = report();
    vi.mocked(fetch).mockResolvedValue(response({
      ...owned,
      data: [...owned.data, {
        ...owned.data[0], variant_id: 'v2', sku: 'CON-1', is_consignment: true,
        cost: 50, soh: 10, total_value: 500,
      }],
    }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ownership' }), { target: { value: 'all' } });
    await screen.findByText('Combined Operational Value (includes stock not owned) — 2026-10-14');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('ownership=all');
    expect(screen.getByText('Owned inventory: $21.00; consignment (not owned): $500.00')).toBeTruthy();
    expect(screen.getByText('Consignment - not owned inventory')).toBeTruthy();
  });
  it('shows historical estimates, inferred openings and missing history explicitly', async () => {
    renderView();
    await screen.findByText('Total Inventory Value — 2026-10-14');
    vi.mocked(fetch).mockResolvedValue(response({
      ...report('2026-09-30'),
      warnings: { current_cost_sku_count: 1, uncosted_sku_count: 1, inferred_opening_sku_count: 1, incomplete_history_sku_count: 1, negative_position_count: 1 },
    }));
    await selectDate('2026-09-30');
    expect(await screen.findByText(/use today's costs because/)).toBeTruthy();
    expect(screen.getByText(/use inferred opening stock/)).toBeTruthy();
    expect(screen.getByText(/The valuation is incomplete/)).toBeTruthy();
    expect(screen.getByText(/do not reconcile with recorded movements/)).toBeTruthy();
  });
});

describe('shared date picker modes', () => {
  afterEach(cleanup);
  it('offers only single-date presets in as-at mode and blocks a future custom date', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SBDatePicker value={{ kind: 'range', from: '2026-10-14', to: '2026-10-14', label: 'Today' }} onChange={onChange} asAt={{ today: '2026-10-14' }} />);
    await user.click(screen.getByRole('button', { name: 'As at date' }));
    expect(screen.queryByText('Last 7 days')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: '2026-10-13', to: '2026-10-13', label: '2026-10-13' });
    await user.click(screen.getByRole('button', { name: 'As at date' }));
    await user.click(screen.getByRole('button', { name: 'Custom Date' }));
    const input = screen.getByLabelText('As at date', { selector: 'input' });
    expect(input.getAttribute('max')).toBe('2026-10-14');
    fireEvent.change(input, { target: { value: '2026-10-15' } });
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('retains rolling presets and two date inputs in the existing range mode', async () => {
    const user = userEvent.setup();
    render(<SBDatePicker value={{ kind: 'window', window: 90, label: '90 Days' }} onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: '90 Days' }));
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Custom Range' }));
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
    expect(screen.getByLabelText('To').getAttribute('max')).toBeNull();
  });
});
