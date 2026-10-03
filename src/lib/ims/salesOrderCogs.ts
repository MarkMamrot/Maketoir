export interface SalesOrderCogsLineInput {
  qtyOrdered: unknown;
  qtyFulfilled: unknown;
  capturedUnitCost: unknown;
  estimatedUnitCost: unknown;
  isStockItem?: boolean | number | null;
}

export interface SalesOrderCogsLineSummary {
  qtyOrdered: number;
  qtyFulfilled: number;
  qtyRemaining: number;
  actualCogs: number | null;
  estimatedRemainingCogs: number | null;
}

export interface SalesOrderCogsSummary {
  lines: SalesOrderCogsLineSummary[];
  actualCogs: number | null;
  estimatedRemainingCogs: number | null;
  hasRemainingStock: boolean;
  estimatesComplete: boolean;
  allQuantitiesFulfilled: boolean;
  actualCostComplete: boolean;
  grossMarginAvailable: boolean;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeSalesOrderCogs(items: SalesOrderCogsLineInput[]): SalesOrderCogsSummary {
  const lines = items.map(item => {
    const qtyOrdered = Math.max(0, finiteNumber(item.qtyOrdered) ?? 0);
    const qtyFulfilled = Math.min(qtyOrdered, Math.max(0, finiteNumber(item.qtyFulfilled) ?? 0));
    const qtyRemaining = Math.max(0, qtyOrdered - qtyFulfilled);
    const isStockItem = item.isStockItem !== false && Number(item.isStockItem ?? 1) !== 0;

    if (!isStockItem) {
      return { qtyOrdered, qtyFulfilled, qtyRemaining, actualCogs: 0, estimatedRemainingCogs: null };
    }

    const capturedUnitCost = finiteNumber(item.capturedUnitCost);
    const estimatedUnitCost = finiteNumber(item.estimatedUnitCost);
    const actualCogs = qtyFulfilled === 0
      ? 0
      : capturedUnitCost != null && capturedUnitCost > 0
        ? qtyFulfilled * capturedUnitCost
        : null;
    const estimatedRemainingCogs = qtyRemaining === 0
      ? null
      : estimatedUnitCost != null && estimatedUnitCost > 0
        ? qtyRemaining * estimatedUnitCost
        : null;

    return { qtyOrdered, qtyFulfilled, qtyRemaining, actualCogs, estimatedRemainingCogs };
  });

  const actualCostComplete = lines.every(line => line.actualCogs !== null);
  const hasRemainingStock = lines.some(line => line.qtyRemaining > 0 && line.estimatedRemainingCogs !== null)
    || items.some((item, index) => (
      item.isStockItem !== false
      && Number(item.isStockItem ?? 1) !== 0
      && lines[index].qtyRemaining > 0
    ));
  const estimatesComplete = lines.every((line, index) => {
    const isStockItem = items[index].isStockItem !== false && Number(items[index].isStockItem ?? 1) !== 0;
    return !isStockItem || line.qtyRemaining === 0 || line.estimatedRemainingCogs !== null;
  });
  const allQuantitiesFulfilled = lines.every(line => line.qtyRemaining === 0);
  const hasEstimatedRemainder = lines.some((line, index) => (
    items[index].isStockItem !== false
    && Number(items[index].isStockItem ?? 1) !== 0
    && line.qtyRemaining > 0
  ));

  return {
    lines,
    actualCogs: actualCostComplete ? lines.reduce((total, line) => total + (line.actualCogs ?? 0), 0) : null,
    estimatedRemainingCogs: hasEstimatedRemainder && estimatesComplete
      ? lines.reduce((total, line) => total + (line.estimatedRemainingCogs ?? 0), 0)
      : null,
    hasRemainingStock,
    estimatesComplete,
    allQuantitiesFulfilled,
    actualCostComplete,
    grossMarginAvailable: allQuantitiesFulfilled && actualCostComplete,
  };
}