export type StockAvailabilityIssue = 'at_risk' | 'overdue' | 'unsourced' | 'ready' | 'incoming' | 'held';

export type StockAvailabilityRow = {
  qty_ordered: number | string;
  qty_fulfilled?: number | string | null;
  qty_allocated?: number | string | null;
  qty_received_assigned?: number | string | null;
  allocation_qty_fulfilled?: number | string | null;
  at_risk_count?: number | string | null;
  earliest_incoming_date?: string | null;
  status: string;
};

export type StockAvailabilitySummary = {
  outstanding: number;
  protected: number;
  ready: number;
  incoming: number;
  unsourced: number;
  issues: StockAvailabilityIssue[];
};

const quantity = (value: unknown) => Math.max(0, Number(value ?? 0) || 0);

export function summarizeStockAvailabilityRow(
  row: StockAvailabilityRow,
  today = new Date().toISOString().slice(0, 10),
): StockAvailabilitySummary {
  const outstanding = Math.max(0, quantity(row.qty_ordered) - quantity(row.qty_fulfilled));
  const protectedQuantity = Math.min(
    outstanding,
    Math.max(0, quantity(row.qty_allocated) - quantity(row.allocation_qty_fulfilled)),
  );
  const ready = Math.min(
    protectedQuantity,
    Math.max(0, quantity(row.qty_received_assigned) - quantity(row.allocation_qty_fulfilled)),
  );
  const incoming = Math.max(0, protectedQuantity - ready);
  const unsourced = Math.max(0, outstanding - protectedQuantity);
  const issues: StockAvailabilityIssue[] = [];

  if (quantity(row.at_risk_count) > 0) issues.push('at_risk');
  if (incoming > 0 && row.earliest_incoming_date && row.earliest_incoming_date.slice(0, 10) < today) issues.push('overdue');
  if (unsourced > 0) issues.push('unsourced');
  if (ready > 0) issues.push('ready');
  if (incoming > 0) issues.push('incoming');
  if (row.status === 'backordered') issues.push('held');

  return { outstanding, protected: protectedQuantity, ready, incoming, unsourced, issues };
}