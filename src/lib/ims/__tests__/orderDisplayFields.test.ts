import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PURCHASE_ORDER_DISPLAY_FIELDS,
  DEFAULT_SALES_ORDER_DISPLAY_FIELDS,
  sanitizeOrderDisplayFieldSelection,
} from '../orderDisplayFields';

const salesFields = [
  ...DEFAULT_SALES_ORDER_DISPLAY_FIELDS.map(id => ({
    id, required: id === 'so_number' || id === 'customer_name',
  })),
  { id: 'notes' },
];
const purchaseFields = DEFAULT_PURCHASE_ORDER_DISPLAY_FIELDS.map(id => ({
  id, required: id === 'po_number' || id === 'supplier_name',
}));

describe('order display fields', () => {
  it('shows the requested sales-order defaults when no preference exists', () => {
    expect(sanitizeOrderDisplayFieldSelection(
      JSON.parse('null'), salesFields, DEFAULT_SALES_ORDER_DISPLAY_FIELDS,
    )).toEqual([
      'so_number', 'customer_name', 'channel_order_number', 'sales_channel',
      'location_name', 'status', 'order_date', 'total_amount',
    ]);
  });

  it('shows purchasing defaults including the expected delivery date', () => {
    expect(sanitizeOrderDisplayFieldSelection(
      undefined, purchaseFields, DEFAULT_PURCHASE_ORDER_DISPLAY_FIELDS,
    )).toEqual([
      'po_number', 'supplier_name', 'supplier_invoice_number', 'location_name',
      'status', 'order_date', 'expected_date', 'total_amount',
    ]);
  });

  it.each([{}, 'invalid', 1])('uses defaults for malformed preferences %#', value => {
    expect(sanitizeOrderDisplayFieldSelection(
      value, salesFields, DEFAULT_SALES_ORDER_DISPLAY_FIELDS,
    )).toEqual(DEFAULT_SALES_ORDER_DISPLAY_FIELDS);
  });

  it('preserves a saved custom selection without enabling new defaults', () => {
    expect(sanitizeOrderDisplayFieldSelection(
      ['notes', 'total_amount'], salesFields, DEFAULT_SALES_ORDER_DISPLAY_FIELDS,
    )).toEqual(['so_number', 'customer_name', 'notes', 'total_amount']);
  });

  it('preserves an intentionally minimal saved selection', () => {
    expect(sanitizeOrderDisplayFieldSelection(
      [], salesFields, DEFAULT_SALES_ORDER_DISPLAY_FIELDS,
    )).toEqual(['so_number', 'customer_name']);
  });

  it('removes duplicates, obsolete fields and invalid values while retaining required fields', () => {
    expect(sanitizeOrderDisplayFieldSelection(
      ['status', 'status', 'obsolete', null, 1, 'so_number'],
      salesFields, DEFAULT_SALES_ORDER_DISPLAY_FIELDS,
    )).toEqual(['so_number', 'customer_name', 'status']);
  });

  it('restores defaults while filtering any unavailable fields', () => {
    expect(sanitizeOrderDisplayFieldSelection(
      [...DEFAULT_PURCHASE_ORDER_DISPLAY_FIELDS],
      purchaseFields.filter(field => field.id !== 'supplier_invoice_number'),
      DEFAULT_PURCHASE_ORDER_DISPLAY_FIELDS,
    )).toEqual([
      'po_number', 'supplier_name', 'location_name', 'status',
      'order_date', 'expected_date', 'total_amount',
    ]);
  });
});
