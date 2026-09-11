export type ExchangeRateDirection = 'foreign_to_aud' | 'aud_to_foreign';

export function canonicalExchangeRate(displayRate: number, direction: ExchangeRateDirection): number {
  if (!Number.isFinite(displayRate) || displayRate <= 0) return 0;
  return direction === 'foreign_to_aud' ? displayRate : 1 / displayRate;
}

export function displayedExchangeRate(canonicalRate: number, direction: ExchangeRateDirection): number {
  if (!Number.isFinite(canonicalRate) || canonicalRate <= 0) return 0;
  return direction === 'foreign_to_aud' ? canonicalRate : 1 / canonicalRate;
}

export function exchangeRateFromPaymentAmounts(foreignAmount: number, audAmount: number): number {
  if (!Number.isFinite(foreignAmount) || foreignAmount <= 0 || !Number.isFinite(audAmount) || audAmount <= 0) return 0;
  return audAmount / foreignAmount;
}

export function audAmountFromPayment(foreignAmount: number, canonicalRate: number): number {
  if (!Number.isFinite(foreignAmount) || foreignAmount <= 0 || !Number.isFinite(canonicalRate) || canonicalRate <= 0) return 0;
  return foreignAmount * canonicalRate;
}