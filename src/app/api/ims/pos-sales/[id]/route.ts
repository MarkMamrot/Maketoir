import { NextResponse } from 'next/server';
import { PosSalesRepo, PosRegisterSessionRepo } from '@/lib/db/PosRepository';
import { getImsSession } from '@/lib/auth/imsSession';
import { verifyManagerPin } from '@/lib/pos/managerPin';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { imsQuery } from '@/services/IMSMySQLService';

// GET /api/ims/pos-sales/[id]
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const data = await PosSalesRepo.get(id);
  if (!data) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [loc] = await imsQuery<{ name: string | null }>('SELECT name FROM ims_locations WHERE id = ? LIMIT 1', [data.sale.location_id]);
  const [reg] = data.sale.register_id
    ? await imsQuery<{ name: string | null }>('SELECT name FROM pos_registers WHERE id = ? LIMIT 1', [data.sale.register_id])
    : [{ name: null } as { name: string | null }];

  return NextResponse.json({
    success: true,
    data: {
      ...data,
      sale: {
        ...data.sale,
        location_name: loc?.name ?? null,
        register_name: reg?.name ?? null,
      },
    },
  });
}

// PUT /api/ims/pos-sales/[id] — currently supports manager-PIN-gated void.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  try {
    const body = await req.json();
    const status = body?.status;

    if (status !== 'voided') {
      return NextResponse.json({ error: 'Only status=voided is supported from IMS.' }, { status: 400 });
    }

    const existing = await PosSalesRepo.get(id);
    if (!existing) return NextResponse.json({ error: 'Sale not found.' }, { status: 404 });

    const pinCheck = await verifyManagerPin(existing.sale.location_id, body?.manager_pin);
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
      refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for IMS POS sale void:', err));
    }

    return NextResponse.json({ success: true, ...(stockError ? { stockWarning: stockError } : {}) });
  } catch (err: any) {
    console.error('IMS POS sale update error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
