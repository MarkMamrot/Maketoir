import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosSalesRepo, PosRegisterSessionRepo } from '@/lib/db/PosRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';
import { verifyManagerPin } from '@/lib/pos/managerPin';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// PUT /api/pos/sales/[id]/edit — manager-PIN-gated full replace of a
// completed transaction's items/payments/totals (used by the POS "Edit
// transaction" modal in Reports). The original created_at/completed_at
// timestamps are never touched. Only allowed while the sale's register
// session is still the currently open one.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!getPosSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  try {
    const body = await req.json();
    const { manager_pin, sale_type, customer_name, customer_phone, notes,
      subtotal, discount_total, tax_total, total, cash_rounding, items, payments } = body;

    const existing = await PosSalesRepo.get(id);
    if (!existing) return NextResponse.json({ error: 'Sale not found.' }, { status: 404 });

    if (!['completed', 'layby_complete'].includes(existing.sale.status)) {
      return NextResponse.json({ error: 'Only completed transactions can be edited.' }, { status: 400 });
    }

    const pinCheck = await verifyManagerPin(existing.sale.location_id, manager_pin);
    if (!pinCheck.ok) return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status });

    if (existing.sale.register_id) {
      const current = await PosRegisterSessionRepo.getCurrent(existing.sale.register_id);
      if (!current || current.id !== existing.sale.register_session_id) {
        return NextResponse.json(
          { error: 'This transaction belongs to a closed register session and can no longer be edited.' },
          { status: 403 },
        );
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required.' }, { status: 400 });
    }
    if (!Array.isArray(payments) || payments.length === 0) {
      return NextResponse.json({ error: 'At least one payment is required.' }, { status: 400 });
    }

    const { stockError } = await PosSalesRepo.updateFull(id, {
      sale_type: sale_type ?? existing.sale.sale_type,
      customer_name, customer_phone, notes,
      subtotal, discount_total, tax_total, total, cash_rounding,
      items, payments,
    });

    const oldVids = existing.items.map(i => i.variant_id).filter(Boolean) as string[];
    const newVids = (items as any[]).map(i => i.variant_id).filter(Boolean) as string[];
    const vids = Array.from(new Set([...oldVids, ...newVids]));
    if (vids.length > 0) {
      refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for POS sale edit:', err));
    }

    return NextResponse.json({ success: true, ...(stockError ? { stockWarning: stockError } : {}) });
  } catch (err: any) {
    console.error('POS sale edit error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
