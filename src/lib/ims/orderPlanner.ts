const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReorderSuggestionInput {
  salesQuantity: number;
  salesWindowDays: number;
  createdDate?: string | null;
  supplierLeadTimeDays: number;
  orderFrequencyDays: number;
  availableQuantity: number;
  incomingQuantity: number;
  packSize: number;
  now?: number;
}

export interface ReorderSuggestion {
  daysInStock: number;
  effectiveSalesDays: number;
  averageDailySales: number;
  coverageDays: number;
  suggestedQuantity: number;
  reorderQuantity: number;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function calculateReorderSuggestion(input: ReorderSuggestionInput): ReorderSuggestion {
  const salesWindowDays = Math.max(1, Math.round(input.salesWindowDays));
  const leadTimeDays = Math.max(0, Math.round(input.supplierLeadTimeDays));
  const coverageDays = Math.max(1, Math.round(input.orderFrequencyDays)) + leadTimeDays;
  const createdAt = input.createdDate ? new Date(input.createdDate).getTime() : Number.NaN;
  const adjustedStart = Number.isFinite(createdAt) ? createdAt + leadTimeDays * DAY_MS : Number.NaN;
  const daysInStock = Number.isFinite(adjustedStart)
    ? Math.max(0, Math.floor(((input.now ?? Date.now()) - adjustedStart) / DAY_MS))
    : salesWindowDays;
  const effectiveSalesDays = Math.min(salesWindowDays, daysInStock || salesWindowDays);
  const averageDailySales = effectiveSalesDays > 0
    ? round(Math.max(0, input.salesQuantity) / effectiveSalesDays, 4)
    : 0;
  const suggestedQuantity = Math.max(0, Math.ceil(
    averageDailySales * coverageDays - input.availableQuantity - input.incomingQuantity,
  ));
  const packSize = Math.max(0, Math.round(input.packSize));
  const reorderQuantity = packSize > 0 && suggestedQuantity > 0
    ? Math.max(packSize, Math.round(suggestedQuantity / packSize) * packSize)
    : suggestedQuantity;

  return {
    daysInStock,
    effectiveSalesDays,
    averageDailySales,
    coverageDays,
    suggestedQuantity,
    reorderQuantity,
  };
}
