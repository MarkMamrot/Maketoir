import {
  assertXeroAccountingEnabled,
  isXeroAccountingDisabledError,
  type XeroAccountingDisabledError,
} from '@/lib/ims/businessOperations';
import { getXeroDocumentPolicy } from './documentPolicyRepository';
import type { XeroDocumentPolicy } from './documentPolicies';

export type XeroWorkflowPolicyKey =
  | 'poReceiptJournalEnabled'
  | 'shopifyRefundCreditNoteEnabled'
  | 'shopifyPayoutPostingEnabled'
  | 'posCashBankingEnabled'
  | 'stocktakeJournalEnabled'
  | 'giftCardAccountingEnabled'
  | 'storeCreditAccountingEnabled';

const WORKFLOW_LABELS: Record<XeroWorkflowPolicyKey, string> = {
  poReceiptJournalEnabled: 'Purchase order receipt journals',
  shopifyRefundCreditNoteEnabled: 'Shopify refund credit notes',
  shopifyPayoutPostingEnabled: 'Shopify payout posting',
  posCashBankingEnabled: 'POS cash banking',
  stocktakeJournalEnabled: 'Stocktake journals',
  giftCardAccountingEnabled: 'Gift card accounting',
  storeCreditAccountingEnabled: 'Store credit accounting',
};

export class XeroPostingDisabledError extends Error {
  readonly code = 'xero_posting_disabled';
  readonly status = 423;

  constructor() {
    super('Xero posting is paused. Review Xero Sync Rules before posting.');
    this.name = 'XeroPostingDisabledError';
  }
}

export async function assertXeroPostingEnabled(businessId: string): Promise<void> {
  await assertXeroAccountingEnabled(businessId);
  const policy = await getXeroDocumentPolicy(businessId);
  if (!policy.postingEnabled) throw new XeroPostingDisabledError();
}

export class XeroWorkflowDisabledError extends Error {
  readonly code = 'xero_workflow_disabled';
  readonly status = 423;

  constructor(readonly workflow: XeroWorkflowPolicyKey) {
    super(`${WORKFLOW_LABELS[workflow]} is disabled in Xero Sync Rules.`);
    this.name = 'XeroWorkflowDisabledError';
  }
}

export async function assertXeroWorkflowEnabled(
  businessId: string,
  workflow: XeroWorkflowPolicyKey,
): Promise<XeroDocumentPolicy> {
  await assertXeroAccountingEnabled(businessId);
  const policy = await getXeroDocumentPolicy(businessId);
  if (!policy.postingEnabled) throw new XeroPostingDisabledError();
  if (!policy[workflow]) throw new XeroWorkflowDisabledError(workflow);
  return policy;
}

export function isXeroPostingDisabledError(error: unknown): error is XeroPostingDisabledError {
  return error instanceof XeroPostingDisabledError;
}

export function isXeroWorkflowDisabledError(error: unknown): error is XeroWorkflowDisabledError {
  return error instanceof XeroWorkflowDisabledError;
}

export function isXeroPolicyDisabledError(
  error: unknown,
): error is XeroAccountingDisabledError | XeroPostingDisabledError | XeroWorkflowDisabledError {
  return isXeroAccountingDisabledError(error) || isXeroPostingDisabledError(error) || isXeroWorkflowDisabledError(error);
}
