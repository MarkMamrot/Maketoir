import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { triggerCNXeroUpdate } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assessXeroCreditNoteEdit, hasXeroVisibleCreditNoteChanges, type XeroCreditNoteEditState } from '@/lib/xero/documentEditPolicy';
import { recordXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';
import { getXeroCreditNoteEditState } from '@/services/XeroSyncService';
import { getInventoryDocumentActivityHistory } from '@/lib/ims/inventoryDocumentHistory';

function normalizeAndValidateCNItems(rawItems: any[]) {
  const items = (rawItems ?? []).map((item: any) => ({
    ...item,
    qty: Math.abs(Number(item?.qty ?? 0)),
    unit_price: Math.abs(Number(item?.unit_price ?? 0)),
    tax_rate: Math.abs(Number(item?.tax_rate ?? 0)),
  }));

  if (!items.length) {
    return { items: [], error: 'Please add at least one line item.' };
  }

  if (items.some((item: any) => !(item.qty > 0))) {
    return { items: [], error: 'Credit note quantities cannot be 0. You can enter positive or negative values; the system auto-converts to positive.' };
  }

  return { items, error: null as string | null };
}


export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsCNRepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    let activityHistory: Awaited<ReturnType<typeof getInventoryDocumentActivityHistory>> = [];
    try {
      activityHistory = await getInventoryDocumentActivityHistory(businessId, 'customer_credit_note', Number(params.id));
    } catch (error) {
      await reportRuntimeIssue({
        businessId, source: 'ims_credit_notes', operation: 'activity_history_load',
        title: 'Customer credit note activity history failed to load', error,
        reference: { type: 'credit_note', id: params.id },
      }).catch(() => {});
    }
    return NextResponse.json({ success: true, data: { ...data, activity_history: activityHistory } });
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
    let normalizedItems = items;
    if (items !== undefined) {
      const normalized = normalizeAndValidateCNItems(items ?? []);
      if (normalized.error) {
        return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
      }
      normalizedItems = normalized.items;
    }
    const existing = await ImsCNRepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const linkedSoId = data.so_id ?? existing.so_id;
    if (linkedSoId && normalizedItems?.some((item: any) => item.source_so_item_id == null)) {
      return NextResponse.json({
        success: false,
        error: 'Every line on a sales-order return must be linked to its original sales-order line. Reopen Return / Credit from the sales order.',
      }, { status: 400 });
    }
    const hasXeroChanges = hasXeroVisibleCreditNoteChanges(
      'customer_credit_note', existing as unknown as Record<string, unknown>, data, normalizedItems,
    );
    let xeroState: XeroCreditNoteEditState | null = null;
    let isXeroOverride = false;
    if (existing.xero_credit_note_id && hasXeroChanges) {
      try {
        xeroState = await getXeroCreditNoteEditState(businessId, existing.xero_credit_note_id);
      } catch (error) {
        await reportRuntimeIssue({
          businessId, source: 'ims_credit_notes', operation: 'xero_edit_preflight',
          title: 'Customer credit note Xero edit preflight failed', error,
          reference: { type: 'credit_note', id: params.id },
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
    await ImsCNRepo.update(Number(params.id), businessId, data, normalizedItems);
    const cn = await ImsCNRepo.get(Number(params.id), businessId);
    let xeroWarning: string | null = null;
    if (isXeroOverride) {
      xeroWarning = 'Customer credit note saved locally as an Admin override. The linked Xero credit note was not changed.';
      await recordXeroReconciliationIssue({
        businessId, targetType: 'customer_credit_note', referenceId: params.id,
        xeroId: existing.xero_credit_note_id, ruleKey: 'admin_edit_override', severity: 'warning',
        summary: xeroWarning, expected: { localEdit: true }, actual: xeroState,
        eventType: 'override', actorId: session.userId, actorName: session.name ?? session.email,
        reason: xeroOverrideReason.trim(),
      });
    } else if (existing.xero_credit_note_id && hasXeroChanges) {
      const result = await triggerCNXeroUpdate(businessId, Number(params.id));
      xeroWarning = result.warning;
      if (result.warning) {
        await recordXeroReconciliationIssue({
          businessId, targetType: 'customer_credit_note', referenceId: params.id,
          xeroId: existing.xero_credit_note_id, ruleKey: 'post_edit_sync_failed', severity: 'error',
          summary: result.warning, expected: { xeroUpdated: true }, actual: { xeroUpdated: false },
        });
      }
    }
    return NextResponse.json({ success: true, data: cn, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_credit_notes',
      operation: 'update',
      title: 'Customer credit note update failed',
      error: e,
      reference: { type: 'credit_note', id: params.id },
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
    await ImsCNRepo.delete(Number(params.id), businessId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
