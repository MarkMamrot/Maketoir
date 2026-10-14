import type { CompletedSale } from './_types';
import { addToOfflineQueue, reportPosSaleBrowserIssue } from './_store';

export function canCompleteSaleLocally(input: {
  training: boolean;
  layby: boolean;
  reward: boolean;
  linkedReturn: boolean;
  buildRequired: boolean;
  items: Array<{ qty: number; is_gift_card?: boolean }>;
  payments: Array<{ method: string }>;
}): boolean {
  return !input.training && !input.layby && !input.reward && !input.linkedReturn && !input.buildRequired
    && input.items.every(item => item.qty > 0 && !item.is_gift_card)
    && input.payments.every(payment => !/gift card|store credit/i.test(payment.method));
}

export function recordLocalSale(payload: Record<string, unknown>, receipt: CompletedSale): CompletedSale {
  const pending: CompletedSale = { ...receipt, sync_status: 'pending' };
  try {
    const entry = addToOfflineQueue(payload, pending);
    return entry.receipt ?? pending;
  } catch {
    reportPosSaleBrowserIssue('pos_sale_local_storage', receipt.local_id);
    return { ...pending, sync_status: 'storage_failed' };
  }
}
