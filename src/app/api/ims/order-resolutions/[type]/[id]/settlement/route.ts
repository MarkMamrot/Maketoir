import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ImsPORepo, ImsSORepo } from '@/lib/ims/ImsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import {
  allocateXeroCreditNote,
  deleteXeroCreditNoteAllocation,
  refundXeroCreditNote,
} from '@/services/XeroSyncService';
import { xeroApiFetch } from '@/services/XeroService';

type Side = 'customer' | 'supplier';
type Action = 'unallocate' | 'refund' | 'allocate';

const config = {
  customer: {
    resolutionTable: 'ims_so_shortfall_resolutions',
    settlementTable: 'ims_customer_credit_settlements',
    creditTable: 'ims_credit_notes',
    creditColumn: 'credit_note_id',
    creditNumberColumn: 'cn_number',
    targetColumn: 'target_so_id',
    allocationType: 'allocate_to_invoice',
    refundType: 'refund',
  },
  supplier: {
    resolutionTable: 'ims_po_shortfall_resolutions',
    settlementTable: 'ims_supplier_credit_settlements',
    creditTable: 'ims_supplier_credit_notes',
    creditColumn: 'supplier_credit_note_id',
    creditNumberColumn: 'scn_number',
    targetColumn: 'target_po_id',
    allocationType: 'allocate_to_bill',
    refundType: 'supplier_refund',
  },
} as const;

export async function POST(
  request: Request,
  { params }: { params: { type: string; id: string } },
) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const side = params.type as Side;
  const resolutionId = Number(params.id);
  if (!['customer', 'supplier'].includes(side) || !Number.isInteger(resolutionId) || resolutionId <= 0) {
    return NextResponse.json({ error: 'Invalid order resolution.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? '') as Action;
  const operationKey = String(body.operationKey ?? '').trim() || randomUUID();
  if (!['unallocate', 'refund', 'allocate'].includes(action)) {
    return NextResponse.json({ error: 'Choose a valid credit action.' }, { status: 400 });
  }

  const businessId = session.businessId as string;
  const selected = config[side];
  let pendingActionKey = '';
  try {
    const resolutions = await imsQuery<any>(
      `SELECT r.id, r.currency_code, r.${selected.creditColumn} AS credit_note_id,
              cn.${selected.creditNumberColumn} AS credit_note_number,
              cn.xero_credit_note_id
         FROM ${selected.resolutionTable} r
         JOIN ${selected.creditTable} cn ON cn.id = r.${selected.creditColumn} AND cn.business_id = r.business_id
        WHERE r.id = ? AND r.business_id = ? LIMIT 1`,
      [resolutionId, businessId],
    );
    const resolution = resolutions[0];
    if (!resolution?.xero_credit_note_id) {
      return NextResponse.json({ error: 'The linked Xero credit note is not available.' }, { status: 409 });
    }

    const settlements = await imsQuery<any>(
      `SELECT * FROM ${selected.settlementTable}
        WHERE business_id = ? AND resolution_id = ?
        ORDER BY id DESC`,
      [businessId, resolutionId],
    );

    if (action === 'unallocate') {
      const allocation = settlements.find(row => row.status === 'succeeded' && row.xero_id && ['reserve_for_order', selected.allocationType].includes(row.action_type));
      if (!allocation) return NextResponse.json({ error: 'There is no active allocation to remove.' }, { status: 409 });
      await deleteXeroCreditNoteAllocation(businessId, String(resolution.xero_credit_note_id), String(allocation.xero_id));
      await imsExecute(
        `UPDATE ${selected.settlementTable} SET status='released',safe_error=NULL,completed_at=NOW()
          WHERE id=? AND business_id=? AND status='succeeded'`,
        [allocation.id, businessId],
      );
      return NextResponse.json({ success: true, data: { action: 'unallocate' } });
    }

    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!(amount > 0)) return NextResponse.json({ error: 'Enter a positive credit amount.' }, { status: 400 });
    const actionKey = `${operationKey}:${action}`;
    pendingActionKey = actionKey;
    const existing = settlements.find(row => row.action_key === actionKey);
    if (existing?.status === 'succeeded') return NextResponse.json({ success: true, data: { action, replayed: true } });

    if (action === 'refund') {
      const accountCode = String(body.accountCode ?? '').trim();
      if (!accountCode) return NextResponse.json({ error: 'Choose a Xero bank account for the refund.' }, { status: 400 });
      const accountResponse = await xeroApiFetch(businessId, '/Accounts');
      const account = (accountResponse?.Accounts ?? []).find((candidate: any) => String(candidate.Code ?? '') === accountCode);
      if (!account || account.Status !== 'ACTIVE' || (account.Type !== 'BANK' && account.EnablePaymentsToAccount !== true)) {
        return NextResponse.json({ error: 'Choose an active Xero account that accepts payments.' }, { status: 400 });
      }
      await imsExecute(
        `INSERT IGNORE INTO ${selected.settlementTable}
          (business_id,resolution_id,action_key,action_type,amount,account_code,status)
         VALUES (?,?,?,?,?,?,'running')`,
        [businessId, resolutionId, actionKey, selected.refundType, amount, accountCode],
      );
      const paymentId = await refundXeroCreditNote({
        businessId,
        creditNoteId: String(resolution.xero_credit_note_id),
        amount,
        accountCode,
        date: new Date().toISOString().slice(0, 10),
        reference: `Shortfall ${resolution.credit_note_number}`,
        actionKey,
      });
      await imsExecute(
        `UPDATE ${selected.settlementTable} SET status='succeeded',xero_id=?,safe_error=NULL,completed_at=NOW()
          WHERE business_id=? AND action_key=?`,
        [paymentId, businessId, actionKey],
      );
      return NextResponse.json({ success: true, data: { action, xeroId: paymentId } });
    }

    const targetOrderId = Number(body.targetOrderId);
    if (!Number.isInteger(targetOrderId) || targetOrderId <= 0) {
      return NextResponse.json({ error: 'Choose a valid target order.' }, { status: 400 });
    }
    const target: any = side === 'customer'
      ? await ImsSORepo.get(targetOrderId, businessId)
      : await ImsPORepo.get(targetOrderId, businessId);
    const targetXeroId = side === 'customer' ? target?.xero_invoice_id : target?.xero_bill_id;
    if (!targetXeroId) return NextResponse.json({ error: 'The target order must have an Authorised Xero document.' }, { status: 409 });

    await imsExecute(
      `INSERT IGNORE INTO ${selected.settlementTable}
        (business_id,resolution_id,action_key,action_type,amount,${selected.targetColumn},target_xero_document_id,status)
       VALUES (?,?,?,?,?,?,?,'running')`,
      [businessId, resolutionId, actionKey, selected.allocationType, amount, targetOrderId, targetXeroId],
    );
    const allocationId = await allocateXeroCreditNote({
      businessId,
      creditNoteId: String(resolution.xero_credit_note_id),
      invoiceId: String(targetXeroId),
      amount,
      actionKey,
    });
    await imsExecute(
      `UPDATE ${selected.settlementTable} SET status='succeeded',xero_id=?,safe_error=NULL,completed_at=NOW()
        WHERE business_id=? AND action_key=?`,
      [allocationId, businessId, actionKey],
    );
    return NextResponse.json({ success: true, data: { action, xeroId: allocationId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Credit settlement change failed.';
    if (pendingActionKey) {
      await imsExecute(
        `UPDATE ${selected.settlementTable}
            SET status='failed',safe_error=?,completed_at=NULL
          WHERE business_id=? AND action_key=? AND status='running'`,
        [message.slice(0, 500), businessId, pendingActionKey],
      ).catch(() => {});
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_order_resolutions',
      operation: `change_${side}_credit_settlement`,
      title: 'Order shortfall credit settlement change failed',
      error,
      reference: { type: `${side}_resolution`, id: String(resolutionId) },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
