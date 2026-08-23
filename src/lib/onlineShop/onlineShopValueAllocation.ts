export interface OnlineShopValueAllocationInput {
  grossTotalCents: number;
  rewardValueCents: number;
  storeCreditBalanceCents: number;
  storeCreditReservedElsewhereCents: number;
  requestedStoreCreditCents: number;
}

export interface OnlineShopValueAllocation {
  loyaltyCents: number;
  storeCreditCents: number;
  payableCents: number;
  availableStoreCreditCents: number;
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
}

export function allocateOnlineShopValue(input: OnlineShopValueAllocationInput): OnlineShopValueAllocation {
  requireNonNegativeInteger(input.grossTotalCents, 'Gross total');
  requireNonNegativeInteger(input.rewardValueCents, 'Reward value');
  requireNonNegativeInteger(input.storeCreditBalanceCents, 'Store-credit balance');
  requireNonNegativeInteger(input.storeCreditReservedElsewhereCents, 'Reserved store credit');
  requireNonNegativeInteger(input.requestedStoreCreditCents, 'Requested store credit');

  if (input.rewardValueCents > input.grossTotalCents) {
    throw new Error('The selected reward value exceeds the checkout total.');
  }

  const availableStoreCreditCents = Math.max(
    0,
    input.storeCreditBalanceCents - input.storeCreditReservedElsewhereCents,
  );
  const remainingAfterRewardCents = input.grossTotalCents - input.rewardValueCents;
  const storeCreditCents = Math.min(
    input.requestedStoreCreditCents,
    availableStoreCreditCents,
    remainingAfterRewardCents,
  );

  return {
    loyaltyCents: input.rewardValueCents,
    storeCreditCents,
    payableCents: remainingAfterRewardCents - storeCreditCents,
    availableStoreCreditCents,
  };
}

export function allocateCentsProportionally(totalCents: number, weights: number[]): number[] {
  requireNonNegativeInteger(totalCents, 'Allocation total');
  weights.forEach(weight => requireNonNegativeInteger(weight, 'Allocation weight'));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalCents > totalWeight) throw new Error('Allocation total cannot exceed the combined weights.');
  if (!weights.length || totalCents === 0) return weights.map(() => 0);
  if (totalWeight === 0) throw new Error('A positive allocation requires a positive weight.');

  let remaining = totalCents;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const allocation = Math.min(weight, Math.round(totalCents * weight / totalWeight));
    remaining -= allocation;
    return allocation;
  });
}