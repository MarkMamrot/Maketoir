import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// POST /api/pos/setup/verify
// Verifies a location PIN before device setup.
// Accessible without a session — device setup happens before any login.
// Security is the location PIN itself; if no PIN is set, setup is open.
export async function POST(req: Request) {
  const session = await getImsSession(['marketoir_session', 'pos_session']);

  try {
    const { location_id, pin } = await req.json();
    if (!location_id) {
      return NextResponse.json({ success: false, error: 'location_id is required.' }, { status: 400 });
    }

    let rows: { id: number; name: string; pos_pin: string | null }[];
    if (session?.businessId) {
      // Authenticated — scope to this business only.
      rows = await imsQuery<{ id: number; name: string; pos_pin: string | null }>(
        'SELECT id, name, pos_pin FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
        [Number(location_id), session.businessId],
      );
    } else {
      // No session (fresh device setup) — use env-default tenant.
      rows = await imsQuery<{ id: number; name: string; pos_pin: string | null }>(
        'SELECT id, name, pos_pin FROM ims_locations WHERE id = ? AND is_active = 1 LIMIT 1',
        [Number(location_id)],
      );
    }

    if (!rows[0]) {
      return NextResponse.json({ success: false, error: 'Location not found.' }, { status: 404 });
    }

    const loc = rows[0];

    // If no PIN set for this location, allow setup without PIN
    if (!loc.pos_pin) {
      return NextResponse.json({ success: true, location_name: loc.name });
    }

    // Verify PIN
    if (String(pin ?? '').trim() !== String(loc.pos_pin).trim()) {
      return NextResponse.json({ success: false, error: 'Incorrect PIN.' }, { status: 403 });
    }

    return NextResponse.json({ success: true, location_name: loc.name });
  } catch (e: any) {
    console.error('POS setup verify error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
