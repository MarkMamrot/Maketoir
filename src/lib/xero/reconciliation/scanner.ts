import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { xeroApiFetch } from '@/services/XeroService';
import { canonicalDocumentSnapshot, type ReconciliationDocumentSnapshot } from './domain';
import { getXeroMappingReadiness } from '../mappingReadinessService';
import { listXeroReconciliationTargets, recordXeroReconciliationIssue, resolveXeroReconciliationIssue } from './repository';
import { reconcileXeroDocument } from './service';

type ScanTarget = Awaited<ReturnType<typeof listXeroReconciliationTargets>>[number];
type EndpointKind = 'Invoices' | 'CreditNotes';

const TARGET_ENDPOINTS: Record<string, EndpointKind | undefined> = {
  purchase_order: 'Invoices',
  sales_order: 'Invoices',
  customer_credit_note: 'CreditNotes',
  supplier_credit_note: 'CreditNotes',
};

function liveDocumentSnapshot(document: Record<string, any>, kind: EndpointKind): ReconciliationDocumentSnapshot {
  return canonicalDocumentSnapshot({
    xeroId: kind === 'Invoices' ? document.InvoiceID : document.CreditNoteID,
    documentType: document.Type,
    contactId: document.Contact?.ContactID,
    currencyCode: document.CurrencyCode,
    total: document.Total,
    status: document.Status,
    compatibleStatuses: null,
    amountDue: kind === 'Invoices' ? document.AmountDue : null,
    amountPaid: kind === 'Invoices' ? document.AmountPaid : null,
    amountCredited: kind === 'Invoices' ? document.AmountCredited : null,
    remainingCredit: kind === 'CreditNotes' ? document.RemainingCredit : null,
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function scanXeroReconciliationTargets(
  input: { businessId: string; afterId?: number; limit?: number },
  dependencies: {
    listTargets?: typeof listXeroReconciliationTargets;
    xeroFetch?: typeof xeroApiFetch;
    reconcile?: typeof reconcileXeroDocument;
    reportIssue?: typeof reportRuntimeIssue;
    mappingReadiness?: typeof getXeroMappingReadiness;
    recordMappingIssue?: typeof recordXeroReconciliationIssue;
    resolveMappingIssue?: typeof resolveXeroReconciliationIssue;
  } = {},
): Promise<{
  targetCount: number;
  checkedCount: number;
  mismatchCount: number;
  failedBatches: number;
  unsupportedCount: number;
  mappingIssueCount: number;
  nextCursor: number | null;
  hasMore: boolean;
}> {
  const listTargets = dependencies.listTargets ?? listXeroReconciliationTargets;
  const xeroFetch = dependencies.xeroFetch ?? xeroApiFetch;
  const reconcile = dependencies.reconcile ?? reconcileXeroDocument;
  const reportIssue = dependencies.reportIssue ?? reportRuntimeIssue;
  const mappingReadiness = dependencies.mappingReadiness ?? getXeroMappingReadiness;
  const recordMappingIssue = dependencies.recordMappingIssue ?? recordXeroReconciliationIssue;
  const resolveMappingIssue = dependencies.resolveMappingIssue ?? resolveXeroReconciliationIssue;
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const targets = await listTargets({ businessId: input.businessId, afterId: input.afterId, limit });
  const grouped = new Map<EndpointKind, ScanTarget[]>([['Invoices', []], ['CreditNotes', []]]);
  let unsupportedCount = 0;
  let mappingIssueCount = 0;
  try {
    const readiness = await mappingReadiness(input.businessId);
    for (const item of readiness.items) {
      const referenceId = `${item.category}:${item.key}`;
      const activeRule = item.status === 'missing' ? 'mapping_missing' : item.status === 'stale' ? 'mapping_stale' : null;
      for (const ruleKey of ['mapping_missing', 'mapping_stale'] as const) {
        if (ruleKey === activeRule) {
          await recordMappingIssue({
            businessId: input.businessId, targetType: 'mapping', referenceId, ruleKey,
            severity: item.status === 'stale' ? 'error' : 'warning', summary: item.summary,
            expected: { label: item.label, requirement: item.requirement }, actual: { status: item.status },
          });
          mappingIssueCount += 1;
        } else {
          await resolveMappingIssue({ businessId: input.businessId, targetType: 'mapping', referenceId, ruleKey, actual: { status: item.status }, reason: 'Mapping readiness recovered during Xero recheck.' });
        }
      }
    }
  } catch (error) {
    await reportIssue({
      businessId: input.businessId, source: 'xero_reconciliation', operation: 'scan_mapping_readiness',
      title: 'Xero mapping readiness could not be checked', error,
    }).catch(() => {});
  }
  for (const target of targets) {
    const endpoint = TARGET_ENDPOINTS[target.targetType];
    if (!endpoint) unsupportedCount += 1;
    else grouped.get(endpoint)!.push(target);
  }

  let checkedCount = 0;
  let mismatchCount = 0;
  let failedBatches = 0;
  for (const [kind, endpointTargets] of grouped) {
    for (const batch of chunks(endpointTargets, 20)) {
      const ids = batch.map(target => target.xeroId);
      let documents: Record<string, any>[];
      try {
        const response = await xeroFetch(
          input.businessId,
          `/${kind}?IDs=${ids.map(encodeURIComponent).join(',')}&unitdp=4`,
          { method: 'GET' },
        );
        documents = Array.isArray(response?.[kind]) ? response[kind] : [];
      } catch (error) {
        failedBatches += 1;
        await reportIssue({
          businessId: input.businessId,
          source: 'xero_reconciliation',
          operation: 'scan_document_batch',
          title: 'Xero reconciliation batch could not be checked',
          error,
          context: { endpoint: kind, targetCount: batch.length },
        }).catch(() => {});
        continue;
      }

      const byId = new Map(documents.map(document => [
        String(kind === 'Invoices' ? document.InvoiceID ?? '' : document.CreditNoteID ?? ''),
        document,
      ]));
      for (const target of batch) {
        const document = byId.get(target.xeroId);
        const result = await reconcile({
          businessId: input.businessId,
          targetType: target.targetType,
          referenceId: target.referenceId,
          xeroId: target.xeroId,
          expected: canonicalDocumentSnapshot(target.expected),
          actual: document ? liveDocumentSnapshot(document, kind) : null,
        });
        checkedCount += 1;
        mismatchCount += result.mismatchCount;
      }
    }
  }

  return {
    targetCount: targets.length,
    checkedCount,
    mismatchCount,
    failedBatches,
    unsupportedCount,
    mappingIssueCount,
    nextCursor: targets.at(-1)?.id ?? null,
    hasMore: targets.length === limit,
  };
}