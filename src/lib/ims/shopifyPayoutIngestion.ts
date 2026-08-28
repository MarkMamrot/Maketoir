import { planShopifyPayoutActions } from '@/lib/ims/shopifyPayoutActionPlanner';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { toBusinessDate } from '@/lib/shopifyDate';
import { classifyShopifyPayoutTransaction } from '@/lib/xero/shopifyPayoutReconciliation';
import { execute, query } from '@/services/MySQLService';

export type ShopifyApiCreds = { shopName: string; token: string; base: string };

type PayoutIngestionDependencies = {
  mainExecute: typeof execute;
  mainQuery: typeof query;
  fetchTransactions: typeof fetchShopifyPayoutTransactions;
  planActions: typeof planShopifyPayoutActions;
};

const defaultDependencies: PayoutIngestionDependencies = {
  mainExecute: execute,
  mainQuery: query,
  fetchTransactions: fetchShopifyPayoutTransactions,
  planActions: planShopifyPayoutActions,
};

const PROTECTED_STATUSES = new Set(['planned', 'partial', 'reconciled']);

function nextPageUrl(response: Response): string | null {
  const match = (response.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

async function fetchShopifyPages(creds: ShopifyApiCreds, initialUrl: string, keys: string[]): Promise<any[]> {
  const results: any[] = [];
  let url: string | null = initialUrl;
  while (url) {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': creds.token,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Shopify ${response.status}: ${body.slice(0, 200)}`);
    }
    const json = await response.json().catch(() => ({} as any));
    const rows = keys.map(key => json?.[key]).find(Array.isArray) ?? [];
    results.push(...rows);
    url = nextPageUrl(response);
  }
  return results;
}

export async function getShopifyApiCreds(businessId: string): Promise<ShopifyApiCreds | null> {
  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) return null;
  return {
    shopName: credentials.shopName,
    token: credentials.token,
    base: `https://${credentials.shopDomain}/admin/api/2024-10`,
  };
}

export async function fetchShopifyPayoutTransactions(
  creds: ShopifyApiCreds,
  payoutId: string,
): Promise<any[]> {
  return fetchShopifyPages(
    creds,
    `${creds.base}/shopify_payments/balance/transactions.json?payout_id=${encodeURIComponent(payoutId)}&limit=250`,
    ['transactions', 'balance_transactions'],
  );
}

export async function fetchPaidShopifyPayouts(
  creds: ShopifyApiCreds,
  dateMin: string,
): Promise<any[]> {
  return fetchShopifyPages(
    creds,
    `${creds.base}/shopify_payments/payouts.json?status=paid&date_min=${encodeURIComponent(dateMin)}&limit=250`,
    ['payouts'],
  );
}

export async function ingestShopifyPayout(
  businessId: string,
  payload: any,
  creds: ShopifyApiCreds | null,
  deps: PayoutIngestionDependencies = defaultDependencies,
): Promise<{ payoutId: string; status: string }> {
  const payoutId = String(payload?.id ?? payload?.payout?.id ?? payload?.payout_id ?? '').trim();
  if (!payoutId) throw new Error('Shopify payout has no id');

  const payoutStatus = String(payload?.status ?? payload?.payout?.status ?? '').trim().toLowerCase();
  const existing = await deps.mainQuery<{ reconciliation_status: string }>(
    `SELECT reconciliation_status
       FROM shopify_payment_payouts
      WHERE business_id = ? AND shopify_payout_id = ?
      LIMIT 1`,
    [businessId, payoutId],
  );
  const existingStatus = String(existing[0]?.reconciliation_status ?? '').toLowerCase();
  if (payoutStatus === 'paid' && PROTECTED_STATUSES.has(existingStatus)) {
    return { payoutId, status: `skipped_${existingStatus}` };
  }

  const payoutCurrency = String(payload?.currency ?? payload?.payout?.currency ?? '').trim().toUpperCase();
  const payoutAmount = Number(payload?.amount ?? payload?.payout?.amount ?? 0);
  const payoutDate = String(payload?.date ?? payload?.payout?.date ?? '').slice(0, 10) || null;
  await deps.mainExecute(
    `INSERT INTO shopify_payment_payouts
       (business_id, shopify_payout_id, payout_date, shopify_status, currency,
        payout_amount, reconciliation_status, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       payout_date = VALUES(payout_date), shopify_status = VALUES(shopify_status),
       currency = VALUES(currency), payout_amount = VALUES(payout_amount),
       reconciliation_status = VALUES(reconciliation_status), raw_payload = VALUES(raw_payload)`,
    [businessId, payoutId, payoutDate, payoutStatus || 'unknown', payoutCurrency, payoutAmount,
      payoutStatus === 'paid' ? 'ingesting' : 'waiting_for_paid', JSON.stringify(payload)],
  );
  if (payoutStatus !== 'paid') return { payoutId, status: 'waiting_for_paid' };
  if (!creds) throw new Error(`Missing Shopify credentials for payout ${payoutId}`);

  try {
    const transactions = await deps.fetchTransactions(creds, payoutId);
    for (const transaction of transactions) {
      const transactionId = String(transaction?.id ?? '').trim();
      if (!transactionId) throw new Error(`Payout ${payoutId} contains a transaction without an id`);
      const processedAt = String(transaction?.processed_at ?? transaction?.created_at ?? '').trim() || null;
      await deps.mainExecute(
        `INSERT INTO shopify_payment_payout_transactions
           (business_id, shopify_transaction_id, shopify_payout_id, transaction_type,
            amount, fee, net, currency, source_id, source_type, source_order_id,
            source_order_transaction_id, processed_at, business_date, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           shopify_payout_id = VALUES(shopify_payout_id), transaction_type = VALUES(transaction_type),
           amount = VALUES(amount), fee = VALUES(fee), net = VALUES(net), currency = VALUES(currency),
           source_id = VALUES(source_id), source_type = VALUES(source_type),
           source_order_id = VALUES(source_order_id),
           source_order_transaction_id = VALUES(source_order_transaction_id),
           processed_at = VALUES(processed_at), business_date = VALUES(business_date),
           raw_payload = VALUES(raw_payload)`,
        [
          businessId, transactionId, payoutId, String(transaction?.type ?? 'unknown'),
          Number(transaction?.amount ?? 0), Number(transaction?.fee ?? 0), Number(transaction?.net ?? 0),
          String(transaction?.currency ?? payoutCurrency).toUpperCase(),
          transaction?.source_id != null ? String(transaction.source_id) : null,
          transaction?.source_type != null ? String(transaction.source_type) : null,
          transaction?.source_order_id != null ? String(transaction.source_order_id) : null,
          transaction?.source_order_transaction_id != null ? String(transaction.source_order_transaction_id) : null,
          processedAt ? new Date(processedAt) : null,
          processedAt ? toBusinessDate(processedAt) : null,
          JSON.stringify(transaction),
        ],
      );
    }

    const transactionNet = Math.round(transactions.reduce((sum, transaction) => (
      classifyShopifyPayoutTransaction(String(transaction?.type ?? '')) === 'settlement'
        ? sum
        : sum + Number(transaction?.net ?? 0)
    ), 0) * 100) / 100;
    const difference = Math.round((transactionNet - payoutAmount) * 100) / 100;
    if (difference !== 0) {
      const error = `Balance transaction net ${transactionNet.toFixed(2)} does not equal payout ${payoutAmount.toFixed(2)}`;
      await deps.mainExecute(
        `UPDATE shopify_payment_payouts
            SET transaction_net_total = ?, reconciliation_status = 'blocked', error_detail = ?
          WHERE business_id = ? AND shopify_payout_id = ?`,
        [transactionNet, error, businessId, payoutId],
      );
      return { payoutId, status: 'blocked' };
    }

    await deps.mainExecute(
      `UPDATE shopify_payment_payouts
          SET transaction_net_total = ?, reconciliation_status = 'ready_to_allocate', error_detail = NULL
        WHERE business_id = ? AND shopify_payout_id = ?`,
      [transactionNet, businessId, payoutId],
    );
    const plan = await deps.planActions(businessId, payoutId);
    return { payoutId, status: plan.status };
  } catch (error: any) {
    const message = error?.message ?? String(error);
    await deps.mainExecute(
      `UPDATE shopify_payment_payouts
          SET reconciliation_status = 'blocked', error_detail = ?
        WHERE business_id = ? AND shopify_payout_id = ?`,
      [message, businessId, payoutId],
    ).catch(() => {});
    throw error;
  }
}