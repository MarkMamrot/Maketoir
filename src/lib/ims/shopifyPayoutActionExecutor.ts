import { createHash } from 'crypto';

import { execute, query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;
type ExecuteFn = (sql: string, params?: unknown[]) => Promise<unknown>;
type XeroFetchFn = (businessId: string, path: string, options?: {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}) => Promise<any>;

export interface ShopifyPayoutExecutorDependencies {
  mainQuery: QueryFn;
  mainExecute: ExecuteFn;
  xeroFetch: XeroFetchFn;
}

interface PayoutActionRow {
  id: number;
  action_key: string;
  action_type: 'invoice_payment' | 'fee_spend' | 'fee_receive' | 'credit_note_refund' | 'adjustment_spend' | 'adjustment_receive';
  target_xero_document_id: string | null;
  action_date: string | Date;
  amount: number | string;
  currency: string;
  account_code: string;
  offset_account_code: string | null;
  tax_type: string | null;
  reference: string;
  status: string;
  xero_id: string | null;
}

export interface ShopifyPayoutExecutionResult {
  status: 'reconciled' | 'blocked' | 'partial';
  completedActionIds: number[];
  error?: string;
}

const defaultDependencies: ShopifyPayoutExecutorDependencies = {
  mainQuery: (sql, params) => query(sql, params as any[]),
  mainExecute: (sql, params) => execute(sql, params as any[]),
  xeroFetch: xeroApiFetch,
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function actionDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function idempotencyKey(businessId: string, actionKey: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${businessId}|${actionKey}|${path}|${stableStringify(body)}`).digest('hex');
}

async function preflightActions(
  businessId: string,
  actions: PayoutActionRow[],
  deps: ShopifyPayoutExecutorDependencies,
): Promise<void> {
  for (const action of actions) {
    const amount = roundCurrency(Number(action.amount));
    if (!(amount > 0)) throw new Error(`Action ${action.action_key} has an invalid amount`);
    if (!action.account_code) throw new Error(`Action ${action.action_key} has no clearing account`);
    if (['fee_spend', 'fee_receive', 'adjustment_spend', 'adjustment_receive'].includes(action.action_type) && !action.offset_account_code) {
      throw new Error(`Action ${action.action_key} has no expense account`);
    }
  }

  const clearingAccountCodes = Array.from(new Set(actions
    .map(action => String(action.account_code ?? '').trim())
    .filter(Boolean)));
  for (const accountCode of clearingAccountCodes) {
    const where = encodeURIComponent(`Code==\"${accountCode}\"`);
    const response = await deps.xeroFetch(businessId, `/Accounts?where=${where}`);
    const account = Array.isArray(response?.Accounts)
      ? response.Accounts.find((candidate: any) => String(candidate?.Code ?? '').trim() === accountCode) ?? response.Accounts[0]
      : null;
    if (!account) {
      throw new Error(`Xero clearing account ${accountCode} was not found`);
    }
    const accountType = String(account?.Type ?? '').toUpperCase();
    if (accountType !== 'BANK') {
      const accountName = String(account?.Name ?? accountCode);
      throw new Error(
        `Xero clearing account ${accountCode} (${accountName}) is type ${accountType || 'UNKNOWN'} and cannot be used for POST /Payments. `
        + 'Choose a BANK account for the Shopify gateway mapping.',
      );
    }
  }

  const invoiceTotals = new Map<string, number>();
  const creditNoteTotals = new Map<string, number>();
  for (const action of actions) {
    if (!['invoice_payment', 'credit_note_refund'].includes(action.action_type)) continue;
    if (!action.target_xero_document_id) {
      throw new Error(`Action ${action.action_key} has no Xero ${action.action_type === 'invoice_payment' ? 'invoice' : 'credit note'}`);
    }
    const totals = action.action_type === 'invoice_payment' ? invoiceTotals : creditNoteTotals;
    totals.set(
      action.target_xero_document_id,
      roundCurrency((totals.get(action.target_xero_document_id) ?? 0) + Number(action.amount)),
    );
  }

  for (const [invoiceId, plannedAmount] of invoiceTotals) {
    const response = await deps.xeroFetch(businessId, `/Invoices/${encodeURIComponent(invoiceId)}`);
    const invoice = response?.Invoices?.[0];
    if (!invoice) throw new Error(`Xero invoice ${invoiceId} was not found`);
    const amountDue = roundCurrency(Number(invoice.AmountDue ?? 0));
    if (plannedAmount - amountDue > 0.01) {
      throw new Error(`Xero invoice ${invoiceId} has ${amountDue.toFixed(2)} due, below planned payment ${plannedAmount.toFixed(2)}`);
    }
  }

  for (const [creditNoteId, plannedAmount] of creditNoteTotals) {
    const response = await deps.xeroFetch(businessId, `/CreditNotes/${encodeURIComponent(creditNoteId)}`);
    const creditNote = response?.CreditNotes?.[0];
    if (!creditNote) throw new Error(`Xero credit note ${creditNoteId} was not found`);
    const remainingCredit = roundCurrency(Number(creditNote.RemainingCredit ?? 0));
    if (plannedAmount - remainingCredit > 0.01) {
      throw new Error(`Xero credit note ${creditNoteId} has ${remainingCredit.toFixed(2)} remaining, below planned refund ${plannedAmount.toFixed(2)}`);
    }
  }
}

async function postAction(
  businessId: string,
  action: PayoutActionRow,
  deps: ShopifyPayoutExecutorDependencies,
): Promise<string> {
  const amount = roundCurrency(Number(action.amount));

  if (action.action_type === 'invoice_payment' || action.action_type === 'credit_note_refund') {
    const document = action.action_type === 'invoice_payment'
      ? { Invoice: { InvoiceID: action.target_xero_document_id } }
      : { CreditNote: { CreditNoteID: action.target_xero_document_id } };
    const body = { Payments: [{
      ...document,
      Account: { Code: action.account_code },
      Date: actionDate(action.action_date),
      Amount: amount,
      Reference: action.reference,
    }] };
    const response = await deps.xeroFetch(businessId, '/Payments', {
      method: 'POST',
      idempotencyKey: idempotencyKey(businessId, action.action_key, '/Payments', body),
      body,
    });
    const paymentId = response?.Payments?.[0]?.PaymentID;
    if (!paymentId) throw new Error(`Xero did not return a PaymentID for ${action.action_key}`);
    return String(paymentId);
  }

  const body = { BankTransactions: [{
    Type: ['fee_receive', 'adjustment_receive'].includes(action.action_type) ? 'RECEIVE' : 'SPEND',
    Contact: { Name: 'Shopify Payments' },
    Date: actionDate(action.action_date),
    LineAmountTypes: action.tax_type === 'INPUT' ? 'Inclusive' : 'NoTax',
    BankAccount: { Code: action.account_code },
    Reference: action.reference,
    LineItems: [{
      Description: action.reference,
      Quantity: 1,
      UnitAmount: amount,
      AccountCode: action.offset_account_code,
      TaxType: action.tax_type ?? 'NONE',
    }],
  }] };
  const response = await deps.xeroFetch(businessId, '/BankTransactions', {
    method: 'POST',
    idempotencyKey: idempotencyKey(businessId, action.action_key, '/BankTransactions', body),
    body,
  });
  const bankTransactionId = response?.BankTransactions?.[0]?.BankTransactionID;
  if (!bankTransactionId) throw new Error(`Xero did not return a BankTransactionID for ${action.action_key}`);
  return String(bankTransactionId);
}

export async function executeShopifyPayoutActions(
  businessId: string,
  payoutId: string,
  deps: ShopifyPayoutExecutorDependencies = defaultDependencies,
): Promise<ShopifyPayoutExecutionResult> {
  const actions = await deps.mainQuery(
    `SELECT id, action_key, action_type, target_xero_document_id, action_date, amount,
            currency, account_code, offset_account_code, tax_type, reference, status, xero_id
       FROM shopify_payment_xero_actions
      WHERE business_id = ? AND shopify_payout_id = ?
      ORDER BY CASE action_type
        WHEN 'invoice_payment' THEN 1
        WHEN 'credit_note_refund' THEN 2
        WHEN 'fee_spend' THEN 3
        ELSE 4 END, id`,
    [businessId, payoutId],
  ) as PayoutActionRow[];
  if (actions.length === 0) {
    return { status: 'blocked', completedActionIds: [], error: `Payout ${payoutId} has no planned Xero actions` };
  }

  const pendingActions = actions.filter(action => action.status !== 'completed');
  try {
    await preflightActions(businessId, pendingActions, deps);
  } catch (error: any) {
    await deps.mainExecute(
      `UPDATE shopify_payment_payouts
          SET reconciliation_status = 'blocked', error_detail = ?
        WHERE business_id = ? AND shopify_payout_id = ?`,
      [error.message, businessId, payoutId],
    );
    return { status: 'blocked', completedActionIds: [], error: error.message };
  }

  const completedActionIds = actions.filter(action => action.status === 'completed').map(action => action.id);
  for (const action of pendingActions) {
    try {
      await deps.mainExecute(
        `UPDATE shopify_payment_xero_actions
            SET status = 'posting', attempt_count = attempt_count + 1,
                last_attempt_at = NOW(), error_detail = NULL
          WHERE id = ? AND business_id = ?`,
        [action.id, businessId],
      );
      const xeroId = await postAction(businessId, action, deps);
      await deps.mainExecute(
        `UPDATE shopify_payment_xero_actions
            SET status = 'completed', xero_id = ?, completed_at = NOW(), error_detail = NULL
          WHERE id = ? AND business_id = ?`,
        [xeroId, action.id, businessId],
      );
      completedActionIds.push(action.id);
    } catch (error: any) {
      await deps.mainExecute(
        `UPDATE shopify_payment_xero_actions
            SET status = 'error', error_detail = ?
          WHERE id = ? AND business_id = ?`,
        [error.message, action.id, businessId],
      );
      const status = completedActionIds.length > 0 ? 'partial' : 'blocked';
      await deps.mainExecute(
        `UPDATE shopify_payment_payouts
            SET reconciliation_status = ?, error_detail = ?
          WHERE business_id = ? AND shopify_payout_id = ?`,
        [status, error.message, businessId, payoutId],
      );
      return { status, completedActionIds, error: error.message };
    }
  }

  await deps.mainExecute(
    `UPDATE shopify_payment_payouts
        SET reconciliation_status = 'reconciled', error_detail = NULL, reconciled_at = NOW()
      WHERE business_id = ? AND shopify_payout_id = ?`,
    [businessId, payoutId],
  );
  return { status: 'reconciled', completedActionIds };
}