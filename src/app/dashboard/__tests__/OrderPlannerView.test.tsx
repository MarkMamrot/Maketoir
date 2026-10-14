// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPlannerView } from '../OrderPlannerView';
import type { OrderPlannerRow } from '@/lib/ims/orderPlanner';

const row: OrderPlannerRow = {
  productId: 'product-1', optionId: 'variant-1', code: 'SHIRT', name: 'Shirt', brand: 'Harbour',
  supplierId: 'supplier-1', supplierName: 'Supplier One', createdDate: '', daysInStock: 90,
  effectiveSalesDays: 90, totalSOH: null, totalAvailable: null, totalIncoming: null,
  salesQty: 90, avgDailySales: 1, leadTimeDays: 0, coverageDays: 30, suggestedQty: null,
  packSize: 0, reorderQty: 0, cost: 10, estimatedLineValue: 0,
  missingStockBranchIds: ['2'], stockChecked: false, salesBranchIds: ['1', '2'],
};
const options = {
  brands: ['Harbour'], suppliers: [{ id: 'supplier-1', label: 'Supplier One' }],
};
const branches = [
  { id: '1', name: 'Sydney', isActive: true }, { id: '2', name: 'Melbourne', isActive: true },
];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return {
      json: async () => body.action === 'save-draft'
        ? { success: true, sheetName: 'Snapshot' }
        : { success: true, options, branches, rows: body.filterValue ? [structuredClone(row)] : [], summary: { totalRows: 1 } },
    };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function build() {
  render(<OrderPlannerView databaseId="business-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Lists' }).hasAttribute('disabled')).toBe(false));
  fireEvent.change(screen.getByPlaceholderText('Type to filter suppliers...'), { target: { value: 'Supplier One' } });
  fireEvent.change(screen.getByLabelText('Sales Source Branches'), { target: { value: 'selected' } });
  fireEvent.click(screen.getByRole('button', { name: 'Build Order Plan' }));
  await screen.findByText(/Stock incomplete: Melbourne/);
}

describe('Order Planner incomplete stock review', () => {
  it('shows incomplete lines without enabling zero rows and withholds their quantity', async () => {
    await build();
    expect(screen.getByText('Withheld')).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Reorder quantity for SHIRT' }).hasAttribute('disabled')).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Show zero-qty rows' }) as HTMLInputElement).checked).toBe(false);
  });

  it('requires acknowledgement for a manual quantity and clears it when acknowledgement is removed', async () => {
    await build();
    const acknowledgement = screen.getByRole('checkbox', { name: /Stock checked/ });
    const quantity = screen.getByRole('spinbutton', { name: 'Reorder quantity for SHIRT' });
    fireEvent.click(acknowledgement);
    expect(quantity.hasAttribute('disabled')).toBe(false);
    fireEvent.change(quantity, { target: { value: '12' } });
    expect((quantity as HTMLInputElement).value).toBe('12');
    expect(screen.getByText('Withheld')).toBeTruthy();
    fireEvent.click(acknowledgement);
    expect(quantity.hasAttribute('disabled')).toBe(true);
    expect((quantity as HTMLInputElement).value).toBe('0');
  });

  it('saves the reviewed branch scope rather than changed controls', async () => {
    await build();
    fireEvent.click(screen.getByRole('checkbox', { name: /Stock checked/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Reorder quantity for SHIRT' }), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Sales Source Branches'), { target: { value: 'all' } });
    expect(screen.getByRole('status').textContent).toContain('saving keeps the scope');
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft Order' }));
    await screen.findByText('Draft order saved to Snapshot.');
    const saved = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body))).find(body => body.action === 'save-draft');
    expect(saved).toMatchObject({
      databaseId: 'business-1', salesScope: 'selected', salesBranchIds: ['1', '2'],
      rows: [expect.objectContaining({ reorderQty: 12, stockChecked: true, suggestedQty: null })],
    });
  });

  it('does not interpret an empty selected-branch picker as all branches', async () => {
    await build();
    const selector = screen.getByRole('listbox', { name: /Pick Branches For Sales/ });
    for (const option of Array.from((selector as HTMLSelectElement).options)) option.selected = false;
    fireEvent.change(selector);
    const calls = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Build Order Plan' }));
    expect(screen.getByText('Select at least one sales branch.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
});
