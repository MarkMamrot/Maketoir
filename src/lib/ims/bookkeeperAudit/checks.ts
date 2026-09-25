export type AuditCoverageArea = 'operational' | 'cogs' | 'xero' | 'monthEndInventory';
export type AuditCheckStatus = 'checked' | 'unable_to_check' | 'not_yet_checked';

// Every finding-producing detector must use an ID from this user-visible catalog.
export const AUDIT_CHECK_CATALOG = [
  { id: 'purchase_orders', area: 'operational', name: 'Purchase Orders', description: 'Finds overdue active orders and drafts older than 60 days.' },
  { id: 'sales_orders', area: 'operational', name: 'Sales Orders', description: 'Finds overdue active orders and drafts older than 90 days.' },
  { id: 'customer_credit_notes', area: 'operational', name: 'Customer Credit Notes', description: 'Finds drafts and returns awaiting product that remain open for more than 30 days.' },
  { id: 'supplier_credit_notes', area: 'operational', name: 'Supplier Credit Notes', description: 'Finds drafts that remain open for more than 30 days.' },
  { id: 'branch_transfers', area: 'operational', name: 'Branch Transfers', description: 'Finds sent or partial transfers older than seven days and drafts older than 30 days.' },
  { id: 'stocktakes', area: 'operational', name: 'Stocktakes', description: 'Finds stocktakes still in progress more than two days after creation.' },
  { id: 'negative_stock', area: 'operational', name: 'Negative Stock', description: 'Finds active inventory-tracked products with stock on hand below zero at a location.' },
  { id: 'sales_cogs', area: 'cogs', name: 'Sales COGS', description: 'Finds missing, zero, or negative movement cost on inventory sales in the previous completed month.' },
  { id: 'xero_documents', area: 'xero', name: 'Xero Documents', description: 'Checks linked documents for identity, type, totals, currency, contact, lifecycle, payments, credits, and balances.' },
  { id: 'xero_mappings', area: 'xero', name: 'Xero Mappings', description: 'Finds missing or stale ledger and tracking mappings.' },
  { id: 'month_end_inventory', area: 'monthEndInventory', name: 'Month-end Inventory', description: 'Compares the prior month-end inventory valuation with the Xero Inventory Asset balance.' },
] as const satisfies readonly { id: string; area: AuditCoverageArea; name: string; description: string }[];

export type AuditCheckId = typeof AUDIT_CHECK_CATALOG[number]['id'];
export type AuditCoverage = Record<AuditCoverageArea, AuditCheckStatus>;

export type AuditCheck = typeof AUDIT_CHECK_CATALOG[number] & { status: AuditCheckStatus };

export function buildAuditCheckList(coverage: AuditCoverage): AuditCheck[] {
  return AUDIT_CHECK_CATALOG.map(check => ({ ...check, status: coverage[check.area] }));
}