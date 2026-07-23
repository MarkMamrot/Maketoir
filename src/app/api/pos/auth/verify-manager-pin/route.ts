import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getImsSession } from '@/lib/auth/imsSession';
import { verifyManagerPin } from '@/lib/pos/managerPin';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// POST /api/pos/auth/verify-manager-pin
// Body: { location_id, pin }
// Verifies the per-location manager PIN (set in IMS → Locations → Edit Location).
// Used to gate editing/deleting past POS transactions in the current open
// register session. The edit/delete endpoints themselves independently
// re-verify the PIN — this endpoint just gives the UI fast feedback before
// unlocking the edit screen.
export async function POST(req: Request) {
  if (!getPosSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  try {
    const { location_id, pin } = await req.json();
    if (!location_id) {
      return NextResponse.json({ error: 'location_id is required.' }, { status: 400 });
    }

    const result = await verifyManagerPin(Number(location_id), pin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('verify-manager-pin error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
