import { describe, expect, it, vi } from 'vitest';
import { executeCashDeposit } from '../cashDepositExecutor';

function dependencies(actions: any[], failVariance = false) {
  const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
  const xeroFetch = vi.fn(async (_businessId: string, path: string) => {
    if (path === '/BankTransactions') {
      if (failVariance) throw new Error('variance failed');
      return { BankTransactions: [{ BankTransactionID: 'variance-1' }] };
    }
    return { BankTransfers: [{ BankTransferID: 'transfer-1' }] };
  });
  const query = vi.fn(async (sql: string) => sql.includes('FROM xero_cash_deposits') ? [{
    id: 7, lodgement_date: '2026-07-27', bank_reference: 'LOD-9', source_account_code: 'CASH',
    over_short_account_code: '898', destination_account_code: 'BANK', confirmation_status: 'confirmed', status: 'draft',
  }] : actions);
  return { query: query as any, execute: execute as any, xeroFetch: xeroFetch as any };
}

describe('executeCashDeposit', () => {
  it('completes a zero-value transfer locally without calling Xero', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('FROM xero_cash_deposits') ? [{
      id: 7, lodgement_date: '2026-07-30', bank_reference: null,
      source_account_code: '1111111111', over_short_account_code: '41006',
      destination_account_code: '11110', confirmation_status: 'confirmed', status: 'draft',
    }] : [{
      id: 2, action_key: '7:bank_transfer', action_type: 'bank_transfer', business_date: null,
      amount: 0, status: 'pending', idempotency_key: 'transfer-key',
    }]);
    const execute = vi.fn(async () => ({ affectedRows: 1 }));
    const xeroFetch = vi.fn();

    const result = await executeCashDeposit('biz-1', 7, { userId: 1, name: 'Admin' }, { query, execute, xeroFetch });

    expect(result).toEqual({ status: 'posted' });
    expect(xeroFetch).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      ['biz-1', 2],
    );
  });

  it('posts daily variance before transferring counted cash', async () => {
    const deps = dependencies([
      { id: 1, action_key: '7:variance:2026-07-25', action_type: 'variance', business_date: '2026-07-25', amount: -2, status: 'pending', idempotency_key: 'variance-key' },
      { id: 2, action_key: '7:bank_transfer', action_type: 'bank_transfer', business_date: null, amount: 98, status: 'pending', idempotency_key: 'transfer-key' },
    ]);
    const result = await executeCashDeposit('biz-1', 7, { userId: 4, name: 'Admin' }, deps);
    expect(result.status).toBe('posted');
    expect(deps.xeroFetch.mock.calls.map(call => call[1])).toEqual(['/BankTransactions', '/BankTransfers']);
    expect(deps.xeroFetch.mock.calls[0][2]).toMatchObject({
      idempotencyKey: 'variance-key',
      body: { BankTransactions: [{ Type: 'SPEND', BankAccount: { Code: 'CASH' }, LineItems: [{ UnitAmount: 2, AccountCode: '898', TaxType: 'NONE' }] }] },
    });
    expect(deps.xeroFetch.mock.calls[1][2]).toMatchObject({
      idempotencyKey: 'transfer-key',
      body: { BankTransfers: [{ FromBankAccount: { Code: 'CASH' }, ToBankAccount: { Code: 'BANK' }, Amount: 98, Reference: 'LOD-9' }] },
    });
  });

  it('posts preparation and bank acceptance variances with distinct references before transfer', async () => {
    const deps = dependencies([
      { id: 1, action_type: 'preparation_variance', business_date: '2026-07-25', amount: -2, status: 'pending', idempotency_key: 'prep-key' },
      { id: 2, action_type: 'bank_acceptance_variance', business_date: '2026-07-27', amount: -1, status: 'pending', idempotency_key: 'bank-key' },
      { id: 3, action_type: 'bank_transfer', amount: 97, status: 'pending', idempotency_key: 'transfer-key' },
    ]);

    await executeCashDeposit('biz-1', 7, { userId: 4, name: 'Admin' }, deps);

    expect(deps.xeroFetch.mock.calls.map(call => call[1])).toEqual(['/BankTransactions', '/BankTransactions', '/BankTransfers']);
    expect(deps.xeroFetch.mock.calls[0][2].body.BankTransactions[0]).toMatchObject({
      Reference: 'Cash preparation variance #7',
      LineItems: [{ Description: 'cash preparation shortage 2026-07-25' }],
    });
    expect(deps.xeroFetch.mock.calls[1][2].body.BankTransactions[0]).toMatchObject({
      Reference: 'Bank acceptance variance #7',
      LineItems: [{ Description: 'bank acceptance shortage 2026-07-27' }],
    });
  });

  it('refuses to post a planned deposit before bank confirmation', async () => {
    const deps = dependencies([]);
    deps.query.mockResolvedValueOnce([{
      id: 7, lodgement_date: null, bank_reference: null, source_account_code: 'CASH',
      over_short_account_code: '898', destination_account_code: null,
      confirmation_status: 'planned', status: 'draft',
    }]);

    await expect(executeCashDeposit('biz-1', 7, { userId: 4, name: 'Admin' }, deps)).rejects.toThrow('must be confirmed');
    expect(deps.xeroFetch).not.toHaveBeenCalled();
  });

  it('skips completed actions when retrying', async () => {
    const deps = dependencies([
      { id: 1, action_type: 'variance', amount: 2, status: 'completed', idempotency_key: 'variance-key' },
      { id: 2, action_type: 'bank_transfer', amount: 102, status: 'error', idempotency_key: 'transfer-key' },
    ]);
    await executeCashDeposit('biz-1', 7, { userId: 4, name: 'Admin' }, deps);
    expect(deps.xeroFetch.mock.calls.map(call => call[1])).toEqual(['/BankTransfers']);
  });

  it('does not transfer cash when a variance action fails', async () => {
    const deps = dependencies([
      { id: 1, action_type: 'variance', business_date: '2026-07-25', amount: 2, status: 'pending', idempotency_key: 'variance-key' },
      { id: 2, action_type: 'bank_transfer', amount: 102, status: 'pending', idempotency_key: 'transfer-key' },
    ], true);
    const result = await executeCashDeposit('biz-1', 7, { userId: 4, name: 'Admin' }, deps);
    expect(result.status).toBe('partial');
    expect(deps.xeroFetch.mock.calls.map(call => call[1])).toEqual(['/BankTransactions']);
  });

  it('refuses a concurrent posting claim', async () => {
    const deps = dependencies([]);
    deps.execute.mockResolvedValueOnce({ affectedRows: 0 } as any);
    await expect(executeCashDeposit('biz-1', 7, { userId: 4, name: 'Admin' }, deps)).rejects.toThrow('already being posted');
    expect(deps.xeroFetch).not.toHaveBeenCalled();
  });
});