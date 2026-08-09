import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsPORepo, ImsSORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

export async function POST(
  req: Request,
  { params }: { params: { type: string; id: string } },
) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = String(session.businessId);
  const id = Number(params.id);
  const type = params.type;

  if (!Number.isInteger(id) || id <= 0 || !['customer', 'supplier'].includes(type)) {
    return NextResponse.json({ error: 'Invalid backorder reference.' }, { status: 400 });
  }

  let action = 'update';
  try {
    const body = await req.json() as { action?: string };
    action = String(body.action ?? '');
    if (!['release', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Action must be release or cancel.' }, { status: 400 });
    }

    const repo = type === 'customer' ? ImsSORepo : ImsPORepo;
    const order = await repo.get(id, businessId);
    if (!order) return NextResponse.json({ error: 'Backorder not found.' }, { status: 404 });
    if (order.status !== 'backordered') {
      return NextResponse.json({ error: 'This order is no longer backordered.' }, { status: 409 });
    }
    if (action === 'cancel') {
      const table = type === 'customer' ? 'ims_customer_credit_settlements' : 'ims_supplier_credit_settlements';
      const target = type === 'customer' ? 'target_so_id' : 'target_po_id';
      const reserved = await imsQuery<{ id: number }>(`SELECT id FROM ${table} WHERE business_id=? AND ${target}=? AND action_type='reserve_for_order' AND status IN ('planned','running','succeeded') LIMIT 1`, [businessId, id]);
      if (Array.isArray(reserved) && reserved.length) return NextResponse.json({ error: 'This backorder owns reserved Xero credit. Release, reassign, or reverse that credit before cancelling it.' }, { status: 409 });
    }

    const targetStatus = action === 'release' ? 'confirmed' : 'cancelled';
    if (type === 'customer') await ImsSORepo.changeStatus(id, targetStatus);
    else await ImsPORepo.changeStatus(id, targetStatus);

    const variantIds = (order.items ?? []).map(item => item.variant_id).filter(Boolean) as string[];
    if (variantIds.length) refreshVariantCache(variantIds).catch(() => {});

    return NextResponse.json({ success: true, status: targetStatus });
  } catch (error: any) {
    const message = String(error?.message ?? 'Backorder action failed.');
    const isConflict = /backorder|cannot|only/i.test(message);
    if (!isConflict) {
      await reportRuntimeIssue({
        businessId,
        source: type === 'customer' ? 'ims_sales_orders' : 'ims_purchase_orders',
        operation: `${action || 'update'}_backorder`,
        title: 'Backorder action failed',
        error,
        context: { type, id },
        reference: { type: type === 'customer' ? 'sales_order' : 'purchase_order', id },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: isConflict ? 409 : 500 });
  }
}