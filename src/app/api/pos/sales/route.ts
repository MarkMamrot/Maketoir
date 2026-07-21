import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosSalesRepo, PosRegisterSessionRepo } from '@/lib/db/PosRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { createNotification } from '@/lib/ims/createNotification';
import { getImsSession } from '@/lib/auth/imsSession';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/sales?location_id=3&date=2025-06-02&parked=1
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const { searchParams } = new URL(req.url);
  const locationId = parseInt(searchParams.get('location_id') ?? String(session.location_id), 10);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const parked = searchParams.get('parked') === '1';

  if (parked) {
    const sales = await PosSalesRepo.listParked(locationId);
    return NextResponse.json({ sales });
  }

  const sales = await PosSalesRepo.list(locationId, date);
  return NextResponse.json({ sales });
}

// POST /api/pos/sales — create/complete a sale (supports offline-first via local_id)
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  try {
    const body = await req.json();

    // Idempotency: if local_id already exists, return the existing sale id
    if (body.local_id) {
      const existing = await PosSalesRepo.findByLocalId(body.local_id);
      if (existing) {
        return NextResponse.json({ success: true, id: existing.id, duplicate: true });
      }
    }

    // Resolve which register SESSION this sale belongs to, so end-of-day
    // reconciliation sums by session (handles shifts that cross midnight or a
    // register left open across days) rather than by calendar date.
    const registerId = body.register_id ?? session.register_id ?? null;
    let registerSessionId: number | null = body.register_session_id ?? null;
    if (registerSessionId == null && registerId) {
      const openSession = await PosRegisterSessionRepo.getCurrent(Number(registerId)).catch(() => null);
      registerSessionId = openSession?.id ?? null;
    }

    const { saleId, stockError } = await PosSalesRepo.complete({
      local_id:          body.local_id ?? null,
      register_id:       registerId,
      register_session_id: registerSessionId,
      location_id:       body.location_id ?? session.location_id,
      cashier_id:        (body.cashier_id || session.pos_user_id) || null,
      cashier_name:      session.full_name || session.username || null,
      sale_type:         body.sale_type   ?? 'sale',
      status:            body.status      ?? 'completed',
      customer_name:     body.customer_name  ?? null,
      customer_phone:    body.customer_phone ?? null,
      subtotal:          Number(body.subtotal       ?? 0),
      discount_total:    Number(body.discount_total ?? 0),
      tax_total:         Number(body.tax_total      ?? 0),
      total:             Number(body.total          ?? 0),
      cash_rounding:     Number(body.cash_rounding  ?? 0),
      notes:             body.notes        ?? null,
      parked_label:      body.parked_label ?? null,
      return_of_sale_id: body.return_of_sale_id ?? null,
      items:             body.items    ?? [],
      payments:          body.payments ?? [],
    });

    // EVENT-DRIVEN CACHE UPDATE: update sales velocity and stock for the variants sold
    if (body.status === 'completed' && body.items?.length > 0) {
      const vids = body.items.map((i: any) => i.variant_id).filter(Boolean);
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for POS sale:', err));
      }
    }

    // Persist a notification so the IMS operator is alerted when POS stock deduction fails
    if (stockError) {
      const bizId: string = session.businessId ?? '';
      if (bizId) {
        createNotification(
          bizId,
          'pos_stock',
          'POS Stock Deduction Failed',
          stockError,
          {
            sale_id:     saleId ?? null,
            local_id:    body.local_id ?? null,
            location_id: body.location_id ?? session.location_id ?? null,
            items: (body.items ?? []).map((i: any) => ({
              variant_id: i.variant_id ?? null,
              sku:        i.sku        ?? null,
              name:       i.name       ?? null,
              qty:        i.qty        ?? i.quantity ?? null,
            })),
          },
        ).catch(err => console.error('[notifications] POS stock notify failed:', err));
      }
    }

    return NextResponse.json({ success: true, id: saleId, ...(stockError ? { stockWarning: stockError } : {}) });
  } catch (err: any) {
    console.error('POS sale create error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
