/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockView } from '../StockView';

const rows = [
  { variant_id: 'owned', sku: 'OWN', product_name: 'Owned product', qty_on_hand: 2, qty_committed: 0, avg_cost: 20, is_consignment: 0 },
  { variant_id: 'consigned', sku: 'CON', product_name: 'Supplier product', qty_on_hand: 10, qty_committed: 1, avg_cost: 50, is_consignment: 1 },
];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const renderView = () => render(<StockView
  inputStyle={{}} btnStyle={() => ({})} Spinner={() => <span>Loading</span>}
  EmptyState={({ text }) => <span>{text}</span>}
  fmtCurrency={value => `$${Number(value ?? 0).toFixed(2)}`}
  fmtQty={value => String(value ?? 0)}
/>);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Stock Levels consignment values', () => {
  it('includes physical consignment stock without adding it to owned asset value', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('settings')
      ? response({ data: {} }) : response({ success: true, data: rows })));
    renderView();
    await screen.findByText('Supplier product');
    expect(screen.getByText('Owned Inventory Value:').textContent).toContain('$40.00');
    expect(screen.getByText('Consignment Supplier-Cost Value (not owned):').textContent).toContain('$500.00');
    expect(screen.getByText(/Total SOH:/).textContent).toContain('12');
    expect(screen.getByText('Consignment - not owned')).toBeTruthy();
    expect(screen.getByRole('region', { name: /Stock levels table/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Stock ownership' }), { target: { value: 'consignment' } });
    expect(screen.queryByText('Owned product')).toBeNull();
    expect(screen.getByText('Owned Inventory Value:').textContent).toContain('$0.00');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Owned product')).toBeTruthy();
  });

  it('surfaces load failures instead of displaying an empty successful report', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('settings')
      ? response({ data: {} }) : response({ success: false, error: 'Stock evidence unavailable' }, 500)));
    renderView();
    expect((await screen.findByRole('alert')).textContent).toContain('Stock evidence unavailable');
    expect(screen.queryByText('No stock records match your filters.')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
  });
});
