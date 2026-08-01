import { describe, expect, it } from 'vitest';
import { getApprovedZellerPurchase } from '../zellerPurchaseResult';

describe('getApprovedZellerPurchase', () => {
  it('accepts an explicitly approved transaction', () => {
    expect(getApprovedZellerPurchase({
      $type: 'Approved',
      status: 'APPROVED',
      transactionUuid: 'txn-approved',
    })).toEqual({ status: 'APPROVED', transactionUuid: 'txn-approved' });
  });

  it.each([
    { $type: 'Declined', status: 'DECLINED', transactionUuid: 'txn-declined' },
    { $type: 'Declined', status: 'FAILED', transactionUuid: 'txn-failed' },
    { $type: 'Approved', status: 'APPROVED', transactionUuid: '' },
    new Error('Transaction Declined'),
    null,
  ])('rejects a non-approved purchase result: %p', (result) => {
    expect(getApprovedZellerPurchase(result)).toBeNull();
  });
});