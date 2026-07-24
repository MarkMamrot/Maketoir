export type TaxTreatment = 'ex_tax' | 'inc_tax' | 'no_tax';

export interface AvgCostDistributionItem {
  key: string;
  qtyOrdered: number;
  unitCost: number;
  taxRate?: number | null;
}

export function normalizeExchangeRate(rate: number | null | undefined): number {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function toTaxExclusiveUnitCost(unitCost: number, taxRate: number | null | undefined, taxTreatment: TaxTreatment): number {
  const raw = Number(unitCost);
  const rate = Number(taxRate ?? 0);
  if (!Number.isFinite(raw)) return 0;
  if (taxTreatment === 'inc_tax' && rate > 0) {
    return raw / (1 + rate);
  }
  return raw;
}

export function computeLandedCostPerUnit(
  items: AvgCostDistributionItem[],
  params: {
    exchangeRate?: number | null;
    taxTreatment: TaxTreatment;
    totalLandedAud: number;
    totalFreightAud?: number;
    includeLandedCosts?: boolean;
    includeFreight?: boolean;
  },
): Map<string, number> {
  const exchangeRate = normalizeExchangeRate(params.exchangeRate);
  const includeLanded = params.includeLandedCosts !== false;
  const includeFreight = params.includeFreight === true;

  const totalLanded = includeLanded ? Number(params.totalLandedAud || 0) : 0;
  const totalFreight = includeFreight ? Number(params.totalFreightAud || 0) : 0;
  const distributableAud = Math.max(0, totalLanded + totalFreight);

  const perUnit = new Map<string, number>();
  if (distributableAud <= 0 || items.length === 0) {
    for (const item of items) perUnit.set(item.key, 0);
    return perUnit;
  }

  let subtotalAud = 0;
  let totalQty = 0;
  const bases = items.map((item) => {
    const qty = Math.max(0, Number(item.qtyOrdered || 0));
    const unitExTax = toTaxExclusiveUnitCost(Number(item.unitCost || 0), item.taxRate, params.taxTreatment);
    const lineAud = unitExTax * exchangeRate * qty;
    subtotalAud += lineAud;
    totalQty += qty;
    return { key: item.key, qty, lineAud };
  });

  for (const b of bases) {
    if (b.qty <= 0) {
      perUnit.set(b.key, 0);
      continue;
    }

    if (subtotalAud > 0) {
      perUnit.set(b.key, (distributableAud * (b.lineAud / subtotalAud)) / b.qty);
    } else {
      perUnit.set(b.key, totalQty > 0 ? distributableAud / totalQty : 0);
    }
  }

  return perUnit;
}

export function computeReceivedUnitCostAud(params: {
  unitCost: number;
  taxRate?: number | null;
  taxTreatment: TaxTreatment;
  exchangeRate?: number | null;
  landedCostPerUnitAud?: number;
}): number {
  const exchangeRate = normalizeExchangeRate(params.exchangeRate);
  const exTaxUnit = toTaxExclusiveUnitCost(params.unitCost, params.taxRate, params.taxTreatment);
  const landed = Number(params.landedCostPerUnitAud || 0);
  const cost = exTaxUnit * exchangeRate + landed;
  return Number.isFinite(cost) ? cost : 0;
}

export function computeWeightedAverageCost(params: {
  oldQtyOnHand: number;
  oldAvgCost: number;
  receivedQty: number;
  receivedUnitCostAud: number;
}): number {
  const oldQty = Math.max(0, Number(params.oldQtyOnHand || 0));
  const oldAvg = Number.isFinite(Number(params.oldAvgCost)) ? Number(params.oldAvgCost) : 0;
  const qty = Math.max(0, Number(params.receivedQty || 0));
  const unit = Number.isFinite(Number(params.receivedUnitCostAud)) ? Number(params.receivedUnitCostAud) : 0;

  if (qty <= 0) return oldAvg;
  if (oldQty <= 0) return unit;

  const denom = oldQty + qty;
  if (denom <= 0) return unit;
  return (oldAvg * oldQty + unit * qty) / denom;
}

export function computeMovementCogs(qtyChange: number, unitCost: number): number {
  const qty = Math.abs(Number(qtyChange || 0));
  const cost = Number(unitCost || 0);
  const cogs = qty * cost;
  return Number.isFinite(cogs) ? cogs : 0;
}
