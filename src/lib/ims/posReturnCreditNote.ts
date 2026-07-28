export interface PosReturnSourceItem {
  variant_id?: string | null;
  code?: string | null;
  name?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  line_total?: number | string | null;
  tax_rate?: number | string | null;
}

export interface PosReturnCreditNoteItem {
  variant_id: string | null;
  code: string | null;
  name: string;
  qty: number;
  unit_price: number;
  price_basis: 'custom';
  restock: true;
  tax_rate: number;
}

export function normalizePosTaxRate(value: unknown): number {
  const rate = Math.abs(Number(value ?? 0));
  return rate > 1 ? rate / 100 : rate;
}

export function buildPosReturnCreditNoteItems(items: PosReturnSourceItem[]): PosReturnCreditNoteItem[] {
  return items
    .filter(item => Number(item.qty ?? 0) < 0)
    .map(item => {
      const qty = Math.abs(Number(item.qty ?? 0));
      const grossLine = Math.abs(Number(item.line_total ?? 0));
      return {
        variant_id: item.variant_id ?? null,
        code: item.code ?? null,
        name: item.name ?? 'POS return',
        qty,
        unit_price: qty > 0 ? grossLine / qty : Math.abs(Number(item.unit_price ?? 0)),
        price_basis: 'custom' as const,
        restock: true as const,
        tax_rate: normalizePosTaxRate(item.tax_rate),
      };
    });
}

export function isPosExchange(items: PosReturnSourceItem[]): boolean {
  return items.some(item => Number(item.qty ?? 0) < 0)
    && items.some(item => Number(item.qty ?? 0) > 0);
}

export function getPosStockQtyChange(
  qty: number,
  saleType: 'sale' | 'return' | 'layby',
): number | null {
  if (qty === 0) return null;
  if (saleType === 'return' && qty < 0) return null;
  return -qty;
}

export interface PosProfitabilityLine {
  qty: number;
  lineTotal: number;
  taxRate: number;
  unitCost: number | null;
}

export function calculatePosProfitability(lines: PosProfitabilityLine[]) {
  const calculated = lines.map(line => {
    const direction = Math.sign(Number(line.qty));
    const lineInc = direction * Math.abs(Number(line.lineTotal));
    const taxRate = Number(line.taxRate);
    const revenueEx = taxRate > 0 ? lineInc / (1 + taxRate / 100) : lineInc;
    const cogs = line.unitCost == null ? null : Number(line.qty) * Number(line.unitCost);
    return { revenueEx, cogs };
  });
  const revenueEx = calculated.reduce((sum, line) => sum + line.revenueEx, 0);
  const hasCompleteCosts = calculated.every(line => line.cogs != null);
  const totalCogs = hasCompleteCosts
    ? calculated.reduce((sum, line) => sum + Number(line.cogs), 0)
    : null;
  const grossProfit = totalCogs == null ? null : revenueEx - totalCogs;
  const marginPct = grossProfit != null && revenueEx > 0
    ? (grossProfit / revenueEx) * 100
    : null;
  return { revenueEx, totalCogs, grossProfit, marginPct };
}