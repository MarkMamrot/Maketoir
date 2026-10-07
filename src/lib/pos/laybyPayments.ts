export function canSaveLaybyDeposit(total: number, amounts: number[]): boolean {
  if (!Number.isFinite(total) || total <= 0 || amounts.length === 0) return false;
  if (amounts.some(amount => !Number.isFinite(amount) || amount <= 0)) return false;
  const paidCents = amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0);
  return paidCents > 0 && paidCents <= Math.round(total * 100);
}