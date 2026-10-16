import { parseOpeningFloat } from './registerFloatCorrection';

export function parseClosingAmount(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const negative = text.startsWith('-');
  const amount = parseOpeningFloat(negative ? text.slice(1) : text);
  return amount == null ? null : negative ? -amount : amount;
}

export function closingVariance(counted: number | null, expected: number | null, float: number): number | null {
  return counted == null ? null : Math.round((counted - float - (expected ?? 0)) * 100) / 100;
}
