import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';

// POST /api/pos/setup/verify
// Public endpoint — verifies a location PIN before device setup.
// If the location has no pos_pin set, any (or no) PIN is accepted.
export async function POST(req: Request) {
  try {
    const { location_id, pin } = await req.json();
    if (!location_id) {
      return NextResponse.json({ success: false, error: 'location_id is required.' }, { status: 400 });
    }

    const rows = await imsQuery<{ id: number; name: string; pos_pin: string | null }>(
      'SELECT id, name, pos_pin FROM ims_locations WHERE id = ? AND is_active = 1 LIMIT 1',
      [Number(location_id)],
    );

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
