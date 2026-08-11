import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo, SupplierReturnConflict } from '@/lib/ims/ImsRepository';
import { triggerSupplierCNXeroUpdate } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assessXeroCreditNoteEdit, hasXeroVisibleCreditNoteChanges, type XeroCreditNoteEditState } from '@/lib/xero/documentEditPolicy';
import { recordXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';
import { getXeroCreditNoteEditState } from '@/services/XeroSyncService';

function normalizeAndValidateSupplierCNItems(items: any[] | undefined): { items?: any[]; error: string | null } {
  if (items === undefined) return { items: undefined, error: null };
  if (!Array.isArray(items) || items.length === 0) return { items: [], error: 'Please add at least one line item.' };
  const normalized = items.map(item => ({
    ...item,
    qty: Math.abs(Number(item?.qty)),
    unit_cost: Math.abs(Number(item?.unit_cost)),
    tax_rate: Math.abs(Number(item?.tax_rate ?? 0)),
    restock: item?.restock === undefined ? true : !!item?.restock,
  }));
  for (const item of normalized) {
    if (!(Number(item?.qty) > 0)) {
      return { items: [], error: 'Supplier credit note quantities cannot be 0. You can enter positive or negative values; the system auto-converts to positive.' };
    }
  }
  return { items: normalized, error: null };
}


export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsSupplierCNRepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, xeroOverrideReason, ...data } = body;
    const normalized = normalizeAndValidateSupplierCNItems(items);
    if (normalized.error) {
      return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
    }
    const existing = await ImsSupplierCNRepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const hasXeroChanges = hasXeroVisibleCreditNoteChanges(
      'supplier_credit_note', existing as unknown as Record<string, unknown>, data, normalized.items,
    );
    let xeroState: XeroCreditNoteEditState | null = null;
    let isXeroOverride = false;
    if (existing.xero_credit_note_id && hasXeroChanges) {
      try {
        xeroState = await getXeroCreditNoteEditState(businessId, existing.xero_credit_note_id);
      } catch (error) {
        await reportRuntimeIssue({
          businessId, source: 'ims_supplier_credit_notes', operation: 'xero_edit_preflight',
          title: 'Supplier credit note Xero edit preflight failed', error,
          reference: { type: 'supplier_credit_note', id: params.id },
        });
      }
      const assessment = assessXeroCreditNoteEdit(true, xeroState);
      if (!assessment.allowed) {
        const overrideReason = typeof xeroOverrideReason === 'string' ? xeroOverrideReason.trim() : '';
        const canOverride = ['Admin', 'SuperAdmin'].includes(session.tier ?? '') && overrideReason.length > 0;
        if (!canOverride) {
          return NextResponse.json({
            success: false,
            error: `${assessment.message} An Admin or SuperAdmin can save a local override by providing xeroOverrideReason.`,
            xeroOverrideAvailable: ['Admin', 'SuperAdmin'].includes(session.tier ?? ''),
          }, { status: 409 });
        }
        isXeroOverride = true;
      }
    }
    await ImsSupplierCNRepo.update(Number(params.id), businessId, data, normalized.items);
    const scn = await ImsSupplierCNRepo.get(Number(params.id), businessId);
    let xeroWarning: string | null = null;
    if (isXeroOverride) {
      xeroWarning = 'Supplier credit note saved locally as an Admin override. The linked Xero credit note was not changed.';
      await recordXeroReconciliationIssue({
        businessId, targetType: 'supplier_credit_note', referenceId: params.id,
        xeroId: existing.xero_credit_note_id, ruleKey: 'admin_edit_override', severity: 'warning',
        summary: xeroWarning, expected: { localEdit: true }, actual: xeroState,
        eventType: 'override', actorId: session.userId, actorName: session.name ?? session.email,
        reason: xeroOverrideReason.trim(),
      });
    } else if (existing.xero_credit_note_id && hasXeroChanges) {
      const result = await triggerSupplierCNXeroUpdate(businessId, Number(params.id));
      xeroWarning = result.warning;
      if (result.warning) {
        await recordXeroReconciliationIssue({
          businessId, targetType: 'supplier_credit_note', referenceId: params.id,
          xeroId: existing.xero_credit_note_id, ruleKey: 'post_edit_sync_failed', severity: 'error',
          summary: result.warning, expected: { xeroUpdated: true }, actual: { xeroUpdated: false },
        });
      }
    }
    return NextResponse.json({ success: true, data: scn, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    if (e instanceof SupplierReturnConflict) {
      return NextResponse.json({ success: false, error: e.message, code: e.code }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_supplier_credit_notes',
      operation: 'update',
      title: 'Supplier credit note update failed',
      error: e,
      reference: { type: 'supplier_credit_note', id: params.id },
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    await ImsSupplierCNRepo.delete(Number(params.id), businessId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
