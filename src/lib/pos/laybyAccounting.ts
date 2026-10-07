import { laybyCents, LaybyValidationError } from './laybyPayments';

export type LaybyJournalLine = { role: 'liability' | 'revenue'; amount: number; taxType: 'NONE' | 'OUTPUT' };

export function planLaybyJournal(kind: string, amount: number): LaybyJournalLine[] {
  const cents = laybyCents(amount);
  if (cents <= 0) throw new LaybyValidationError('The accounting amount must be positive.');
  const value = cents / 100;
  if (kind === 'gst' || kind === 'gst_reversal') {
    const direction = kind === 'gst' ? 1 : -1;
    return [
      { role: 'liability', amount: value * direction, taxType: 'NONE' },
      { role: 'liability', amount: -value * direction, taxType: 'OUTPUT' },
    ];
  }
  if (kind === 'collection' || kind === 'cancellation_fee') {
    return [
      { role: 'liability', amount: value, taxType: 'NONE' },
      { role: 'revenue', amount: -value, taxType: kind === 'cancellation_fee' ? 'OUTPUT' : 'NONE' },
    ];
  }
  throw new LaybyValidationError('Unsupported layby accounting event.');
}

export function splitLaybyEod(counted: number, laybyReceipts: number) {
  const total = laybyCents(counted);
  const liability = laybyCents(laybyReceipts);
  return { revenue: (total - liability) / 100, liability: liability / 100, total: total / 100 };
}