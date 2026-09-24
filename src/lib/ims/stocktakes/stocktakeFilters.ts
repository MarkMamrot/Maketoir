export type StockOnHandOperator = 'gt' | 'lt' | 'eq';

export type StockOnHandFilter = {
  soh_operator?: StockOnHandOperator;
  soh_value?: number;
};

const SQL_OPERATORS: Record<StockOnHandOperator, '>' | '<' | '='> = {
  gt: '>',
  lt: '<',
  eq: '=',
};

export function parseStockOnHandFilter(operatorValue: unknown, quantityValue: unknown): StockOnHandFilter {
  const operator = typeof operatorValue === 'string' ? operatorValue.trim() : '';
  const hasQuantity = quantityValue !== undefined && quantityValue !== null && String(quantityValue).trim() !== '';
  if (!operator && !hasQuantity) return {};
  if (!operator || !hasQuantity || !(operator in SQL_OPERATORS)) {
    throw new Error('Stock on hand filter requires a valid operator and quantity.');
  }
  const quantity = Number(quantityValue);
  if (!Number.isFinite(quantity)) throw new Error('Stock on hand quantity must be a number.');
  return { soh_operator: operator as StockOnHandOperator, soh_value: quantity };
}

export function stockOnHandCondition(filter: StockOnHandFilter): { sql: string; params: number[] } | null {
  if (!filter.soh_operator || filter.soh_value === undefined) return null;
  return {
    sql: `COALESCE(s.qty_on_hand, 0) ${SQL_OPERATORS[filter.soh_operator]} ?`,
    params: [filter.soh_value],
  };
}
