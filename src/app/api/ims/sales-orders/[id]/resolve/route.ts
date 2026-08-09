import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { previewCustomerResolution, resolveCustomerOutstanding } from '@/lib/ims/orderResolution/customerResolution';
import type { CreditSettlement, OrderResolutionOutcome } from '@/lib/ims/orderResolution/domain';
import { ImsCNRepo, ImsSORepo } from '@/lib/ims/ImsRepository';
import { imsExecute } from '@/services/IMSMySQLService';
import { refundXeroCreditNote, syncCNAsCreditNote, updateXeroDraftInvoice } from '@/services/XeroSyncService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const OUTCOMES = new Set<OrderResolutionOutcome>(['leave_partial', 'cancel_remainder', 'create_backorder']);
const SETTLEMENTS = new Set<CreditSettlement>(['none', 'refund', 'leave_unapplied', 'reserve_for_backorder']);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const soId = Number(params.id);
  if (!Number.isInteger(soId) || soId <= 0) return NextResponse.json({ error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const body = await req.json();
    const outcome = String(body.outcome ?? '') as OrderResolutionOutcome;
    const settlement = String(body.settlement ?? 'none') as CreditSettlement;
    const operationKey = String(body.operationKey ?? '').trim();
    if (!OUTCOMES.has(outcome) || !SETTLEMENTS.has(settlement) || !operationKey) {
      return NextResponse.json({ error: 'A valid outcome, settlement, and operation key are required.' }, { status: 400 });
    }
    const preview = await previewCustomerResolution(businessId, soId, outcome);
    if (preview.accounting.kind === 'blocked') return NextResponse.json({ error: preview.accounting.message }, { status: 409 });
    if (!preview.settlements.includes(settlement)) return NextResponse.json({ error: 'That settlement is not valid for this resolution.' }, { status: 400 });
    if (settlement === 'refund' && !String(body.accountCode ?? '').trim()) {
      return NextResponse.json({ error: 'Choose a Xero bank account for the refund.' }, { status: 400 });
    }
    const result: any = await resolveCustomerOutstanding({ businessId, soId, operationKey, outcome, settlement, preview, createdBy: String(session.userId ?? '') });
    if (outcome === 'leave_partial') return NextResponse.json({ success: true, data: result });

    if (preview.accounting.kind === 'resize_xero_document') {
      const resized: any = await ImsSORepo.get(soId, businessId);
      if (!resized || !resized.xero_invoice_id || !await updateXeroDraftInvoice(businessId, resized, resized.xero_invoice_id)) throw new Error('Xero did not accept the resized sales invoice. The local resolution is pending reconciliation.');
      await imsExecute(`UPDATE ims_so_shortfall_resolutions SET state='complete',completed_at=NOW() WHERE id=?`, [result.resolutionId]);
      result.state = 'complete';
    } else if (preview.accounting.kind === 'create_credit_note' && result.creditNoteId) {
      const cn: any = await ImsCNRepo.get(result.creditNoteId, businessId);
      if (!cn) throw new Error('The shortfall credit note could not be reloaded.');
      const xeroCreditNoteId = await syncCNAsCreditNote(businessId, cn, 'AUTHORISED');
      if (!xeroCreditNoteId) throw new Error('Xero did not create the shortfall credit note.');
      if (settlement === 'refund') {
        const paymentId = await refundXeroCreditNote({ businessId, creditNoteId: xeroCreditNoteId, amount: preview.totals.totalAmount,
          accountCode: String(body.accountCode).trim(), date: new Date().toISOString().slice(0, 10), reference: `Shortfall ${cn.cn_number}`, actionKey: `${operationKey}:refund` });
        await imsExecute(`UPDATE ims_customer_credit_settlements SET status='succeeded',xero_id=?,completed_at=NOW() WHERE business_id=? AND action_key=?`, [paymentId,businessId,`${operationKey}:refund`]);
      } else if (settlement === 'leave_unapplied') {
        await imsExecute(`UPDATE ims_customer_credit_settlements SET status='succeeded',xero_id=?,completed_at=NOW() WHERE business_id=? AND action_key=?`, [xeroCreditNoteId,businessId,`${operationKey}:leave_unapplied`]);
      }
      await imsExecute(`UPDATE ims_so_shortfall_resolutions SET state='complete',completed_at=NOW() WHERE id=?`, [result.resolutionId]);
      result.xeroCreditNoteId = xeroCreditNoteId;
      result.state = 'complete';
    } else {
      await imsExecute(`UPDATE ims_so_shortfall_resolutions SET state='complete',completed_at=NOW() WHERE id=?`, [result.resolutionId]);
      result.state = 'complete';
    }
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const message = String(error?.message ?? 'Outstanding quantity resolution failed.');
    const conflict = message.includes('already used') || message.includes('no longer') || message.includes('no outstanding');
    const validation = message.includes('required') || message.includes('must be') || message.includes('Only ');
    const status = conflict ? 409 : validation ? 400 : message.includes('not found') ? 404 : 500;
    if (status === 500) await reportRuntimeIssue({ businessId, source: 'ims_sales_orders', operation: 'resolve_outstanding',
      title: 'Customer outstanding quantity resolution failed', error, reference: { type: 'sales_order', id: String(soId) } });
    return NextResponse.json({ error: message }, { status });
  }
}
