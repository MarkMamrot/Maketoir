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