import {
  DEFAULT_LOYALTY_SETTINGS,
  LOYALTY_SETTING_KEYS,
  type LoyaltyEarnInput,
  type LoyaltySettings,
} from '@/lib/loyalty/types';

function nonNegativeMoney(value: number | undefined): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return 0;
  return Math.round(Number(value) * 100);
}

export function calculateEligibleSpendCents(input: Omit<LoyaltyEarnInput, 'earnRate'>): number {
  const merchandise = nonNegativeMoney(input.merchandiseTotal);
  const exclusions = nonNegativeMoney(input.discountTotal)
    + nonNegativeMoney(input.giftCardProductTotal)
    + nonNegativeMoney(input.loyaltyDiscountTotal);
  return Math.max(0, merchandise - exclusions);
}

export function calculatePosEligibleSpend(input: {
  items: Array<{ lineTotal: number; discountAmount?: number; isGiftCard?: boolean }>;
  discountTotal: number;
}): number {
  const saleLines = input.items.filter(item => Number(item.lineTotal) > 0);
  const allLineCents = saleLines.reduce((sum, item) => sum + nonNegativeMoney(item.lineTotal), 0);
  const eligibleLineCents = saleLines
    .filter(item => !item.isGiftCard)
    .reduce((sum, item) => sum + nonNegativeMoney(item.lineTotal), 0);
  if (allLineCents === 0 || eligibleLineCents === 0) return 0;

  const itemDiscountCents = saleLines.reduce((sum, item) => sum + nonNegativeMoney(item.discountAmount), 0);
  const orderDiscountCents = Math.max(0, nonNegativeMoney(input.discountTotal) - itemDiscountCents);
  const eligibleOrderDiscountCents = Math.round(orderDiscountCents * eligibleLineCents / allLineCents);
  return Math.max(0, eligibleLineCents - eligibleOrderDiscountCents) / 100;
}

export function calculatePosReturnEligibleCents(input: {
  originalItems: Array<{
    id: number;
    qty: number;
    lineTotal: number;
    discountAmount?: number;
    isGiftCard?: boolean;
  }>;
  originalDiscountTotal: number;
  cumulativeReturnedQtyByItemId: Map<number, number>;
}): { originalEligibleCents: number; cumulativeReturnedCents: number } {
  const saleLines = input.originalItems.filter(item => Number(item.qty) > 0 && Number(item.lineTotal) > 0);
  const allLineCents = saleLines.reduce((sum, item) => sum + nonNegativeMoney(item.lineTotal), 0);
  const eligibleLines = saleLines.filter(item => !item.isGiftCard);
  const eligibleLineCents = eligibleLines.reduce((sum, item) => sum + nonNegativeMoney(item.lineTotal), 0);
  if (allLineCents === 0 || eligibleLineCents === 0) return { originalEligibleCents: 0, cumulativeReturnedCents: 0 };

  const itemDiscountCents = saleLines.reduce((sum, item) => sum + nonNegativeMoney(item.discountAmount), 0);
  const orderDiscountCents = Math.max(0, nonNegativeMoney(input.originalDiscountTotal) - itemDiscountCents);
  const eligibleOrderDiscountCents = Math.round(orderDiscountCents * eligibleLineCents / allLineCents);
  const originalEligibleCents = Math.max(0, eligibleLineCents - eligibleOrderDiscountCents);

  const returnedEligibleLineCents = eligibleLines.reduce((sum, item) => {
    const originalQty = Number(item.qty);
    const returnedQty = Math.min(originalQty, Math.max(0, Number(input.cumulativeReturnedQtyByItemId.get(item.id) ?? 0)));
    return sum + Math.round(nonNegativeMoney(item.lineTotal) * returnedQty / originalQty);
  }, 0);
  const cumulativeReturnedCents = Math.min(
    originalEligibleCents,
    Math.round(returnedEligibleLineCents * originalEligibleCents / eligibleLineCents),
  );
  return { originalEligibleCents, cumulativeReturnedCents };
}

export function calculateEarnedPoints(input: LoyaltyEarnInput): number {
  if (!Number.isFinite(input.earnRate) || input.earnRate <= 0) return 0;
  const eligibleSpendCents = calculateEligibleSpendCents(input);
  return Math.floor((eligibleSpendCents * input.earnRate) / 100);
}

export function calculateReversalPoints(originalEarned: number, alreadyReversed: number, requested: number): number {
  const original = Math.max(0, Math.floor(Number(originalEarned) || 0));
  const reversed = Math.max(0, Math.floor(Number(alreadyReversed) || 0));
  const requestedPoints = Math.max(0, Math.floor(Number(requested) || 0));
  return Math.min(requestedPoints, Math.max(0, original - reversed));
}

export function calculateProportionalReturnReversal(input: {
  originalEarned: number;
  originalEligibleCents: number;
  cumulativeReturnedCents: number;
  alreadyReversed: number;
}): number {
  const originalEarned = Math.max(0, Math.floor(Number(input.originalEarned) || 0));
  const originalEligibleCents = Math.max(0, Math.floor(Number(input.originalEligibleCents) || 0));
  const cumulativeReturnedCents = Math.max(0, Math.floor(Number(input.cumulativeReturnedCents) || 0));
  const alreadyReversed = Math.max(0, Math.floor(Number(input.alreadyReversed) || 0));
  if (originalEarned === 0 || originalEligibleCents === 0) return 0;

  const cappedReturnedCents = Math.min(cumulativeReturnedCents, originalEligibleCents);
  const cumulativeTarget = Math.floor(originalEarned * cappedReturnedCents / originalEligibleCents);
  return Math.max(0, Math.min(originalEarned - alreadyReversed, cumulativeTarget - alreadyReversed));
}

export function canClaimReward(balancePoints: number, pointsCost: number): boolean {
  return Number.isInteger(balancePoints)
    && Number.isInteger(pointsCost)
    && pointsCost > 0
    && balancePoints >= pointsCost;
}

export function parseLoyaltySettings(settings: Record<string, string | null | undefined>): LoyaltySettings {
  const earnRate = Number(settings[LOYALTY_SETTING_KEYS.earnRate]);
  const startedAt = String(settings[LOYALTY_SETTING_KEYS.startedAt] ?? '').trim();
  return {
    enabled: settings[LOYALTY_SETTING_KEYS.enabled] === '1',
    earnRate: Number.isFinite(earnRate) && earnRate > 0 ? earnRate : DEFAULT_LOYALTY_SETTINGS.earnRate,
    programName: String(settings[LOYALTY_SETTING_KEYS.programName] ?? '').trim() || DEFAULT_LOYALTY_SETTINGS.programName,
    pointsLabel: String(settings[LOYALTY_SETTING_KEYS.pointsLabel] ?? '').trim() || DEFAULT_LOYALTY_SETTINGS.pointsLabel,
    startedAt: startedAt || null,
  };
}
