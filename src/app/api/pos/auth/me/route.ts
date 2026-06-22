import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET(req: Request) {
  // 1. Check for existing POS session (cashier login)
  const posRaw = cookies().get('pos_session')?.value;
  if (posRaw) {
    try {
      const session = JSON.parse(posRaw);
      return NextResponse.json({ session });
    } catch {}
  }

  // 2. Fallback: check for admin session (marketoir_session)
  //    Admins who arrive at /pos via the main login page bypass the POS cashier login.
  const adminRaw = cookies().get('marketoir_session')?.value;
  if (!adminRaw) return NextResponse.json({ session: null });

  let adminSession: any;
  try { adminSession = JSON.parse(adminRaw); } catch { return NextResponse.json({ session: null }); }

  // Need location_id from the device config (passed as query param by the POS page)
  const { searchParams } = new URL(req.url);
  const locationId = parseInt(searchParams.get('location_id') ?? '0', 10);
  if (!locationId) return NextResponse.json({ session: null });

  // Fetch location name
  let locationName = `Location ${locationId}`;
  try {
    const rows = await imsQuery<{ name: string }>(
      'SELECT name FROM ims_locations WHERE id = ? LIMIT 1', [locationId]
    );
    if (rows[0]) locationName = rows[0].name;
  } catch {}

  const sessionData = {
    pos_user_id:   0,   // 0 = admin-as-POS cashier
    username:      adminSession.email ?? 'admin',
    full_name:     adminSession.name  ?? adminSession.email ?? 'Admin',
    location_id:   locationId,
    location_name: locationName,
  };

  // Set pos_session cookie so subsequent requests don't need this fallback
  cookies().set('pos_session', JSON.stringify(sessionData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 16,
    path: '/',
  });

  return NextResponse.json({ session: sessionData });
}
