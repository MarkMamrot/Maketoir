import { executeShopifyPayoutActions } from '@/lib/ims/shopifyPayoutActionExecutor';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getXeroDocumentPolicy } from '@/lib/xero/documentPolicyRepository';
import { query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

type AutoPostStatus = 'skipped_disabled' | 'skipped_not_planned' | 'reconciled' | 'blocked' | 'partial' | 'error';

type AutoPostDependencies = {
  getPolicy: typeof getXeroDocumentPolicy;
  mainQuery: typeof query;
  xeroFetch: typeof xeroApiFetch;
  executeActions: typeof executeShopifyPayoutActions;
  reportIssue: typeof reportRuntimeIssue;
};

const defaultDependencies: AutoPostDependencies = {
  getPolicy: getXeroDocumentPolicy,
  mainQuery: query,
  xeroFetch: xeroApiFetch,
  executeActions: executeShopifyPayoutActions,
  reportIssue: reportRuntimeIssue,
};

async function authorisePlannedInvoices(
  businessId: string,
  payoutId: string,
  deps: AutoPostDependencies,
): Promise<void> {
  const rows = await deps.mainQuery<{ target_xero_document_id: string }>(
    `SELECT DISTINCT target_xero_document_id
       FROM shopify_payment_xero_actions
      WHERE business_id = ? AND shopify_payout_id = ?
        AND action_type = 'invoice_payment'
        AND status != 'completed'
        AND target_xero_document_id IS NOT NULL`,
    [businessId, payoutId],
  );
  for (const row of rows) {
    const invoiceId = String(row.target_xero_document_id).trim();
    const response = await deps.xeroFetch(businessId, `/Invoices/${encodeURIComponent(invoiceId)}`);
    const invoice = response?.Invoices?.[0];
    const status = String(invoice?.Status ?? '').toUpperCase();
    if (!invoice) throw new Error(`Xero invoice ${invoiceId} was not found`);
    if (status === 'DRAFT' || status === 'SUBMITTED') {
      await deps.xeroFetch(businessId, `/Invoices/${encodeURIComponent(invoiceId)}`, {
        method: 'POST',
        body: { Invoices: [{ InvoiceID: invoiceId, Status: 'AUTHORISED' }] },
      });
    } else if (!['AUTHORISED', 'PAID'].includes(status)) {
      throw new Error(`Xero invoice ${invoiceId} cannot be paid from status ${status || 'UNKNOWN'}`);
    }
  }
}

export async function autoPostShopifyPayout(
  businessId: string,
  payoutId: string,
  deps: AutoPostDependencies = defaultDependencies,
): Promise<{ status: AutoPostStatus; error?: string }> {
  const policy = await deps.getPolicy(businessId);
  if (!policy.shopifyPayoutAutoPostEnabled) return { status: 'skipped_disabled' };

  const payouts = await deps.mainQuery<{ reconciliation_status: string }>(
    `SELECT reconciliation_status
       FROM shopify_payment_payouts
      WHERE business_id = ? AND shopify_payout_id = ?
      LIMIT 1`,
    [businessId, payoutId],
  );
  if (String(payouts[0]?.reconciliation_status ?? '') !== 'planned') {
    return { status: 'skipped_not_planned' };
  }

  try {
    await authorisePlannedInvoices(businessId, payoutId, deps);
    const result = await deps.executeActions(businessId, payoutId);
    if (result.status !== 'reconciled') {
      const error = result.error ?? `Shopify payout auto-post finished ${result.status}`;
      await deps.reportIssue({
        businessId,
        source: 'xero',
        operation: 'shopify_payout_auto_post',
        title: 'Shopify payout auto-post failed',
        error,
        context: { status: result.status },
        reference: { type: 'shopify_payout', id: payoutId },
      });
      return { status: result.status, error };
    }
    return { status: 'reconciled' };
  } catch (error: any) {
    const message = error?.message ?? String(error);
    await deps.reportIssue({
      businessId,
      source: 'xero',
      operation: 'shopify_payout_auto_post',
      title: 'Shopify payout auto-post failed',
      error,
      reference: { type: 'shopify_payout', id: payoutId },
    });
    return { status: 'error', error: message };
  }
}