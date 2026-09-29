export type PurchaseOrderCostVariant = {
  cost_aud?: number | string | null;
  cost_foreign?: string | null;
};

function usableCost(value: unknown): number | '' {
  if (value == null || value === '') return '';
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : '';
}

export function purchaseOrderCurrencyCost(
  variant: PurchaseOrderCostVariant | null | undefined,
  currencyCode: string,
): number | '' {
  if (!variant) return '';

  const currency = currencyCode.trim().toUpperCase() || 'AUD';
  if (currency === 'AUD') return usableCost(variant.cost_aud);

  try {
    const costs = JSON.parse(variant.cost_foreign ?? '{}');
    if (!costs || typeof costs !== 'object' || Array.isArray(costs)) return '';
    const matchingCode = Object.keys(costs).find(code => code.toUpperCase() === currency);
    return matchingCode ? usableCost(costs[matchingCode]) : '';
  } catch {
    return '';
  }
}