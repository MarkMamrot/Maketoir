import { imsQuery } from '@/services/IMSMySQLService';
import { execute, query } from '@/services/MySQLService';
import {
  classifyShopifyPayoutTransaction,
  reconcileShopifyPayout,
  type ShopifyPayoutTransactionInput,
} from '@/lib/xero/shopifyPayoutReconciliation';
import { isShopifyPaymentsGateway } from '@/lib/xero/onlineGatewayMappings';

type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;
type ExecuteFn = (sql: string, params?: unknown[]) => Promise<unknown>;

export interface ShopifyPayoutPlannerDependencies {
  mainQuery: QueryFn;
  mainExecute: ExecuteFn;
  tenantQuery: QueryFn;
}

export interface PlannedShopifyPayoutAction {
  actionKey: string;
  actionType: 'invoice_payment' | 'fee_spend' | 'fee_receive' | 'credit_note_refund' | 'adjustment_spend' | 'adjustment_receive';
  targetXeroDocumentId: string | null;
  actionDate: string;
  amount: number;
  currency: string;
  accountCode: string;
  offsetAccountCode: string | null;
  taxType: string | null;
  reference: string;
  transactionIds: string[];
}

export interface ShopifyPayoutPlanResult {
  status: 'planned' | 'blocked';
  error?: string;
  actions: PlannedShopifyPayoutAction[];
}

const defaultDependencies: ShopifyPayoutPlannerDependencies = {
  mainQuery: (sql, params) => query(sql, params as any[]),
  mainExecute: (sql, params) => execute(sql, params as any[]),
  tenantQuery: (sql, params) => imsQuery(sql, params as any[]),
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

async function blockPayout(
  deps: ShopifyPayoutPlannerDependencies,
  businessId: string,
  payoutId: string,
  error: string,
): Promise<ShopifyPayoutPlanResult> {
  await deps.mainExecute(
    `DELETE FROM shopify_payment_xero_actions
      WHERE business_id = ? AND shopify_payout_id = ? AND status != 'completed'`,
    [businessId, payoutId],
  );
  await deps.mainExecute(
    `UPDATE shopify_payment_payouts
        SET reconciliation_status = 'blocked', error_detail = ?
      WHERE business_id = ? AND shopify_payout_id = ?`,
    [error, businessId, payoutId],
  );
  return { status: 'blocked', error, actions: [] };
}

export async function planShopifyPayoutActions(
  businessId: string,
  payoutId: string,
  deps: ShopifyPayoutPlannerDependencies = defaultDependencies,
): Promise<ShopifyPayoutPlanResult> {
  const payoutRows = await deps.mainQuery(
    `SELECT shopify_payout_id, payout_date, shopify_status, currency, payout_amount
       FROM shopify_payment_payouts
      WHERE business_id = ? AND shopify_payout_id = ?
      LIMIT 1`,
    [businessId, payoutId],
  );
  const payout = payoutRows[0];
  if (!payout) return blockPayout(deps, businessId, payoutId, `Payout ${payoutId} was not found`);
  if (String(payout.shopify_status).toLowerCase() !== 'paid') {
    return blockPayout(deps, businessId, payoutId, `Payout ${payoutId} is not paid`);
  }

  const payoutDate = toDateString(payout.payout_date);
  if (!payoutDate) return blockPayout(deps, businessId, payoutId, `Payout ${payoutId} has no payout date`);

  const transactionRows = await deps.mainQuery(
    `SELECT shopify_transaction_id, transaction_type, amount, fee, net, currency,
            source_order_id, business_date
       FROM shopify_payment_payout_transactions
      WHERE business_id = ? AND shopify_payout_id = ?
      ORDER BY shopify_transaction_id`,
    [businessId, payoutId],
  );
  if (transactionRows.length === 0) {
    return blockPayout(deps, businessId, payoutId, `Payout ${payoutId} has no balance transactions`);
  }

  const orderIds = Array.from(new Set(transactionRows
    .map(row => String(row.source_order_id ?? '').trim())
    .filter(Boolean)));
  const orderRows = orderIds.length > 0
    ? await deps.tenantQuery(
        `SELECT id, shopify_order_id, order_date
           FROM ims_sales_orders
          WHERE business_id = ? AND shopify_order_id IN (${placeholders(orderIds)})`,
        [businessId, ...orderIds],
      )
    : [];
  const ordersByShopifyId = new Map(orderRows.map(row => [String(row.shopify_order_id), row]));
  const transactionDates = new Map<string, string>();
  for (const row of transactionRows) {
    if (classifyShopifyPayoutTransaction(String(row.transaction_type)) !== 'charge') continue;
    const order = ordersByShopifyId.get(String(row.source_order_id ?? ''));
    if (order) transactionDates.set(String(row.shopify_transaction_id), toDateString(order.order_date));
  }

  const invoiceDates = Array.from(new Set(transactionDates.values())).filter(Boolean);
  const batchRows = invoiceDates.length > 0
    ? await deps.mainQuery(
        `SELECT batch_date, xero_invoice_id, payout_managed
           FROM xero_online_batches
          WHERE business_id = ? AND batch_date IN (${placeholders(invoiceDates)})`,
        [businessId, ...invoiceDates],
      )
    : [];
  const batchesByDate = new Map(batchRows.map(row => [toDateString(row.batch_date), row]));

  const reconciliationTransactions: ShopifyPayoutTransactionInput[] = transactionRows.map(row => {
    const transactionId = String(row.shopify_transaction_id);
    const invoiceDate = transactionDates.get(transactionId) ?? null;
    const batch = invoiceDate ? batchesByDate.get(invoiceDate) : null;
    const eligibleInvoiceId = batch && Number(batch.payout_managed) === 1
      ? String(batch.xero_invoice_id ?? '').trim() || null
      : null;
    return {
      id: transactionId,
      type: String(row.transaction_type),
      amount: row.amount,
      fee: row.fee,
      net: row.net,
      currency: String(row.currency),
      invoiceId: eligibleInvoiceId,
      invoiceDate,
    };
  });

  let reconciliation;
  try {
    reconciliation = reconcileShopifyPayout({
      payoutAmount: payout.payout_amount,
      payoutCurrency: String(payout.currency),
      transactions: reconciliationTransactions,
    });
  } catch (error: any) {
    return blockPayout(deps, businessId, payoutId, error.message);
  }
  if (!reconciliation.balanced) {
    const error = reconciliation.unresolvedChargeIds.length > 0
      ? `Unresolved payout charges: ${reconciliation.unresolvedChargeIds.join(', ')}`
      : `Payout differs from balance transactions by ${reconciliation.difference.toFixed(2)}`;
    return blockPayout(deps, businessId, payoutId, error);
  }

  const mappingRows = await deps.mainQuery(
    `SELECT gateway_name, clearing_account_code, fee_account_code, fee_tax_type
       FROM xero_gateway_mappings
      WHERE business_id = ?`,
    [businessId],
  );
  const mapping = mappingRows.find(row => isShopifyPaymentsGateway(row.gateway_name));
  const clearingAccountCode = String(mapping?.clearing_account_code ?? '').trim();
  if (!clearingAccountCode) {
    return blockPayout(deps, businessId, payoutId, 'Shopify Payments clearing account is not configured');
  }

  const actions: PlannedShopifyPayoutAction[] = reconciliation.invoiceAllocations.map(allocation => ({
    actionKey: `payout:${payoutId}:invoice:${allocation.invoiceId}`,
    actionType: 'invoice_payment',
    targetXeroDocumentId: allocation.invoiceId,
    actionDate: payoutDate,
    amount: allocation.amount,
    currency: String(payout.currency).toUpperCase(),
    accountCode: clearingAccountCode,
    offsetAccountCode: null,
    taxType: null,
    reference: `Shopify payout ${payoutId}`,
    transactionIds: allocation.transactionIds,
  }));

  const feeAccountCode = String(mapping?.fee_account_code ?? '').trim();
  const signedFeeMovement = roundCurrency(reconciliationTransactions.reduce(
    (sum, transaction) => sum + Number(transaction.net) - Number(transaction.amount),
    0,
  ));
  if (signedFeeMovement !== 0 || reconciliation.adjustments !== 0) {
    if (!feeAccountCode) {
      return blockPayout(deps, businessId, payoutId, 'Shopify fee expense account is not configured');
    }
  }
  if (signedFeeMovement !== 0) {
    actions.push({
      actionKey: `payout:${payoutId}:fees`,
      actionType: signedFeeMovement < 0 ? 'fee_spend' : 'fee_receive',
      targetXeroDocumentId: null,
      actionDate: payoutDate,
      amount: Math.abs(signedFeeMovement),
      currency: String(payout.currency).toUpperCase(),
      accountCode: clearingAccountCode,
      offsetAccountCode: feeAccountCode,
      taxType: String(mapping?.fee_tax_type ?? 'NONE').toUpperCase(),
      reference: `${signedFeeMovement < 0 ? 'Shopify fees' : 'Shopify fee reversal'} payout ${payoutId}`,
      transactionIds: reconciliationTransactions.filter(transaction => Number(transaction.fee) !== 0).map(transaction => transaction.id),
    });
  }

  const refundTransactions = reconciliationTransactions.filter(transaction =>
    classifyShopifyPayoutTransaction(transaction.type) === 'refund',
  );
  const refundOrderIds = Array.from(new Set(transactionRows
    .filter(row => classifyShopifyPayoutTransaction(String(row.transaction_type)) === 'refund')
    .map(row => String(row.source_order_id ?? '').trim())
    .filter(Boolean)));
  const creditNoteRows = refundOrderIds.length > 0
    ? await deps.tenantQuery(
        `SELECT so.shopify_order_id, cn.xero_credit_note_id, cn.total_amount
           FROM ims_credit_notes cn
           JOIN ims_sales_orders so ON so.id = cn.so_id
          WHERE cn.business_id = ?
            AND cn.source = 'shopify'
            AND cn.status = 'complete'
            AND so.shopify_order_id IN (${placeholders(refundOrderIds)})`,
        [businessId, ...refundOrderIds],
      )
    : [];
  const creditNotesByOrder = new Map<string, any[]>();
  for (const row of creditNoteRows) {
    const key = String(row.shopify_order_id);
    creditNotesByOrder.set(key, [...(creditNotesByOrder.get(key) ?? []), row]);
  }
  for (const transaction of refundTransactions) {
    const transactionRow = transactionRows.find(row => String(row.shopify_transaction_id) === transaction.id);
    const orderId = String(transactionRow?.source_order_id ?? '');
    const creditNotes = creditNotesByOrder.get(orderId) ?? [];
    if (creditNotes.length !== 1 || !creditNotes[0]?.xero_credit_note_id) {
      return blockPayout(deps, businessId, payoutId, `Refund ${transaction.id} does not have one completed Xero credit note`);
    }
    actions.push({
      actionKey: `payout:${payoutId}:refund:${transaction.id}`,
      actionType: 'credit_note_refund',
      targetXeroDocumentId: String(creditNotes[0].xero_credit_note_id),
      actionDate: payoutDate,
      amount: Math.abs(roundCurrency(Number(transaction.amount))),
      currency: String(payout.currency).toUpperCase(),
      accountCode: clearingAccountCode,
      offsetAccountCode: null,
      taxType: null,
      reference: `Shopify refund payout ${payoutId}`,
      transactionIds: [transaction.id],
    });
  }

  for (const transaction of reconciliationTransactions) {
    if (classifyShopifyPayoutTransaction(transaction.type) !== 'adjustment') continue;
    const amount = roundCurrency(Number(transaction.amount));
    if (amount === 0) continue;
    actions.push({
      actionKey: `payout:${payoutId}:adjustment:${transaction.id}`,
      actionType: amount > 0 ? 'adjustment_receive' : 'adjustment_spend',
      targetXeroDocumentId: null,
      actionDate: payoutDate,
      amount: Math.abs(amount),
      currency: String(payout.currency).toUpperCase(),
      accountCode: clearingAccountCode,
      offsetAccountCode: feeAccountCode,
      taxType: 'NONE',
      reference: `Shopify ${transaction.type} payout ${payoutId}`,
      transactionIds: [transaction.id],
    });
  }

  await deps.mainExecute(
    `DELETE FROM shopify_payment_xero_actions
      WHERE business_id = ? AND shopify_payout_id = ? AND status != 'completed'`,
    [businessId, payoutId],
  );
  for (const action of actions) {
    await deps.mainExecute(
      `INSERT INTO shopify_payment_xero_actions
         (business_id, shopify_payout_id, action_key, action_type, target_xero_document_id,
          action_date, amount, currency, account_code, offset_account_code, tax_type,
          reference, status, transaction_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
       ON DUPLICATE KEY UPDATE
         action_type = VALUES(action_type), target_xero_document_id = VALUES(target_xero_document_id),
         action_date = VALUES(action_date), amount = VALUES(amount), currency = VALUES(currency),
         account_code = VALUES(account_code), offset_account_code = VALUES(offset_account_code),
         tax_type = VALUES(tax_type), reference = VALUES(reference),
         transaction_ids = VALUES(transaction_ids)`,
      [
        businessId, payoutId, action.actionKey, action.actionType, action.targetXeroDocumentId,
        action.actionDate, action.amount, action.currency, action.accountCode,
        action.offsetAccountCode, action.taxType, action.reference,
        JSON.stringify(action.transactionIds),
      ],
    );
  }
  await deps.mainExecute(
    `UPDATE shopify_payment_payouts
        SET reconciliation_status = 'planned', error_detail = NULL
      WHERE business_id = ? AND shopify_payout_id = ?`,
    [businessId, payoutId],
  );

  return { status: 'planned', actions };
}