export function canSaveLaybyDeposit(total: number, amounts: number[]): boolean {
  if (!Number.isFinite(total) || total <= 0 || amounts.length === 0) return false;
  if (amounts.some(amount => !Number.isFinite(amount) || amount <= 0)) return false;
  const paidCents = amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0);
  return paidCents > 0 && paidCents <= Math.round(total * 100);
}

export class LaybyValidationError extends Error {
  status = 409;
}

export function laybyCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new LaybyValidationError('Enter a valid amount.');
  return Math.round(amount * 100);
}

export function planLaybyPayment(input: { total: number; paid: number; amount: number; collect: boolean }) {
  const total = laybyCents(input.total);
  const paid = laybyCents(input.paid);
  const amount = laybyCents(input.amount);
  if (total <= 0 || paid < 0 || paid > total || amount <= 0 || amount > total - paid) {
    throw new LaybyValidationError('The payment must be positive and cannot exceed the balance owing.');
  }
  const fullyPaid = paid + amount === total;
  if (input.collect && !fullyPaid) throw new LaybyValidationError('Pay the full balance before collecting the goods.');
  return { paid: (paid + amount) / 100, balance: (total - paid - amount) / 100, fullyPaid, collect: fullyPaid && input.collect };
}

export function planLaybyCancellation(input: { total: number; paid: number; feePercent: number; overrideFee?: number; reason?: string }) {
  const total = laybyCents(input.total);
  const paid = laybyCents(input.paid);
  if (total <= 0 || paid < 0 || paid > total || !Number.isFinite(input.feePercent) || input.feePercent < 0 || input.feePercent > 100) {
    throw new LaybyValidationError('The cancellation amounts or fee percentage are invalid.');
  }
  const defaultFee = Math.min(paid, Math.round(total * input.feePercent / 100));
  const fee = input.overrideFee == null ? defaultFee : laybyCents(input.overrideFee);
  if (fee < 0 || fee > paid) throw new LaybyValidationError('The retained fee cannot exceed payments received.');
  if (fee !== defaultFee && !input.reason?.trim()) throw new LaybyValidationError('Enter a reason for overriding the cancellation fee.');
  return { fee: fee / 100, refund: (paid - fee) / 100, defaultFee: defaultFee / 100, overridden: fee !== defaultFee };
}

export function laybyFeePercent(settings: string | null | undefined): number {
  if (!settings) return 0;
  try {
    const value = Number(JSON.parse(settings).laybyCancellationFeePercent ?? 0);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
  } catch { return 0; }
}