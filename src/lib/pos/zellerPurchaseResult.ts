import type { TerminalClient } from '@zeller-public/payments-sdk-react';

export function executeZellerTransaction(terminal: Pick<TerminalClient, 'purchase' | 'refund'>, input: {
  amount: number; isRefund: boolean; reference: string; sessionUuid: string;
}) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('A positive transaction amount in cents is required.');
  return input.isRefund
    ? terminal.refund({ amount: input.amount, reference: input.reference, cardPresent: true })
    : terminal.purchase({ amount: input.amount, reference: input.reference, sessionUuid: input.sessionUuid });
}

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