import { assessXeroDocumentEdit } from '@/lib/xero/documentEditPolicy';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getXeroInvoiceEditState } from '@/services/XeroSyncService';

export type SalesOrderXeroDocument = {
  orderId: number;
  orderNumber: string;
  xeroDocumentId: string | null;
};

export type SalesOrderXeroClearance = {
  documentId: string;
  status: string;
  editable: boolean;
  conflict: string | null;
};

export type SalesOrderXeroClearances = Record<number, SalesOrderXeroClearance>;

export async function preflightSalesOrderXeroDocuments(
  businessId: string,
  documents: SalesOrderXeroDocument[],
): Promise<SalesOrderXeroClearances> {
  const linked = documents.filter(document => document.xeroDocumentId);
  const entries = await Promise.all(linked.map(async document => {
    const documentId = String(document.xeroDocumentId);
    try {
      const state = await getXeroInvoiceEditState(businessId, documentId);
      const assessment = assessXeroDocumentEdit(true, state);
      return [document.orderId, {
        documentId,
        status: String(state.status ?? 'UNKNOWN'),
        editable: assessment.allowed,
        conflict: assessment.message,
      }] as const;
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_sales_orders',
        operation: 'xero_transfer_preflight',
        title: 'Sales order Xero transfer preflight failed',
        error,
        context: { orderId: document.orderId, orderNumber: document.orderNumber },
        reference: { type: 'sales_order', id: String(document.orderId) },
      }).catch(() => {});
      return [document.orderId, {
        documentId,
        status: 'UNKNOWN',
        editable: false,
        conflict: 'has a linked Xero invoice that could not be verified. Check the Xero connection and try again.',
      }] as const;
    }
  }));
  return Object.fromEntries(entries);
}