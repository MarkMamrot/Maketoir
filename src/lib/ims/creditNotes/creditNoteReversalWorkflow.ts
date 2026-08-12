import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getXeroCreditNoteEditState } from '@/services/XeroSyncService';
import { assessXeroCreditNoteVoid } from '@/lib/xero/documentEditPolicy';
import { ImsCNRepo, ImsSupplierCNRepo } from '../ImsRepository';
import {
  resolveCNXeroCreditNoteId,
  resolveSupplierCNXeroCreditNoteId,
  triggerCNXeroVoid,
  triggerSupplierCNXeroVoid,
} from '../xeroHooks';
import type { InventoryDocumentOperationContext } from '../inventoryDocumentOperations';
import {
  CreditNoteReversalConflict,
  markCreditNoteCorrectionResult,
  reverseCustomerCreditNote,
  reverseSupplierCreditNote,
  type CreditNoteReversalResult,
} from './creditNoteCorrections';

export interface CreditNoteReversalWorkflowInput {
  kind: 'customer_credit_note' | 'supplier_credit_note';
  businessId: string;
  documentId: number;
  reason: string;
  context: InventoryDocumentOperationContext;
}

export interface CreditNoteReversalWorkflowResult extends CreditNoteReversalResult {
  xeroWarning: string | null;
}

export async function executeCreditNoteReversalWorkflow(
  input: CreditNoteReversalWorkflowInput,
): Promise<CreditNoteReversalWorkflowResult> {
  const isCustomer = input.kind === 'customer_credit_note';
  const note = isCustomer
    ? await ImsCNRepo.get(input.documentId, input.businessId)
    : await ImsSupplierCNRepo.get(input.documentId, input.businessId);
  if (!note) throw new CreditNoteReversalConflict(`${isCustomer ? 'Customer' : 'Supplier'} credit note not found.`);

  const xeroCreditNoteId = isCustomer
    ? await resolveCNXeroCreditNoteId(input.businessId, input.documentId)
    : await resolveSupplierCNXeroCreditNoteId(input.businessId, input.documentId);

  // A completed local operation is preflighted once. A retry after local commit
  // must be able to replay and recover Xero even when the provider is transiently unavailable.
  if (note.status === 'complete' && xeroCreditNoteId) {
    let xeroState;
    try {
      xeroState = await getXeroCreditNoteEditState(input.businessId, xeroCreditNoteId);
    } catch (error) {
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'ims_credit_notes',
        operation: 'reversal_xero_preflight',
        title: 'Credit note reversal blocked because Xero could not be verified',
        error,
        reference: { type: isCustomer ? 'credit_note' : 'supplier_credit_note', id: input.documentId },
      }).catch(() => {});
      throw new CreditNoteReversalConflict('The linked Xero credit note could not be verified. No local changes were made.');
    }
    const assessment = assessXeroCreditNoteVoid(xeroState);
    if (!assessment.allowed) throw new CreditNoteReversalConflict(`${assessment.message} No local changes were made.`);
    if (!isCustomer) {
      const localCurrency = String((note as any).currency_code ?? '').toUpperCase();
      const xeroCurrency = String(xeroState.currencyCode ?? '').toUpperCase();
      if (localCurrency && xeroCurrency && localCurrency !== xeroCurrency) {
        throw new CreditNoteReversalConflict('The supplier credit note currency does not match Xero. No local changes were made.');
      }
    }
  }

  const reversal = isCustomer
    ? await reverseCustomerCreditNote({
        businessId: input.businessId,
        documentId: input.documentId,
        reason: input.reason,
        context: input.context,
        xeroCorrectionRequired: Boolean(xeroCreditNoteId),
      })
    : await reverseSupplierCreditNote({
        businessId: input.businessId,
        documentId: input.documentId,
        reason: input.reason,
        context: input.context,
        xeroCorrectionRequired: Boolean(xeroCreditNoteId),
      });

  if (!xeroCreditNoteId) return { ...reversal, xeroWarning: null };

  const warning = isCustomer
    ? await triggerCNXeroVoid(input.businessId, input.documentId)
    : await triggerSupplierCNXeroVoid(input.businessId, input.documentId);
  if (!warning) {
    await markCreditNoteCorrectionResult(input.kind, input.businessId, input.documentId, 'synced', xeroCreditNoteId);
    return { ...reversal, xeroWarning: null };
  }

  await markCreditNoteCorrectionResult(input.kind, input.businessId, input.documentId, 'error', xeroCreditNoteId, warning);
  await reportRuntimeIssue({
    businessId: input.businessId,
    source: 'ims_credit_notes',
    operation: 'reversal_xero_void',
    title: `${isCustomer ? 'Customer' : 'Supplier'} credit note reversed locally but Xero correction failed`,
    error: new Error(warning),
    reference: { type: isCustomer ? 'credit_note' : 'supplier_credit_note', id: input.documentId },
  }).catch(() => {});
  return { ...reversal, xeroWarning: warning };
}
