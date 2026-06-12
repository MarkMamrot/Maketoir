import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosUsersRepo } from '@/lib/db/PosRepository';
import { imsQuery } from '@/services/IMSMySQLService';

export async function POST(req: Request) {
  try {
    const { username, password, location_id } = await req.json();

    if (!username || !password || !location_id) {
      return NextResponse.json({ error: 'username, password and location_id are required.' }, { status: 400 });
    }

    const user = await PosUsersRepo.findByUsername(username);
    if (!user || !user.is_active) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    const valid = await PosUsersRepo.verifyPassword(user, password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // Check branch access
    if (user.branch_ids && !user.branch_ids.includes(Number(location_id))) {
      return NextResponse.json({ error: 'Not authorised for this location.' }, { status: 403 });
    }

    // Fetch location name
    const locations = await imsQuery<{ id: number; name: string }>(
      'SELECT id, name FROM ims_locations WHERE id = ? LIMIT 1',
      [location_id],
    );
    const locationName = locations[0]?.name ?? `Location ${location_id}`;

    const sessionData = {
      pos_user_id:   user.id,
      username:      user.username,
      full_name:     user.full_name ?? user.username,
      location_id:   Number(location_id),
      location_name: locationName,
    };

    cookies().set('pos_session', JSON.stringify(sessionData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 16, // 16-hour shift
      path: '/',
    });

    return NextResponse.json({ success: true, session: sessionData });
  } catch (err: any) {
    console.error('POS login error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
