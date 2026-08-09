export const XERO_DOCUMENT_ACTIONS = ['none', 'draft', 'authorised'] as const;

export type XeroDocumentAction = (typeof XERO_DOCUMENT_ACTIONS)[number];

export type XeroDocumentPolicy = {
  poApprovedAction: XeroDocumentAction;
  poCompletedAction: XeroDocumentAction;
  poPaymentSyncEnabled: boolean;
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
  shopifyPayoutAutoPostEnabled: boolean;
};

export const DEFAULT_XERO_DOCUMENT_POLICY: XeroDocumentPolicy = Object.freeze({
  poApprovedAction: 'draft',
  poCompletedAction: 'authorised',
  poPaymentSyncEnabled: true,
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
  shopifyPayoutAutoPostEnabled: false,
});

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
  if (policy.onlineBatchAction !== 'authorised' && policy.onlineBatchPaymentSyncEnabled) {
    return 'Online clearing payments require the daily online invoice to be Authorised.';
  }

  return null;
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
    'poPaymentSyncEnabled',
    'soPaymentSyncEnabled',
    'posBatchSyncEnabled',
    'posBatchPaymentSyncEnabled',
    'onlineBatchPaymentSyncEnabled',
    'shopifyPayoutAutoPostEnabled',
    'shortfallCreditDraftFirst',
  ] as const;
  for (const field of booleanFields) {
    if (typeof input[field] !== 'boolean') {
      throw new Error(`${field} must be a boolean.`);
    }
  }

  const policy: XeroDocumentPolicy = {
    poApprovedAction: input.poApprovedAction as XeroDocumentAction,
    poCompletedAction: input.poCompletedAction as XeroDocumentAction,
    poPaymentSyncEnabled: input.poPaymentSyncEnabled as boolean,
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
    shopifyPayoutAutoPostEnabled: input.shopifyPayoutAutoPostEnabled as boolean,
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