export type CashVarianceDirection = 'short' | 'exact' | 'over';

function toCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Cash amount must be finite');
  return Math.round(value * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

export function classifyCashVariance(amount: number): CashVarianceDirection {
  const cents = toCents(amount);
  return cents < 0 ? 'short' : cents > 0 ? 'over' : 'exact';
}

export function calculateCashPosition(input: {
  expectedAmount: number;
  countedAmount: number;
  openingFloat: number;
  depositCounted?: number;
}) {
  const expectedCents = toCents(input.expectedAmount);
  const custodyCents = toCents(input.countedAmount) - toCents(input.openingFloat);
  const tillVarianceCents = custodyCents - expectedCents;
  const depositCents = input.depositCounted == null ? null : toCents(input.depositCounted);
  const bankingVarianceCents = depositCents == null ? null : depositCents - custodyCents;

  return {
    cashTenderExpected: fromCents(expectedCents),
    drawerCashAvailable: fromCents(custodyCents),
    tillVariance: fromCents(tillVarianceCents),
    tillVarianceDirection: classifyCashVariance(fromCents(tillVarianceCents)),
    depositCounted: depositCents == null ? null : fromCents(depositCents),
    bankingVariance: bankingVarianceCents == null ? null : fromCents(bankingVarianceCents),
    bankingVarianceDirection: bankingVarianceCents == null
      ? null
      : classifyCashVariance(fromCents(bankingVarianceCents)),
  };
}

export function splitExpectedCashTender(input: {
  expectedAmount: number;
  cashRounding: number;
}) {
  const expectedCents = toCents(input.expectedAmount);
  const roundingCents = toCents(input.cashRounding);
  return {
    salesAmount: fromCents(expectedCents - roundingCents),
    roundingAmount: fromCents(roundingCents),
    invoiceTotal: fromCents(expectedCents),
  };
}