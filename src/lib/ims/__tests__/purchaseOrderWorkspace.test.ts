import { describe, expect, it } from 'vitest';
import { DEFAULT_PURCHASE_ORDER_WORKSPACE, sanitizePurchaseOrderWorkspace } from '../purchaseOrderWorkspace';

describe('purchase order workspace', () => {
  it('preserves valid filters, custom dates and sorting', () => {
    expect(sanitizePurchaseOrderWorkspace({
      status: 'partially_received', supplier: '  Acme  ', product: 'SKU-1',
      dateRange: { kind: 'range', from: '2026-08-01', to: '2026-08-31', label: 'August' },
      sortColumn: 'supplier_name', sortDirection: 'asc',
    })).toEqual({
      status: 'partially_received', supplier: 'Acme', product: 'SKU-1',
      dateRange: { kind: 'range', from: '2026-08-01', to: '2026-08-31', label: 'August' },
      sortColumn: 'supplier_name', sortDirection: 'asc',
    });
  });

  it('preserves valid date windows used by the shared picker', () => {
    expect(sanitizePurchaseOrderWorkspace({ dateRange: { kind: 'window', window: 365, label: '12 Months' } }).dateRange)
      .toEqual({ kind: 'window', window: 365, label: '12 Months' });
  });

  it('falls back safely for malformed persisted values', () => {
    expect(sanitizePurchaseOrderWorkspace({
      status: 'DROP TABLE', dateRange: { kind: 'range', from: 'yesterday', to: 'tomorrow' },
      sortColumn: 'unknown', sortDirection: 'sideways',
    })).toEqual(DEFAULT_PURCHASE_ORDER_WORKSPACE);
  });
});