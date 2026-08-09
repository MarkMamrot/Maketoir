import { describe, expect, it, vi } from 'vitest';

import { claimXeroAccountingAction } from '../accountingActionRepository';

function row(status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown') {
  return {
    id: 7,
    business_id: 'biz-1',
    operation_key: 'po-payment:42:9',
    action_type: 'po_payment',
    source_type: 'purchase_order_payment',
    source_id: '9',
    request_fingerprint: 'a'.repeat(64),
    status,
    xero_id: status === 'succeeded' ? 'payment-1' : null,
    safe_error: null,
    attempt_count: 1,
  };
}

describe('claimXeroAccountingAction', () => {
  it('claims a pending action atomically', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([row('pending')])
      .mockResolvedValueOnce([row('running')]);
    const execute = vi.fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const result = await claimXeroAccountingAction({
      businessId: 'biz-1', operationKey: 'po-payment:42:9', actionType: 'po_payment',
      sourceType: 'purchase_order_payment', sourceId: 9, requestFingerprint: 'a'.repeat(64),
    }, { query: query as any, execute: execute as any });

    expect(result.claimed).toBe(true);
    expect(result.action.status).toBe('running');
    expect(String(execute.mock.calls[1][0])).toContain("status IN ('pending', 'failed')");
  });

  it.each(['succeeded', 'unknown'] as const)('does not reclaim a %s action', async status => {
    const query = vi.fn().mockResolvedValue([row(status)]);
    const execute = vi.fn()
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce({ affectedRows: 0 });

    const result = await claimXeroAccountingAction({
      businessId: 'biz-1', operationKey: 'po-payment:42:9', actionType: 'po_payment',
      sourceType: 'purchase_order_payment', sourceId: 9, requestFingerprint: 'a'.repeat(64),
    }, { query: query as any, execute: execute as any });

    expect(result.claimed).toBe(false);
    expect(result.action.status).toBe(status);
  });

  it('rejects a replay whose payload differs from the original action', async () => {
    const query = vi.fn().mockResolvedValue([{ ...row('failed'), request_fingerprint: 'b'.repeat(64) }]);
    const execute = vi.fn().mockResolvedValue({ affectedRows: 0 });

    await expect(claimXeroAccountingAction({
      businessId: 'biz-1', operationKey: 'po-payment:42:9', actionType: 'po_payment',
      sourceType: 'purchase_order_payment', sourceId: 9, requestFingerprint: 'a'.repeat(64),
    }, { query: query as any, execute: execute as any })).rejects.toThrow('does not match');
  });
});