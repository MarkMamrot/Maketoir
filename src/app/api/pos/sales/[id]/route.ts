import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosSalesRepo } from '@/lib/db/PosRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';

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
    const { status, parked_label } = body;

    const allowed = ['open', 'parked', 'completed', 'voided', 'layby_active', 'layby_complete'];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    await PosSalesRepo.updateStatus(id, status, { parked_label });

    // EVENT-DRIVEN CACHE UPDATE (e.g. if a sale is voided, it reverses the stock and sales velocity)
    if (status === 'voided') {
      const existing = await PosSalesRepo.get(id);
      if (existing && existing.items?.length > 0) {
        const vids = existing.items.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for POS sale void:', err));
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POS sale update error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
