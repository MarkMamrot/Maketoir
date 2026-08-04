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
