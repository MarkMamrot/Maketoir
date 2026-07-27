function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePosTaxRatePercent(value: unknown): number {
  const parsed = toNullableNumber(value);
  if (parsed == null) return 0;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

export interface PosMarginItemInput {
  qty?: unknown;
  line_total?: unknown;
  tax_rate?: unknown;
  unit_cost?: unknown;
  avg_cost?: unknown;
  code?: string | null;
  name?: string | null;
}

export interface PosMarginRow {
  item: PosMarginItemInput;
  qty: number;
  unitCost: number | null;
  cogs: number | null;
  lineEx: number;
}

export interface PosMarginSummary {
  rows: PosMarginRow[];
  revenueEx: number;
  totalCogs: number | null;
  grossProfit: number | null;
  marginPct: number | null;
}

export function resolvePosItemUnitCost(item: PosMarginItemInput): number | null {
  const explicitCost = toNullableNumber(item.unit_cost);
  if (explicitCost != null) return explicitCost;
  return toNullableNumber(item.avg_cost);
}

export function summarizePosMargin(items: PosMarginItemInput[]): PosMarginSummary {
  const rows = items.map((item) => {
    const qty = Math.abs(Number(item.qty ?? 0));
    const lineInc = Number(item.line_total ?? 0);
    const taxRatePct = normalizePosTaxRatePercent(item.tax_rate);
    const lineEx = taxRatePct > 0 ? lineInc / (1 + taxRatePct / 100) : lineInc;
    const unitCost = resolvePosItemUnitCost(item);
    const cogs = unitCost != null ? qty * unitCost : null;
    return { item, qty, unitCost, cogs, lineEx };
  });

  const revenueEx = rows.reduce((sum, row) => sum + row.lineEx, 0);
  const hasCosts = rows.some((row) => row.unitCost != null);
  const totalCogs = hasCosts ? rows.reduce((sum, row) => sum + (row.cogs ?? 0), 0) : null;
  const grossProfit = totalCogs != null ? revenueEx - totalCogs : null;
  const marginPct = grossProfit != null && revenueEx !== 0 ? (grossProfit / revenueEx) * 100 : null;

  return { rows, revenueEx, totalCogs, grossProfit, marginPct };
}
