import { ImsCNRepo, ImsPORepo, ImsSORepo, ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';
import { getXeroDocumentPolicy } from '@/lib/xero/documentPolicyRepository';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import {
  approveCreditNote,
  refundXeroCreditNote,
  syncCNAsCreditNote,
  syncSupplierCNAsCreditNote,
  updateXeroDraftBill,
  updateXeroDraftInvoice,
} from '@/services/XeroSyncService';

export type ResolutionSide = 'customer' | 'supplier';

type ResolutionRow = {
  id: number;
  operation_key: string;
  source_order_id: number;
  credit_note_id: number | null;
  accounting_action: 'none' | 'resize_document' | 'credit_note';
  state: 'processing' | 'xero_pending' | 'complete' | 'failed' | 'unknown';
};

type SettlementRow = {
  id: number;
  action_key: string;
  action_type: string;
  amount: number;
  account_code: string | null;
  status: 'planned' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'released';
};

const config = {
  customer: {
    resolutionTable: 'ims_so_shortfall_resolutions',
    settlementTable: 'ims_customer_credit_settlements',
    sourceColumn: 'source_so_id',
    creditColumn: 'credit_note_id',
  },
  supplier: {
    resolutionTable: 'ims_po_shortfall_resolutions',
    settlementTable: 'ims_supplier_credit_settlements',
    sourceColumn: 'source_po_id',
    creditColumn: 'supplier_credit_note_id',
  },
} as const;

async function loadResolution(businessId: string, side: ResolutionSide, resolutionId: number): Promise<ResolutionRow> {
  const selected = config[side];
  const rows = await imsQuery<any>(
    `SELECT id, operation_key, ${selected.sourceColumn} AS source_order_id,
            ${selected.creditColumn} AS credit_note_id,
            accounting_action,
            state
       FROM ${selected.resolutionTable}
      WHERE id = ? AND business_id = ?
      LIMIT 1`,
    [resolutionId, businessId],
  );
  if (!rows[0]) throw new Error('The order resolution was not found.');
  return rows[0] as ResolutionRow;
}

async function loadSettlement(businessId: string, side: ResolutionSide, resolutionId: number): Promise<SettlementRow | null> {
  const rows = await imsQuery<SettlementRow>(
    `SELECT id, action_key, action_type, amount, account_code, status
       FROM ${config[side].settlementTable}
      WHERE business_id = ? AND resolution_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [businessId, resolutionId],
  );
  return rows[0] ?? null;
}

async function markSettlement(
  businessId: string,
  side: ResolutionSide,
  settlementId: number,
  status: SettlementRow['status'],
  xeroId: string | null,
  safeError: string | null = null,
): Promise<void> {
  await imsExecute(
    `UPDATE ${config[side].settlementTable}
        SET status = ?, xero_id = ?, safe_error = ?, completed_at = ${status === 'succeeded' ? 'NOW()' : 'NULL'}
      WHERE id = ? AND business_id = ?`,
    [status, xeroId, safeError, settlementId, businessId],
  );
}

async function settleCustomerCredit(
  businessId: string,
  operationKey: string,
  creditNoteId: string,
  creditNoteNumber: string,
  settlement: SettlementRow | null,
): Promise<void> {
  if (!settlement || settlement.status === 'succeeded' || settlement.action_type === 'reserve_for_order') return;
  if (settlement.status === 'unknown') throw new Error('The previous customer credit action has an unknown Xero result. Check Xero before retrying.');
  if (settlement.action_type === 'refund') {
    if (!settlement.account_code) throw new Error('The saved Xero refund account is missing. Reconciliation requires administrator review.');
    const paymentId = await refundXeroCreditNote({
      businessId,
      creditNoteId,
      amount: Number(settlement.amount),
      accountCode: settlement.account_code,
      date: new Date().toISOString().slice(0, 10),
      reference: `Shortfall ${creditNoteNumber}`,
      actionKey: `${operationKey}:refund`,
    });
    await markSettlement(businessId, 'customer', settlement.id, 'succeeded', paymentId);
  } else if (settlement.action_type === 'leave_unapplied') {
    await markSettlement(businessId, 'customer', settlement.id, 'succeeded', null);
  }
}

async function settleSupplierCredit(
  businessId: string,
  operationKey: string,
  creditNoteId: string,
  creditNoteNumber: string,
  settlement: SettlementRow | null,
): Promise<void> {
  if (!settlement || settlement.status === 'succeeded' || settlement.action_type === 'reserve_for_order') return;
  if (settlement.status === 'unknown') throw new Error('The previous supplier credit action has an unknown Xero result. Check Xero before retrying.');
  if (settlement.action_type === 'supplier_refund') {
    if (!settlement.account_code) throw new Error('The saved Xero supplier-refund account is missing. Reconciliation requires administrator review.');
    const paymentId = await refundXeroCreditNote({
      businessId,
      creditNoteId,
      amount: Number(settlement.amount),
      accountCode: settlement.account_code,
      date: new Date().toISOString().slice(0, 10),
      reference: `Supplier shortfall ${creditNoteNumber}`,
      actionKey: `${operationKey}:supplier_refund`,
    });
    await markSettlement(businessId, 'supplier', settlement.id, 'succeeded', paymentId);
  } else if (settlement.action_type === 'leave_unapplied') {
    await markSettlement(businessId, 'supplier', settlement.id, 'succeeded', null);
  }
}

export async function reconcileOrderResolution(input: {
  businessId: string;
  side: ResolutionSide;
  resolutionId: number;
  authoriseDraft?: boolean;
}): Promise<{ state: 'complete' | 'awaiting_review'; xeroCreditNoteId?: string }> {
  const resolution = await loadResolution(input.businessId, input.side, input.resolutionId);
  if (resolution.state === 'complete') return { state: 'complete' };
  if (resolution.state === 'unknown') {
    throw new Error('The previous Xero result is unknown. Check Xero and reconcile it before retrying.');
  }

  const claimed = await imsExecute(
    `UPDATE ${config[input.side].resolutionTable}
        SET state = 'processing', safe_error = NULL
      WHERE id = ? AND business_id = ? AND state IN ('xero_pending','failed')`,
    [input.resolutionId, input.businessId],
  );
  if (!claimed.affectedRows) throw new Error('This resolution is already being processed. Refresh Sync History before retrying.');

  try {
    if (resolution.accounting_action === 'resize_document') {
      if (input.side === 'customer') {
        const order: any = await ImsSORepo.get(resolution.source_order_id, input.businessId);
        if (!order?.xero_invoice_id || !await updateXeroDraftInvoice(input.businessId, order, order.xero_invoice_id)) {
          throw new Error('Xero did not accept the resized sales invoice.');
        }
      } else {
        const order: any = await ImsPORepo.get(resolution.source_order_id, input.businessId);
        if (!order?.xero_bill_id || !await updateXeroDraftBill(input.businessId, order, order.xero_bill_id)) {
          throw new Error('Xero did not accept the resized supplier bill.');
        }
      }
    } else if (resolution.accounting_action === 'credit_note') {
      if (!resolution.credit_note_id) throw new Error('The shortfall credit note is missing from this resolution.');
      const policy = await getXeroDocumentPolicy(input.businessId);
      const draftFirst = policy.shortfallCreditDraftFirst;
      const settlement = await loadSettlement(input.businessId, input.side, input.resolutionId);
      let xeroCreditNoteId: string | null = null;

      if (input.side === 'customer') {
        const creditNote: any = await ImsCNRepo.get(resolution.credit_note_id, input.businessId);
        if (!creditNote) throw new Error('The customer shortfall credit note could not be reloaded.');
        xeroCreditNoteId = await syncCNAsCreditNote(input.businessId, creditNote, draftFirst ? 'DRAFT' : 'AUTHORISED');
        if (!xeroCreditNoteId) throw new Error('Xero did not create the customer shortfall credit note.');
        if (draftFirst && !input.authoriseDraft) {
          await imsExecute(`UPDATE ${config.customer.resolutionTable} SET state='xero_pending',safe_error=NULL WHERE id=? AND business_id=?`, [input.resolutionId, input.businessId]);
          return { state: 'awaiting_review', xeroCreditNoteId };
        }
        if (draftFirst && !await approveCreditNote(input.businessId, xeroCreditNoteId, resolution.credit_note_id, 'cn_credit_note')) {
          throw new Error('Xero did not Authorise the customer shortfall credit note.');
        }
        await settleCustomerCredit(input.businessId, resolution.operation_key, xeroCreditNoteId, creditNote.cn_number, settlement);
      } else {
        const creditNote: any = await ImsSupplierCNRepo.get(resolution.credit_note_id, input.businessId);
        if (!creditNote) throw new Error('The supplier shortfall credit note could not be reloaded.');
        xeroCreditNoteId = await syncSupplierCNAsCreditNote(input.businessId, creditNote);
        if (!xeroCreditNoteId) throw new Error('Xero did not create the supplier shortfall credit note.');
        if (draftFirst && !input.authoriseDraft) {
          await imsExecute(`UPDATE ${config.supplier.resolutionTable} SET state='xero_pending',safe_error=NULL WHERE id=? AND business_id=?`, [input.resolutionId, input.businessId]);
          return { state: 'awaiting_review', xeroCreditNoteId };
        }
        if (!await approveCreditNote(input.businessId, xeroCreditNoteId, resolution.credit_note_id, 'scn_credit_note')) {
          throw new Error('Xero did not Authorise the supplier shortfall credit note.');
        }
        await settleSupplierCredit(input.businessId, resolution.operation_key, xeroCreditNoteId, creditNote.scn_number, settlement);
      }

      await imsExecute(`UPDATE ${config[input.side].resolutionTable} SET state='complete',safe_error=NULL,completed_at=NOW() WHERE id=? AND business_id=?`, [input.resolutionId, input.businessId]);
      return { state: 'complete', xeroCreditNoteId };
    }

    await imsExecute(`UPDATE ${config[input.side].resolutionTable} SET state='complete',safe_error=NULL,completed_at=NOW() WHERE id=? AND business_id=?`, [input.resolutionId, input.businessId]);
    return { state: 'complete' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Xero reconciliation failed.';
    await imsExecute(
      `UPDATE ${config[input.side].resolutionTable} SET state='failed',safe_error=? WHERE id=? AND business_id=?`,
      [message.slice(0, 500), input.resolutionId, input.businessId],
    ).catch(() => {});
    throw error;
  }
}
