export type StockAvailabilityManagementRow = {
  soId: number;
  soItemId: number;
  soNumber: string;
  customerName: string;
  locationName: string;
  sku: string | null;
  productName: string;
  outstanding: number;
  unsourced: number;
  unsourcedValue: number;
  ready: number;
  readyValue: number;
  protectedIncoming: number;
  protectedIncomingCost: number;
  promisedDate: string | null;
  overdue: boolean;
  atRisk: boolean;
};

export type StockAvailabilityManagementSummary = {
  unsourcedUnits: number;
  unsourcedValue: number;
  readyUnits: number;
  readyValue: number;
  protectedIncomingUnits: number;
  protectedIncomingCost: number;
  overduePromises: number;
  atRiskPromises: number;
};

export type StockAvailabilityManagementInput = {
  so_id: number | string;
  so_item_id: number | string;
  so_number: string;
  customer_name: string;
  location_name: string;
  sku: string | null;
  product_name: string;
  qty_ordered: number | string;
  qty_fulfilled: number | string;
  unit_price: number | string;
  discount_pct: number | string;
  qty_allocated_remaining: number | string | null;
  qty_ready: number | string | null;
  incoming_cost: number | string | null;
  promised_date: string | null;
  overdue_count: number | string | null;
  at_risk_count: number | string | null;
};

const roundQuantity = (value: number) => Number(value.toFixed(4));
const roundMoney = (value: number) => Number(value.toFixed(2));

export function buildStockAvailabilityManagementReport(rows: StockAvailabilityManagementInput[]): {
  rows: StockAvailabilityManagementRow[];
  summary: StockAvailabilityManagementSummary;
} {
  const reportRows = rows.map(row => {
    const outstanding = Math.max(0, Number(row.qty_ordered) - Number(row.qty_fulfilled));
    const protectedQuantity = Math.min(outstanding, Math.max(0, Number(row.qty_allocated_remaining ?? 0)));
    const ready = Math.min(protectedQuantity, Math.max(0, Number(row.qty_ready ?? 0)));
    const protectedIncoming = Math.max(0, protectedQuantity - ready);
    const unsourced = Math.max(0, outstanding - protectedQuantity);
    const salesUnitValue = Number(row.unit_price) * (1 - Number(row.discount_pct ?? 0) / 100);

    return {
      soId: Number(row.so_id),
      soItemId: Number(row.so_item_id),
      soNumber: String(row.so_number),
      customerName: String(row.customer_name),
      locationName: String(row.location_name),
      sku: row.sku,
      productName: String(row.product_name),
      outstanding: roundQuantity(outstanding),
      unsourced: roundQuantity(unsourced),
      unsourcedValue: roundMoney(unsourced * salesUnitValue),
      ready: roundQuantity(ready),
      readyValue: roundMoney(ready * salesUnitValue),
      protectedIncoming: roundQuantity(protectedIncoming),
      protectedIncomingCost: roundMoney(Math.max(0, Number(row.incoming_cost ?? 0))),
      promisedDate: row.promised_date,
      overdue: Number(row.overdue_count ?? 0) > 0,
      atRisk: Number(row.at_risk_count ?? 0) > 0,
    };
  });

  const overdueSalesOrders = new Set(reportRows.filter(row => row.overdue).map(row => row.soId));
  const atRiskSalesOrders = new Set(reportRows.filter(row => row.atRisk).map(row => row.soId));
  const summary = reportRows.reduce<StockAvailabilityManagementSummary>((totals, row) => ({
    unsourcedUnits: totals.unsourcedUnits + row.unsourced,
    unsourcedValue: totals.unsourcedValue + row.unsourcedValue,
    readyUnits: totals.readyUnits + row.ready,
    readyValue: totals.readyValue + row.readyValue,
    protectedIncomingUnits: totals.protectedIncomingUnits + row.protectedIncoming,
    protectedIncomingCost: totals.protectedIncomingCost + row.protectedIncomingCost,
    overduePromises: overdueSalesOrders.size,
    atRiskPromises: atRiskSalesOrders.size,
  }), {
    unsourcedUnits: 0,
    unsourcedValue: 0,
    readyUnits: 0,
    readyValue: 0,
    protectedIncomingUnits: 0,
    protectedIncomingCost: 0,
    overduePromises: 0,
    atRiskPromises: 0,
  });

  summary.unsourcedUnits = roundQuantity(summary.unsourcedUnits);
  summary.unsourcedValue = roundMoney(summary.unsourcedValue);
  summary.readyUnits = roundQuantity(summary.readyUnits);
  summary.readyValue = roundMoney(summary.readyValue);
  summary.protectedIncomingUnits = roundQuantity(summary.protectedIncomingUnits);
  summary.protectedIncomingCost = roundMoney(summary.protectedIncomingCost);
  return { rows: reportRows, summary };
}