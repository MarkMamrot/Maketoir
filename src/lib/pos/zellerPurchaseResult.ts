export interface ApprovedZellerPurchase {
  status: 'APPROVED';
  transactionUuid: string;
}

export function getApprovedZellerPurchase(result: unknown): ApprovedZellerPurchase | null {
  if (!result || typeof result !== 'object') return null;

  const transaction = result as Record<string, unknown>;
  if (transaction.status !== 'APPROVED') return null;
  if (typeof transaction.transactionUuid !== 'string' || !transaction.transactionUuid.trim()) return null;

  return {
    status: 'APPROVED',
    transactionUuid: transaction.transactionUuid,
  };
}