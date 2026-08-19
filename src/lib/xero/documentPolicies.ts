export const XERO_DOCUMENT_ACTIONS = ['none', 'draft', 'authorised'] as const;

export type XeroDocumentAction = (typeof XERO_DOCUMENT_ACTIONS)[number];

export type XeroDocumentPolicy = {
  postingEnabled: boolean;
  poApprovedAction: XeroDocumentAction;
  poCompletedAction: XeroDocumentAction;
  poPaymentSyncEnabled: boolean;
  poReceiptJournalEnabled: boolean;
  soApprovedAction: XeroDocumentAction;
  soCompletedAction: XeroDocumentAction;
  soPaymentSyncEnabled: boolean;
  manualCustomerCreditNoteAction: XeroDocumentAction;
  supplierCreditNoteAction: XeroDocumentAction;
  shortfallCreditDraftFirst: boolean;
  posBatchSyncEnabled: boolean;
  posBatchPaymentSyncEnabled: boolean;
  onlineBatchAction: XeroDocumentAction;
  onlineBatchPaymentSyncEnabled: boolean;
  shopifyRefundCreditNoteEnabled: boolean;
  shopifyPayoutPostingEnabled: boolean;
  shopifyPayoutAutoPostEnabled: boolean;
  posCashBankingEnabled: boolean;
  stocktakeJournalEnabled: boolean;
  giftCardAccountingEnabled: boolean;
  storeCreditAccountingEnabled: boolean;
};

export const DEFAULT_XERO_DOCUMENT_POLICY: XeroDocumentPolicy = Object.freeze({
  postingEnabled: true,
  poApprovedAction: 'draft',
  poCompletedAction: 'authorised',
  poPaymentSyncEnabled: true,
  poReceiptJournalEnabled: true,
  soApprovedAction: 'draft',
  soCompletedAction: 'authorised',
  soPaymentSyncEnabled: true,
  manualCustomerCreditNoteAction: 'authorised',
  supplierCreditNoteAction: 'draft',
  shortfallCreditDraftFirst: false,
  posBatchSyncEnabled: true,
  posBatchPaymentSyncEnabled: true,
  onlineBatchAction: 'authorised',
  onlineBatchPaymentSyncEnabled: true,
  shopifyRefundCreditNoteEnabled: true,
  shopifyPayoutPostingEnabled: true,
  shopifyPayoutAutoPostEnabled: false,
  posCashBankingEnabled: true,
  stocktakeJournalEnabled: true,
  giftCardAccountingEnabled: true,
  storeCreditAccountingEnabled: true,
});

export const XERO_DOCUMENT_POLICY_PRESETS = {
  bookkeeper_review: {
    label: 'Bookkeeper review',
    policy: {
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      poCompletedAction: 'draft',
      poPaymentSyncEnabled: false,
      soCompletedAction: 'draft',
      soPaymentSyncEnabled: false,
      manualCustomerCreditNoteAction: 'draft',
      shortfallCreditDraftFirst: true,
      posBatchPaymentSyncEnabled: false,
      onlineBatchAction: 'draft',
      onlineBatchPaymentSyncEnabled: false,
    } satisfies XeroDocumentPolicy,
  },
  balanced_automation: {
    label: 'Balanced automation',
    policy: { ...DEFAULT_XERO_DOCUMENT_POLICY },
  },
  higher_automation: {
    label: 'Higher automation',
    policy: {
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      poApprovedAction: 'authorised',
      soApprovedAction: 'authorised',
      supplierCreditNoteAction: 'authorised',
    } satisfies XeroDocumentPolicy,
  },
} as const;

export type XeroDocumentPolicyPresetKey = keyof typeof XERO_DOCUMENT_POLICY_PRESETS;
export type XeroDocumentPolicyField = keyof XeroDocumentPolicy;

export function isXeroDocumentPolicyPresetKey(value: unknown): value is XeroDocumentPolicyPresetKey {
  return typeof value === 'string' && value in XERO_DOCUMENT_POLICY_PRESETS;
}

export function getXeroDocumentPolicyPreset(key: XeroDocumentPolicyPresetKey): XeroDocumentPolicy {
  return { ...XERO_DOCUMENT_POLICY_PRESETS[key].policy };
}

export function diffXeroDocumentPolicy(before: XeroDocumentPolicy, after: XeroDocumentPolicy): Array<{
  field: XeroDocumentPolicyField;
  before: XeroDocumentPolicy[XeroDocumentPolicyField];
  after: XeroDocumentPolicy[XeroDocumentPolicyField];
}> {
  return (Object.keys(DEFAULT_XERO_DOCUMENT_POLICY) as XeroDocumentPolicyField[])
    .filter(field => before[field] !== after[field])
    .map(field => ({ field, before: before[field], after: after[field] }));
}

const actionRank: Record<Exclude<XeroDocumentAction, 'none'>, number> = {
  draft: 1,
  authorised: 2,
};

export function isXeroDocumentAction(value: unknown): value is XeroDocumentAction {
  return typeof value === 'string' && XERO_DOCUMENT_ACTIONS.includes(value as XeroDocumentAction);
}

export function validateXeroDocumentPolicy(policy: XeroDocumentPolicy): string | null {
  const pairs: Array<[string, XeroDocumentAction, XeroDocumentAction]> = [
    ['Purchase order', policy.poApprovedAction, policy.poCompletedAction],
    ['Sales order', policy.soApprovedAction, policy.soCompletedAction],
  ];

  for (const [label, earlierAction, laterAction] of pairs) {
    if (
      earlierAction !== 'none'
      && laterAction !== 'none'
      && actionRank[laterAction] < actionRank[earlierAction]
    ) {
      return `${label} completed status cannot move a Xero document backwards from ${earlierAction} to ${laterAction}.`;
    }
  }

  if (!policy.posBatchSyncEnabled && policy.posBatchPaymentSyncEnabled) {
    return 'POS clearing payments require POS batch invoice sync to be enabled.';
  }
  if (policy.onlineBatchAction === 'none' && policy.onlineBatchPaymentSyncEnabled) {
    return 'Online clearing payments require daily online invoice sync to be enabled.';
  }
  if (policy.shopifyPayoutAutoPostEnabled && !policy.shopifyPayoutPostingEnabled) {
    return 'Automatic Shopify payout posting requires Shopify payout posting to be enabled.';
  }
  if (policy.shopifyPayoutAutoPostEnabled && policy.onlineBatchAction === 'none') {
    return 'Automatic Shopify payout posting requires daily online invoice sync to be enabled.';
  }
  if (policy.shopifyPayoutAutoPostEnabled && !policy.shopifyRefundCreditNoteEnabled) {
    return 'Automatic Shopify payout posting requires Shopify refund credit notes to be enabled.';
  }
  return null;
}

export function getXeroDocumentPolicyWarnings(policy: XeroDocumentPolicy): string[] {
  const warnings: string[] = [];
  if (policy.onlineBatchAction !== 'authorised' && policy.onlineBatchPaymentSyncEnabled) {
    warnings.push('Online clearing payments will authorise the daily online invoice before applying payment.');
  }
  if (policy.shopifyPayoutAutoPostEnabled) {
    warnings.push('Shopify payout actions will post automatically after reconciliation succeeds.');
  }
  if (policy.poApprovedAction === 'authorised' || policy.soApprovedAction === 'authorised') {
    warnings.push('Confirmed orders may become Authorised in Xero before completion or fulfilment.');
  }
  return warnings;
}

export function parseXeroDocumentPolicy(value: unknown): XeroDocumentPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Document policy must be an object.');
  }

  const input = value as Record<string, unknown>;
  const actionFields = [
    'poApprovedAction',
    'poCompletedAction',
    'soApprovedAction',
    'soCompletedAction',
    'manualCustomerCreditNoteAction',
    'supplierCreditNoteAction',
    'onlineBatchAction',
  ] as const;
  for (const field of actionFields) {
    if (!isXeroDocumentAction(input[field])) {
      throw new Error(`${field} must be none, draft, or authorised.`);
    }
  }

  const booleanFields = [
    'postingEnabled',
    'poPaymentSyncEnabled',
    'poReceiptJournalEnabled',
    'soPaymentSyncEnabled',
    'posBatchSyncEnabled',
    'posBatchPaymentSyncEnabled',
    'onlineBatchPaymentSyncEnabled',
    'shopifyRefundCreditNoteEnabled',
    'shopifyPayoutPostingEnabled',
    'shopifyPayoutAutoPostEnabled',
    'posCashBankingEnabled',
    'stocktakeJournalEnabled',
    'giftCardAccountingEnabled',
    'storeCreditAccountingEnabled',
    'shortfallCreditDraftFirst',
  ] as const;
  for (const field of booleanFields) {
    if (typeof input[field] !== 'boolean') {
      throw new Error(`${field} must be a boolean.`);
    }
  }

  const policy: XeroDocumentPolicy = {
    postingEnabled: input.postingEnabled as boolean,
    poApprovedAction: input.poApprovedAction as XeroDocumentAction,
    poCompletedAction: input.poCompletedAction as XeroDocumentAction,
    poPaymentSyncEnabled: input.poPaymentSyncEnabled as boolean,
    poReceiptJournalEnabled: input.poReceiptJournalEnabled as boolean,
    soApprovedAction: input.soApprovedAction as XeroDocumentAction,
    soCompletedAction: input.soCompletedAction as XeroDocumentAction,
    soPaymentSyncEnabled: input.soPaymentSyncEnabled as boolean,
    manualCustomerCreditNoteAction: input.manualCustomerCreditNoteAction as XeroDocumentAction,
    supplierCreditNoteAction: input.supplierCreditNoteAction as XeroDocumentAction,
    shortfallCreditDraftFirst: input.shortfallCreditDraftFirst as boolean,
    posBatchSyncEnabled: input.posBatchSyncEnabled as boolean,
    posBatchPaymentSyncEnabled: input.posBatchPaymentSyncEnabled as boolean,
    onlineBatchAction: input.onlineBatchAction as XeroDocumentAction,
    onlineBatchPaymentSyncEnabled: input.onlineBatchPaymentSyncEnabled as boolean,
    shopifyRefundCreditNoteEnabled: input.shopifyRefundCreditNoteEnabled as boolean,
    shopifyPayoutPostingEnabled: input.shopifyPayoutPostingEnabled as boolean,
    shopifyPayoutAutoPostEnabled: input.shopifyPayoutAutoPostEnabled as boolean,
    posCashBankingEnabled: input.posCashBankingEnabled as boolean,
    stocktakeJournalEnabled: input.stocktakeJournalEnabled as boolean,
    giftCardAccountingEnabled: input.giftCardAccountingEnabled as boolean,
    storeCreditAccountingEnabled: input.storeCreditAccountingEnabled as boolean,
  };
  const validationError = validateXeroDocumentPolicy(policy);
  if (validationError) throw new Error(validationError);
  return policy;
}

export function resolvePODocumentAction(
  policy: XeroDocumentPolicy,
  status: string,
): XeroDocumentAction {
  if (status === 'approved' || status === 'confirmed') return policy.poApprovedAction;
  if (status === 'received' || status === 'complete' || status === 'completed') return policy.poCompletedAction;
  return 'none';
}

export function resolveSODocumentAction(
  policy: XeroDocumentPolicy,
  status: string,
): XeroDocumentAction {
  if (status === 'approved' || status === 'confirmed') return policy.soApprovedAction;
  if (status === 'fulfilled' || status === 'complete' || status === 'completed') return policy.soCompletedAction;
  return 'none';
}