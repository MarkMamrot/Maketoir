export type StockAllocationCandidate = {
  poItemId: number;
  poId: number;
  poNumber: string;
  expectedDate: string | null;
  freeQuantity: number;
};

export type StockAllocationDemandLine = {
  soItemId: number;
  unsourced: number;
  candidates: StockAllocationCandidate[];
};

export function getFifoAllocationDraft(
  lines: StockAllocationDemandLine[],
  soItemId: number,
): { candidate: StockAllocationCandidate; maxQuantity: number } | null {
  const line = lines.find(entry => Number(entry.soItemId) === Number(soItemId));
  const candidate = line?.candidates.find(entry => Number(entry.freeQuantity) > 0);
  if (!line || !candidate) return null;
  const maxQuantity = Math.min(Number(line.unsourced) || 0, Number(candidate.freeQuantity) || 0);
  return maxQuantity > 0 ? { candidate, maxQuantity } : null;
}