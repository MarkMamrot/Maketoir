import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  planShopifyPayoutActions,
  type ShopifyPayoutPlannerDependencies,
} from '../shopifyPayoutActionPlanner';

function createDependencies(): ShopifyPayoutPlannerDependencies & {
  mainQuery: ReturnType<typeof vi.fn>;
  mainExecute: ReturnType<typeof vi.fn>;
  tenantQuery: ReturnType<typeof vi.fn>;
} {
  return {
    mainQuery: vi.fn(),
    mainExecute: vi.fn().mockResolvedValue({ affectedRows: 1 }),
    tenantQuery: vi.fn(),
  };
}

function setupPaidPayout(deps: ReturnType<typeof createDependencies>) {
  deps.mainQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM shopify_payment_payouts')) {
      return [{ shopify_payout_id: 'pay-1', payout_date: '2026-07-27', shopify_status: 'paid', currency: 'AUD', payout_amount: 147 }];
    }
    if (sql.includes('FROM shopify_payment_payout_transactions')) {
      return [
        { shopify_transaction_id: 'sat', transaction_type: 'charge', amount: 100, fee: -2, net: 98, currency: 'AUD', source_order_id: 'order-sat' },
        { shopify_transaction_id: 'sun', transaction_type: 'charge', amount: 50, fee: -1, net: 49, currency: 'AUD', source_order_id: 'order-sun' },
      ];
    }
    if (sql.includes('FROM xero_online_batches')) {
      return [
        { batch_date: '2026-07-25', xero_invoice_id: 'inv-sat', payout_managed: 1 },
        { batch_date: '2026-07-26', xero_invoice_id: 'inv-sun', payout_managed: 1 },
      ];
    }
    if (sql.includes('FROM xero_gateway_mappings')) {
      return [{ gateway_name: 'shopify_payments', clearing_account_code: '091', fee_account_code: '404', fee_tax_type: 'INPUT' }];
    }
    throw new Error(`Unhandled main query: ${sql}`);
  });
  deps.tenantQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM ims_sales_orders')) {
      return [
        { id: 1, shopify_order_id: 'order-sat', order_date: '2026-07-25' },
        { id: 2, shopify_order_id: 'order-sun', order_date: '2026-07-26' },
      ];
    }
    if (sql.includes('FROM ims_credit_notes')) return [];
    throw new Error(`Unhandled tenant query: ${sql}`);
  });
}

describe('planShopifyPayoutActions', () => {
  let deps: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    deps = createDependencies();
    setupPaidPayout(deps);
  });

  it('plans gross payments across actual daily invoices plus one fee spend', async () => {
    const result = await planShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(result.status).toBe('planned');
    expect(result.actions).toEqual([
      expect.objectContaining({ actionType: 'invoice_payment', targetXeroDocumentId: 'inv-sat', amount: 100, accountCode: '091' }),
      expect.objectContaining({ actionType: 'invoice_payment', targetXeroDocumentId: 'inv-sun', amount: 50, accountCode: '091' }),
      expect.objectContaining({ actionType: 'fee_spend', amount: 3, offsetAccountCode: '404', taxType: 'INPUT' }),
    ]);
    const inserts = deps.mainExecute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO shopify_payment_xero_actions'));
    expect(inserts).toHaveLength(3);
    expect(deps.mainExecute.mock.calls.at(-1)?.[0]).toContain("reconciliation_status = 'planned'");
  });

  it('blocks a charge whose daily invoice is legacy rather than payout-managed', async () => {
    deps.mainQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM shopify_payment_payouts')) {
        return [{ shopify_payout_id: 'pay-1', payout_date: '2026-07-27', shopify_status: 'paid', currency: 'AUD', payout_amount: 98 }];
      }
      if (sql.includes('FROM shopify_payment_payout_transactions')) {
        return [{ shopify_transaction_id: 'sat', transaction_type: 'charge', amount: 100, fee: -2, net: 98, currency: 'AUD', source_order_id: 'order-sat' }];
      }
      if (sql.includes('FROM xero_online_batches')) {
        return [{ batch_date: '2026-07-25', xero_invoice_id: 'legacy-inv', payout_managed: 0 }];
      }
      throw new Error(`Unhandled main query: ${sql}`);
    });

    const result = await planShopifyPayoutActions('biz-1', 'pay-1', deps);

    expect(result).toMatchObject({ status: 'blocked', error: 'Unresolved payout charges: sat' });
    expect(deps.mainExecute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO shopify_payment_xero_actions'))).toBe(false);
  });

  it('blocks refunds without one completed Xero credit note', async () => {
    deps.mainQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM shopify_payment_payouts')) {
        return [{ shopify_payout_id: 'pay-2', payout_date: '2026-07-27', shopify_status: 'paid', currency: 'AUD', payout_amount: -50 }];
      }
      if (sql.includes('FROM shopify_payment_payout_transactions')) {
        return [{ shopify_transaction_id: 'refund-1', transaction_type: 'refund', amount: -50, fee: 0, net: -50, currency: 'AUD', source_order_id: 'order-sat' }];
      }
      if (sql.includes('FROM xero_gateway_mappings')) {
        return [{ gateway_name: 'shopify_payments', clearing_account_code: '091', fee_account_code: '404', fee_tax_type: 'NONE' }];
      }
      throw new Error(`Unhandled main query: ${sql}`);
    });
    deps.tenantQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_orders')) return [{ id: 1, shopify_order_id: 'order-sat', order_date: '2026-07-25' }];
      if (sql.includes('FROM ims_credit_notes')) return [];
      throw new Error(`Unhandled tenant query: ${sql}`);
    });

    const result = await planShopifyPayoutActions('biz-1', 'pay-2', deps);

    expect(result).toMatchObject({ status: 'blocked', error: 'Refund refund-1 does not have one completed Xero credit note' });
  });

  it('plans a fee reversal as a clearing receive', async () => {
    deps.mainQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM shopify_payment_payouts')) {
        return [{ shopify_payout_id: 'pay-3', payout_date: '2026-07-27', shopify_status: 'paid', currency: 'AUD', payout_amount: 101 }];
      }
      if (sql.includes('FROM shopify_payment_payout_transactions')) {
        return [{ shopify_transaction_id: 'charge-1', transaction_type: 'charge', amount: 100, fee: 1, net: 101, currency: 'AUD', source_order_id: 'order-sat' }];
      }
      if (sql.includes('FROM xero_online_batches')) {
        return [{ batch_date: '2026-07-25', xero_invoice_id: 'inv-sat', payout_managed: 1 }];
      }
      if (sql.includes('FROM xero_gateway_mappings')) {
        return [{ gateway_name: 'shopify_payments', clearing_account_code: '091', fee_account_code: '404', fee_tax_type: 'NONE' }];
      }
      throw new Error(`Unhandled main query: ${sql}`);
    });

    const result = await planShopifyPayoutActions('biz-1', 'pay-3', deps);

    expect(result.actions).toContainEqual(expect.objectContaining({
      actionType: 'fee_receive',
      amount: 1,
      reference: 'Shopify fee reversal payout pay-3',
    }));
  });
});