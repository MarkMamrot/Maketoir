import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';
import bcrypt from 'bcryptjs';

// POST /api/pos/auth/pin-login
// Body: { user_id, pin, location_id }
// Verifies user's POS PIN and creates a pos_session cookie.
export async function POST(req: Request) {
  try {
    const { user_id, pin, location_id } = await req.json();

    if (!user_id || pin == null || !location_id) {
      return NextResponse.json(
        { error: 'user_id, pin, and location_id are required.' },
        { status: 400 },
      );
    }

    const users = await query<{
      id: number;
      name: string | null;
      username: string | null;
      email: string;
      pos_pin_hash: string | null;
    }>(
      'SELECT id, name, username, email, pos_pin_hash FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [Number(user_id)],
    );
    const user = users[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    if (!user.pos_pin_hash) {
      return NextResponse.json(
        { error: 'No POS PIN set for this user. Contact your manager.' },
        { status: 403 },
      );
    }

    const valid = await bcrypt.compare(String(pin), user.pos_pin_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect PIN.' }, { status: 403 });
    }

    // Fetch location name
    const locRows = await imsQuery<{ name: string }>(
      'SELECT name FROM ims_locations WHERE id = ? AND is_active = 1 LIMIT 1',
      [Number(location_id)],
    );
    const locationName = locRows[0]?.name ?? `Location ${location_id}`;

    const sessionData = {
      pos_user_id:   user.id,
      username:      user.username || user.email,
      full_name:     user.name || user.username || user.email,
      location_id:   Number(location_id),
      location_name: locationName,
    };

    cookies().set('pos_session', JSON.stringify(sessionData), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   60 * 60 * 16,
      path:     '/',
    });

    return NextResponse.json({ session: sessionData });
  } catch (err: any) {
    console.error('POS pin-login error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
