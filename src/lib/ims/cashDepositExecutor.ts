import { execute, query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

type Deposit = {
  id: number;
  lodgement_date: string | Date;
  bank_reference: string | null;
  source_account_code: string;
  over_short_account_code: string | null;
  destination_account_code: string;
  status: string;
};

type Action = {
  id: number;
  action_key: string;
  action_type: 'variance' | 'bank_transfer';
  business_date: string | Date | null;
  amount: number | string;
  status: string;
  idempotency_key: string;
};

export type CashDepositExecutorDependencies = {
  query: typeof query;
  execute: typeof execute;
  xeroFetch: typeof xeroApiFetch;
};

const defaults: CashDepositExecutorDependencies = { query, execute, xeroFetch: xeroApiFetch };
const dateString = (value: string | Date | null) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);

export async function executeCashDeposit(
  businessId: string,
  depositId: number,
  postedBy: { userId: number; name: string },
  deps: CashDepositExecutorDependencies = defaults,
) {
  const [deposit] = await deps.query<Deposit>(
    `SELECT id, lodgement_date, bank_reference, source_account_code, over_short_account_code,
            destination_account_code, status
       FROM xero_cash_deposits WHERE business_id = ? AND id = ? LIMIT 1`,
    [businessId, depositId],
  );
  if (!deposit) throw new Error('Cash deposit not found');
  if (deposit.status === 'posted') return { status: 'posted' as const };
  if (!['draft', 'partial', 'error'].includes(deposit.status)) throw new Error('Cash deposit is already being posted');
  const claim = await deps.execute(
    `UPDATE xero_cash_deposits SET status = 'posting', error_detail = NULL,
            posted_by_user_id = ?, posted_by_name = ?
      WHERE business_id = ? AND id = ? AND status IN ('draft', 'partial', 'error')`,
    [postedBy.userId, postedBy.name, businessId, depositId],
  );
  if (!claim.affectedRows) throw new Error('Cash deposit is already being posted');

  const actions = await deps.query<Action>(
    `SELECT id, action_key, action_type, business_date, amount, status, idempotency_key
       FROM xero_cash_deposit_actions WHERE business_id = ? AND cash_deposit_id = ?
      ORDER BY CASE action_type WHEN 'variance' THEN 1 ELSE 2 END, business_date, id`,
    [businessId, depositId],
  );
  try {
    for (const action of actions) {
      if (action.status === 'completed') continue;
      const amount = Math.round(Number(action.amount) * 100) / 100;
      await deps.execute(
        `UPDATE xero_cash_deposit_actions SET status = 'processing', error_detail = NULL,
                attempt_count = attempt_count + 1, last_attempt_at = NOW()
          WHERE business_id = ? AND id = ?`,
        [businessId, action.id],
      );
      let xeroId: string | undefined;
      try {
        if (action.action_type === 'variance') {
          if (!deposit.over_short_account_code) throw new Error('Cash Over / Short account is missing from the deposit snapshot');
          const date = dateString(action.business_date);
          const response = await deps.xeroFetch(businessId, '/BankTransactions', {
            method: 'POST', idempotencyKey: action.idempotency_key,
            body: { BankTransactions: [{
              Type: amount > 0 ? 'RECEIVE' : 'SPEND',
              Contact: { Name: 'POS Cash Banking' },
              BankAccount: { Code: deposit.source_account_code },
              Date: date,
              Reference: `Cash banking variance ${date}`,
              LineAmountTypes: 'NoTax',
              LineItems: [{ Description: `Cash deposit ${amount > 0 ? 'overage' : 'shortage'} ${date}`, Quantity: 1, UnitAmount: Math.abs(amount), AccountCode: deposit.over_short_account_code, TaxType: 'NONE' }],
            }] },
          });
          xeroId = response?.BankTransactions?.[0]?.BankTransactionID;
        } else {
          const response = await deps.xeroFetch(businessId, '/BankTransfers', {
            method: 'POST', idempotencyKey: action.idempotency_key,
            body: { BankTransfers: [{
              FromBankAccount: { Code: deposit.source_account_code },
              ToBankAccount: { Code: deposit.destination_account_code },
              Amount: Math.abs(amount), Date: dateString(deposit.lodgement_date),
              Reference: deposit.bank_reference || `Cash deposit ${depositId}`,
            }] },
          });
          xeroId = response?.BankTransfers?.[0]?.BankTransferID;
        }
        if (!xeroId) throw new Error(`Xero did not return an ID for ${action.action_type}`);
        await deps.execute(
          `UPDATE xero_cash_deposit_actions SET status = 'completed', xero_id = ?, completed_at = NOW()
            WHERE business_id = ? AND id = ?`,
          [String(xeroId), businessId, action.id],
        );
        if (action.action_type === 'bank_transfer') {
          await deps.execute(
            `UPDATE xero_cash_deposits SET xero_bank_transfer_id = ? WHERE business_id = ? AND id = ?`,
            [String(xeroId), businessId, depositId],
          );
        }
      } catch (error: any) {
        await deps.execute(
          `UPDATE xero_cash_deposit_actions SET status = 'error', error_detail = ? WHERE business_id = ? AND id = ?`,
          [error?.message ?? 'Xero posting failed', businessId, action.id],
        );
        throw error;
      }
    }
    await deps.execute(
      `UPDATE xero_cash_deposits SET status = 'posted', posted_at = NOW(), error_detail = NULL
        WHERE business_id = ? AND id = ?`,
      [businessId, depositId],
    );
    return { status: 'posted' as const };
  } catch (error: any) {
    await deps.execute(
      `UPDATE xero_cash_deposits SET status = 'partial', error_detail = ? WHERE business_id = ? AND id = ?`,
      [error?.message ?? 'Xero posting failed', businessId, depositId],
    );
    return { status: 'partial' as const, error: error?.message ?? 'Xero posting failed' };
  }
}