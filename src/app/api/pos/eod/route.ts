import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosEodRepo } from '@/lib/db/PosRepository';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/eod?location_id=3&date=2025-06-02
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locationId = parseInt(searchParams.get('location_id') ?? String(session.location_id), 10);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  const [existing, expected] = await Promise.all([
    PosEodRepo.get(locationId, date),
    PosEodRepo.getExpected(locationId, date),
  ]);

  return NextResponse.json({ reconciliations: existing, expected });
}

// POST /api/pos/eod — save reconciliation entries
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  try {
    const body = await req.json();
    const { location_id, date, entries } = body;
    // entries: Array<{ payment_method, counted_amount, opening_float, denomination_data, notes }>

    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: 'entries must be an array.' }, { status: 400 });
    }

    const expected = await PosEodRepo.getExpected(
      location_id ?? session.location_id,
      date ?? new Date().toISOString().slice(0, 10),
    );

    for (const entry of entries) {
      await PosEodRepo.save({
        location_id:      location_id ?? session.location_id,
        cashier_id:       session.pos_user_id,
        recon_date:       date ?? new Date().toISOString().slice(0, 10),
        payment_method:   entry.payment_method,
        expected_amount:  expected[entry.payment_method] ?? 0,
        counted_amount:   entry.counted_amount ?? null,
        opening_float:    entry.opening_float  ?? null,
        denomination_data: entry.denomination_data ?? null,
        notes:            entry.notes ?? null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POS EOD save error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
