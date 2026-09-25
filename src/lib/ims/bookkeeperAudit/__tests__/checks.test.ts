import { describe, expect, it } from 'vitest';
import { AUDIT_CHECK_CATALOG, buildAuditCheckList } from '../checks';

describe('Bookkeeper Audit check catalog', () => {
  it('lists every supported audit check exactly once', () => {
    expect(AUDIT_CHECK_CATALOG.map(check => check.id)).toEqual([
      'purchase_orders',
      'sales_orders',
      'customer_credit_notes',
      'supplier_credit_notes',
      'branch_transfers',
      'stocktakes',
      'negative_stock',
      'sales_cogs',
      'xero_documents',
      'xero_mappings',
      'month_end_inventory',
    ]);
    expect(new Set(AUDIT_CHECK_CATALOG.map(check => check.id)).size).toBe(AUDIT_CHECK_CATALOG.length);
  });

  it('applies the latest coverage result to every check in an area', () => {
    const checks = buildAuditCheckList({
      operational: 'checked',
      cogs: 'unable_to_check',
      xero: 'checked',
      monthEndInventory: 'not_yet_checked',
    });

    expect(checks.filter(check => check.area === 'operational').every(check => check.status === 'checked')).toBe(true);
    expect(checks.find(check => check.id === 'sales_cogs')?.status).toBe('unable_to_check');
    expect(checks.find(check => check.id === 'month_end_inventory')?.status).toBe('not_yet_checked');
  });
});