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

// GET /api/pos/sales/[id]
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!getPosSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  const data = await PosSalesRepo.get(id);
  if (!data) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json(data);
}

// PUT /api/pos/sales/[id] — update status (void, park, complete layby)
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!getPosSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  try {
    const body = await req.json();
    const { status, parked_label, manager_pin } = body;

    const allowed = ['open', 'parked', 'completed', 'voided', 'layby_active', 'layby_complete'];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    // Deleting a completed transaction (void + stock reversal) is manager-PIN
    // gated and only allowed while its register session is still the open one.
    if (status === 'voided') {
      const existing = await PosSalesRepo.get(id);
      if (!existing) return NextResponse.json({ error: 'Sale not found.' }, { status: 404 });

      const pinCheck = await verifyManagerPin(existing.sale.location_id, manager_pin);
      if (!pinCheck.ok) return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status });

      if (existing.sale.register_id) {
        const current = await PosRegisterSessionRepo.getCurrent(existing.sale.register_id);
        if (!current || current.id !== existing.sale.register_session_id) {
          return NextResponse.json(
            { error: 'This transaction belongs to a closed register session and can no longer be deleted.' },
            { status: 403 },
          );
        }
      }

      const { stockError } = await PosSalesRepo.voidWithReversal(id);
      const vids = existing.items.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for POS sale void:', err));
      }
      return NextResponse.json({ success: true, ...(stockError ? { stockWarning: stockError } : {}) });
    }

    await PosSalesRepo.updateStatus(id, status, { parked_label });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POS sale update error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
