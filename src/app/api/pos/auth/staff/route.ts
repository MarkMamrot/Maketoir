import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';

// GET /api/pos/auth/staff?location_id=X
// Public — returns user list for POS PIN login screen.
// Only returns id, name, has_pos_pin — no sensitive data.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const locationId = parseInt(searchParams.get('location_id') ?? '0', 10);
    if (!locationId) {
      return NextResponse.json({ error: 'location_id required' }, { status: 400 });
    }

    // Get business_id from location
    const locRows = await imsQuery<{ business_id: string | null }>(
      'SELECT business_id FROM ims_locations WHERE id = ? AND is_active = 1 LIMIT 1',
      [locationId],
    );
    if (!locRows[0]) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    const businessId = locRows[0].business_id;

    const users = await query<{ id: number; name: string | null; username: string | null; pos_pin_hash: string | null }>(
      businessId
        ? `SELECT id, name, username, pos_pin_hash FROM users WHERE business_id = ? AND deleted_at IS NULL ORDER BY name`
        : `SELECT id, name, username, pos_pin_hash FROM users WHERE deleted_at IS NULL ORDER BY name`,
      businessId ? [businessId] : [],
    );

    return NextResponse.json({
      users: users.map(u => ({
        id:          u.id,
        name:        u.name || u.username || `User ${u.id}`,
        has_pos_pin: !!u.pos_pin_hash,
      })),
    });
  } catch (err: any) {
    console.error('POS staff list error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
