import { describe, expect, it, vi } from 'vitest';
import { executeZellerTransaction, getApprovedZellerPurchase } from '../zellerPurchaseResult';

describe('terminal transaction routing', () => {
  it('uses only the refund API for a card-present refund', async () => {
    const terminal = { purchase: vi.fn(), refund: vi.fn().mockResolvedValue({ status: 'APPROVED', transactionUuid: 'refund-1' }) };
    await executeZellerTransaction(terminal, { amount: 2600, isRefund: true, reference: 'layby-refund', sessionUuid: 'session-1' });
    expect(terminal.purchase).not.toHaveBeenCalled();
    expect(terminal.refund).toHaveBeenCalledWith({ amount: 2600, reference: 'layby-refund', cardPresent: true });
  });
  it('preserves the purchase API for ordinary payments', async () => {
    const terminal = { purchase: vi.fn().mockResolvedValue({}), refund: vi.fn() };
    await executeZellerTransaction(terminal, { amount: 2600, isRefund: false, reference: 'payment', sessionUuid: 'session-1' });
    expect(terminal.refund).not.toHaveBeenCalled();
    expect(terminal.purchase).toHaveBeenCalledWith({ amount: 2600, reference: 'payment', sessionUuid: 'session-1' });
  });
  it.each([0, -2600, NaN, 26.5])('rejects invalid cents %s without touching the terminal', amount => {
    const terminal = { purchase: vi.fn(), refund: vi.fn() };
    expect(() => executeZellerTransaction(terminal, { amount, isRefund: true, reference: 'refund', sessionUuid: 'session-1' })).toThrow();
    expect(terminal.purchase).not.toHaveBeenCalled();
    expect(terminal.refund).not.toHaveBeenCalled();
  });
});

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