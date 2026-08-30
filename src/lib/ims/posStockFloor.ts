const roundQuantity = (value: number) => Math.round(value * 10_000) / 10_000;

export type PosStockChangePlan = {
  requestedChange: number;
  uncappedResultingOnHand: number;
  automaticAdjustmentQuantity: number;
  afterAdjustmentOnHand: number;
  resultingOnHand: number;
};

export function planPosStockChange(currentOnHand: number, requestedChange: number, minimumOnHand = 0): PosStockChangePlan {
  const current = roundQuantity(currentOnHand);
  const change = roundQuantity(requestedChange);
  const minimum = Math.min(0, roundQuantity(minimumOnHand));
  const uncappedResultingOnHand = roundQuantity(current + change);
  const automaticAdjustmentQuantity = change < 0 && uncappedResultingOnHand < minimum
    ? roundQuantity(minimum - uncappedResultingOnHand)
    : 0;
  const afterAdjustmentOnHand = roundQuantity(current + automaticAdjustmentQuantity);

  return {
    requestedChange: change,
    uncappedResultingOnHand,
    automaticAdjustmentQuantity,
    afterAdjustmentOnHand,
    resultingOnHand: roundQuantity(afterAdjustmentOnHand + change),
  };
}