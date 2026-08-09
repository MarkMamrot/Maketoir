import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { canonicalDocumentSnapshot, type ReconciliationDocumentSnapshot } from './domain';
import { getXeroReconciliationTargetExpected, upsertXeroReconciliationTarget } from './repository';

export type ReconciliationTargetType = 'purchase_order' | 'sales_order' | 'customer_credit_note' | 'supplier_credit_note';

const XERO_DOCUMENT_TYPES: Record<ReconciliationTargetType, string> = {
  purchase_order: 'ACCPAY',
  sales_order: 'ACCREC',
  customer_credit_note: 'ACCRECCREDIT',
  supplier_credit_note: 'ACCPAYCREDIT',
};

function compatibleStatuses(status: string | null): string[] | null {
  switch (status?.toUpperCase()) {
    case 'DRAFT': return ['DRAFT', 'SUBMITTED'];
    case 'SUBMITTED': return ['DRAFT', 'SUBMITTED'];
    case 'AUTHORISED': return ['AUTHORISED', 'PAID'];
    case 'PAID': return ['PAID'];
    case 'VOIDED': return ['VOIDED'];
    case 'DELETED': return ['DELETED'];
    default: return null;
  }
}

export function buildExpectedXeroDocumentSnapshot(input: {
  targetType: ReconciliationTargetType;
  xeroId: string;
  total?: number | null;
  status?: string | null;
  currencyCode?: string | null;
  xeroDocument?: Record<string, any> | null;
}): ReconciliationDocumentSnapshot {
  const document = input.xeroDocument ?? {};
  const status = typeof document.Status === 'string' ? document.Status : input.status ?? null;
  return canonicalDocumentSnapshot({
    xeroId: input.xeroId,
    documentType: XERO_DOCUMENT_TYPES[input.targetType],
    contactId: typeof document.Contact?.ContactID === 'string' ? document.Contact.ContactID : null,
    currencyCode: typeof document.CurrencyCode === 'string' ? document.CurrencyCode : input.currencyCode ?? null,
    total: input.total ?? (document.Total == null ? null : Number(document.Total)),
    status,
    compatibleStatuses: compatibleStatuses(status),
    amountDue: null,
    amountPaid: null,
    amountCredited: null,
    remainingCredit: null,
  });
}

export async function recordExpectedXeroDocument(
  input: {
    businessId: string;
    targetType: ReconciliationTargetType;
    referenceId: string | number;
    xeroId: string | null;
    total?: number | null;
    status?: string | null;
    currencyCode?: string | null;
    xeroDocument?: Record<string, any> | null;
  },
  dependencies: {
    getExpected?: typeof getXeroReconciliationTargetExpected;
    upsertTarget?: typeof upsertXeroReconciliationTarget;
    reportIssue?: typeof reportRuntimeIssue;
  } = {},
): Promise<void> {
  if (!input.xeroId) return;
  const getExpected = dependencies.getExpected ?? getXeroReconciliationTargetExpected;
  const upsertTarget = dependencies.upsertTarget ?? upsertXeroReconciliationTarget;
  const reportIssue = dependencies.reportIssue ?? reportRuntimeIssue;
  try {
    const existing = await getExpected({
      businessId: input.businessId,
      targetType: input.targetType,
      referenceId: input.referenceId,
    });
    const incoming = buildExpectedXeroDocumentSnapshot({ ...input, xeroId: input.xeroId });
    const knownIncoming = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value != null));
    const expected = canonicalDocumentSnapshot({ ...(existing ?? {}), ...knownIncoming });
    await upsertTarget({
      businessId: input.businessId,
      targetType: input.targetType,
      referenceId: input.referenceId,
      xeroId: input.xeroId,
      expected,
    });
  } catch (error) {
    await reportIssue({
      businessId: input.businessId,
      source: 'xero_reconciliation',
      operation: 'record_expected_snapshot',
      title: 'Xero document synced but its reconciliation snapshot could not be recorded',
      error,
      context: { targetType: input.targetType },
      reference: { type: input.targetType, id: input.referenceId },
    }).catch(() => {});
  }
}