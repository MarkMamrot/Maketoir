import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';
import { checkRateLimit, registerFailure, clearRateLimit } from '@/lib/posRateLimit';
import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
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

    // Rate limit by user + location to slow PIN brute-forcing.
    const rlKey = `${location_id}:${user_id}`;
    const rl = checkRateLimit(rlKey);
    if (rl.locked) {
      return NextResponse.json(
        { error: `Too many incorrect attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).` },
        { status: 429 },
      );
    }

    const users = await query<{
      id: number;
      name: string | null;
      username: string | null;
      email: string;
      business_id: string | null;
      pos_pin_hash: string | null;
      tier: string | null;
    }>(
      'SELECT id, name, username, email, business_id, pos_pin_hash, tier FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [Number(user_id)],
    );
    const user = users[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    if (!user.business_id) {
      return NextResponse.json({ error: 'User is not assigned to a business.' }, { status: 403 });
    }
    // No session cookie exists yet during login — resolve the tenant schema
    // explicitly and pass it to the query (fail closed if unmapped).
    const imsDb = await getImsDbNameStrict(user.business_id);
    if (!imsDb) {
      return NextResponse.json({ error: 'Business has no IMS database assigned.' }, { status: 403 });
    }

    // Resolve the location's business so we can confirm the user belongs to it.
    const locInfo = await imsQuery<{ name: string; business_id: string | null }>(
      'SELECT name, business_id FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
      [Number(location_id), user.business_id],
      imsDb,
    );
    if (!locInfo[0]) {
      return NextResponse.json({ error: 'Location not found.' }, { status: 404 });
    }
    const locationBusinessId = locInfo[0].business_id;
    const locationName = locInfo[0].name ?? `Location ${location_id}`;
    // Authorisation: the user must belong to the same business as the location.
    if (locationBusinessId && user.business_id && user.business_id !== locationBusinessId) {
      return NextResponse.json(
        { error: 'This user is not authorised for this location.' },
        { status: 403 },
      );
    }
    if (!user.pos_pin_hash) {
      return NextResponse.json(
        { error: 'No POS PIN set for this user. Contact your manager.' },
        { status: 403 },
      );
    }

    const valid = await bcrypt.compare(String(pin), user.pos_pin_hash);
    if (!valid) {
      const after = registerFailure(rlKey);
      const msg = after.locked
        ? `Too many incorrect attempts. Try again in ${Math.ceil(after.retryAfterSec / 60)} minute(s).`
        : 'Incorrect PIN.';
      return NextResponse.json({ error: msg }, { status: after.locked ? 429 : 403 });
    }

    clearRateLimit(rlKey);

    const sessionData = {
      pos_user_id:   user.id,
      username:      user.username || user.email,
      full_name:     user.name || user.username || user.email,
      location_id:   Number(location_id),
      location_name: locationName,
      tier:          user.tier ?? 'PosUser',
      businessId:    locationBusinessId ?? user.business_id ?? null,
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
