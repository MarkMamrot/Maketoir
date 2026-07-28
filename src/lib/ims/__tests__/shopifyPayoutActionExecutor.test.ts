import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeShopifyPayoutActions,
  type ShopifyPayoutExecutorDependencies,
} from '../shopifyPayoutActionExecutor';

function dependencies(): ShopifyPayoutExecutorDependencies & {
  mainQuery: ReturnType<typeof vi.fn>;
  mainExecute: ReturnType<typeof vi.fn>;
  xeroFetch: ReturnType<typeof vi.fn>;
} {
  return {
    mainQuery: vi.fn(),
    mainExecute: vi.fn().mockResolvedValue({ affectedRows: 1 }),
    xeroFetch: vi.fn(),
  };
}

const invoiceAction = {
  id: 1,
  action_key: 'payout:pay-1:invoice:inv-1',
  action_type: 'invoice_payment',
  target_xero_document_id: 'inv-1',
  action_date: '2026-07-27',
  amount: 100,
  currency: 'AUD',
  account_code: '091',
  offset_account_code: null,
  tax_type: null,
  reference: 'Shopify payout pay-1',
  status: 'pending',
  xero_id: null,
};

const feeAction = {
  id: 2,
  action_key: 'payout:pay-1:fees',
  action_type: 'fee_spend',
  target_xero_document_id: null,
  action_date: '2026-07-27',
  amount: 2,
  currency: 'AUD',
  account_code: '091',
  offset_account_code: '404',
  tax_type: 'INPUT',
  reference: 'Shopify fees payout pay-1',
  status: 'pending',
  xero_id: null,
};

describe('executeShopifyPayoutActions', () => {
  let deps: ReturnType<typeof dependencies>;

  beforeEach(() => {
    deps = dependencies();
    deps.mainQuery.mockResolvedValue([invoiceAction, feeAction]);
    deps.xeroFetch.mockImplementation(async (_businessId: string, path: string, options?: any) => {
      if (path.startsWith('/Accounts?where=')) {
        return { Accounts: [{ Code: '091', Type: 'BANK', EnablePaymentsToAccount: true, Name: 'Shopify Clearing' }] };
      }
      if (path === '/Invoices/inv-1') return { Invoices: [{ InvoiceID: 'inv-1', AmountDue: 100 }] };
      if (path === '/Payments') return { Payments: [{ PaymentID: 'payment-1' }] };
      if (path === '/BankTransactions') return { BankTransactions: [{ BankTransactionID: 'bank-1' }] };
      throw new Error(`Unexpected Xero path ${path} ${JSON.stringify(options)}`);
    });
  });

  it('preflights all documents then posts actions with stable idempotency keys', async () => {
    const result = await executeShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(result).toEqual({ status: 'reconciled', completedActionIds: [1, 2] });
    expect(deps.xeroFetch.mock.calls.map(([, path]) => path)).toEqual([
      expect.stringContaining('/Accounts?where='),
      '/Invoices/inv-1',
      '/Payments',
      '/BankTransactions',
    ]);
    const paymentOptions = deps.xeroFetch.mock.calls[2][2];
    const bankOptions = deps.xeroFetch.mock.calls[3][2];
    expect(paymentOptions.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(bankOptions.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(bankOptions.body.BankTransactions[0]).toMatchObject({
      Type: 'SPEND',
      LineAmountTypes: 'Inclusive',
      BankAccount: { Code: '091' },
    });
  });

  it('blocks every post when a planned payment exceeds live AmountDue', async () => {
    deps.xeroFetch.mockImplementation(async (_businessId: string, path: string) => {
      if (path.startsWith('/Accounts?where=')) {
        return { Accounts: [{ Code: '091', Type: 'BANK', EnablePaymentsToAccount: true, Name: 'Shopify Clearing' }] };
      }
      if (path === '/Invoices/inv-1') return { Invoices: [{ InvoiceID: 'inv-1', AmountDue: 90 }] };
      throw new Error(`Unexpected Xero path ${path}`);
    });

    const result = await executeShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(result).toMatchObject({ status: 'blocked', completedActionIds: [] });
    expect(result.error).toContain('below planned payment 100.00');
    expect(deps.xeroFetch).toHaveBeenCalledTimes(2);
    expect(deps.mainExecute.mock.calls.some(([sql]) => String(sql).includes("status = 'posting'"))).toBe(false);
  });

  it('retries only unfinished actions', async () => {
    deps.mainQuery.mockResolvedValue([{ ...invoiceAction, status: 'completed', xero_id: 'payment-1' }, feeAction]);

    const result = await executeShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(result).toEqual({ status: 'reconciled', completedActionIds: [1, 2] });
    expect(deps.xeroFetch.mock.calls.map(([, path]) => path)).toEqual([
      expect.stringContaining('/Accounts?where='),
      '/BankTransactions',
    ]);
  });

  it('blocks aggregate refunds that exceed one credit note remaining balance', async () => {
    const refundAction = {
      ...invoiceAction,
      action_type: 'credit_note_refund',
      target_xero_document_id: 'cn-1',
      account_code: '091',
      amount: 60,
    };
    deps.mainQuery.mockResolvedValue([
      { ...refundAction, id: 3, action_key: 'refund-1' },
      { ...refundAction, id: 4, action_key: 'refund-2' },
    ]);
    deps.xeroFetch.mockImplementation(async (_businessId: string, path: string) => {
      if (path.startsWith('/Accounts?where=')) {
        return { Accounts: [{ Code: '091', Type: 'BANK', EnablePaymentsToAccount: true, Name: 'Shopify Clearing' }] };
      }
      if (path === '/CreditNotes/cn-1') return { CreditNotes: [{ CreditNoteID: 'cn-1', RemainingCredit: 100 }] };
      throw new Error(`Unexpected Xero path ${path}`);
    });

    const result = await executeShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(result).toMatchObject({ status: 'blocked' });
    expect(result.error).toContain('below planned refund 120.00');
    expect(deps.xeroFetch).toHaveBeenCalledTimes(2);
  });

  it('posts fee reversals as clearing receives', async () => {
    deps.mainQuery.mockResolvedValue([{ ...feeAction, action_type: 'fee_receive' }]);

    await executeShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(deps.xeroFetch.mock.calls[1][2].body.BankTransactions[0].Type).toBe('RECEIVE');
  });

  it('blocks when clearing account cannot accept payments', async () => {
    deps.xeroFetch.mockImplementation(async (_businessId: string, path: string, _options?: any) => {
      if (path.startsWith('/Accounts?where=')) {
        return { Accounts: [{ Code: '091', Type: 'CURRENT', EnablePaymentsToAccount: false, Name: 'Shopify Clearing Asset' }] };
      }
      throw new Error(`Unexpected Xero path ${path}`);
    });

    const result = await executeShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(result.status).toBe('blocked');
    expect(result.error).toContain('cannot accept payments');
    expect(deps.mainExecute.mock.calls.some(([sql]) => String(sql).includes("status = 'posting'"))).toBe(false);
  });
});