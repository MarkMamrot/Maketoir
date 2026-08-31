export function visiblePosPaymentTotals(payments: Record<string, unknown>): Array<[string, number]> {
  return Object.entries(payments).flatMap(([method, rawTotal]) => {
    const total = Number(rawTotal);
    return Number.isFinite(total) && Math.round(total * 100) !== 0 ? [[method, total]] : [];
  });
}