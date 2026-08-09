import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { previewCustomerResolution, resolveCustomerOutstanding } from '@/lib/ims/orderResolution/customerResolution';
import type { CreditSettlement, OrderResolutionOutcome } from '@/lib/ims/orderResolution/domain';
import { reconcileOrderResolution } from '@/lib/ims/orderResolution/xeroReconciliation';
import { imsExecute } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const OUTCOMES = new Set<OrderResolutionOutcome>(['leave_partial', 'cancel_remainder', 'create_backorder']);
const SETTLEMENTS = new Set<CreditSettlement>(['none', 'refund', 'leave_unapplied', 'reserve_for_backorder']);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const soId = Number(params.id);
  let operationKey = '';
  if (!Number.isInteger(soId) || soId <= 0) return NextResponse.json({ error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const body = await req.json();
    const outcome = String(body.outcome ?? '') as OrderResolutionOutcome;
    const settlement = String(body.settlement ?? 'none') as CreditSettlement;
    operationKey = String(body.operationKey ?? '').trim();
    if (!OUTCOMES.has(outcome) || !SETTLEMENTS.has(settlement) || !operationKey) {
      return NextResponse.json({ error: 'A valid outcome, settlement, and operation key are required.' }, { status: 400 });
    }
    const preview = await previewCustomerResolution(businessId, soId, outcome);
    if (preview.accounting.kind === 'blocked') return NextResponse.json({ error: preview.accounting.message }, { status: 409 });
    if (!preview.settlements.includes(settlement)) return NextResponse.json({ error: 'That settlement is not valid for this resolution.' }, { status: 400 });
    if (settlement === 'refund' && !String(body.accountCode ?? '').trim()) {
      return NextResponse.json({ error: 'Choose a Xero bank account for the refund.' }, { status: 400 });
    }
    const result: any = await resolveCustomerOutstanding({ businessId, soId, operationKey, outcome, settlement, accountCode: String(body.accountCode ?? '').trim() || undefined, preview, createdBy: String(session.userId ?? '') });
    if (outcome === 'leave_partial') return NextResponse.json({ success: true, data: result });
    const reconciliation = await reconcileOrderResolution({ businessId, side: 'customer', resolutionId: result.resolutionId });
    result.state = reconciliation.state;
    result.xeroCreditNoteId = reconciliation.xeroCreditNoteId;
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const message = String(error?.message ?? 'Outstanding quantity resolution failed.');
    if (operationKey) {
      await imsExecute(`UPDATE ims_so_shortfall_resolutions SET state='failed',safe_error=? WHERE business_id=? AND operation_key=? AND state<>'complete'`, [message.slice(0, 500), businessId, operationKey]).catch(() => {});
    }
    const conflict = message.includes('already used') || message.includes('no longer') || message.includes('no outstanding') || message.includes('changed after preview');
    const validation = message.includes('required') || message.includes('must be') || message.includes('Only ');
    const status = conflict ? 409 : validation ? 400 : message.includes('not found') ? 404 : 500;
    if (status === 500) await reportRuntimeIssue({ businessId, source: 'ims_sales_orders', operation: 'resolve_outstanding',
      title: 'Customer outstanding quantity resolution failed', error, reference: { type: 'sales_order', id: String(soId) } });
    return NextResponse.json({ error: message }, { status });
  }
}
