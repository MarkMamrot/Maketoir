import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

export async function GET(req: Request) {
  // 1. Check for existing POS session (cashier login)
  const posRaw = cookies().get('pos_session')?.value;
  if (posRaw) {
    try {
      await getImsSession(['pos_session']);
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
  await getImsSession(['marketoir_session']);

  // Need location_id from the device config (passed as query param by the POS page)
  const { searchParams } = new URL(req.url);
  const locationId = parseInt(searchParams.get('location_id') ?? '0', 10);
  if (!locationId) return NextResponse.json({ session: null });

  // Fetch location name and businessId
  let locationName = `Location ${locationId}`;
  let locationBusinessId: string | null = adminSession.businessId ?? null;
  try {
    const rows = await imsQuery<{ name: string; business_id: string | null }>(
      'SELECT name, business_id FROM ims_locations WHERE id = ? AND business_id = ? LIMIT 1', [locationId, adminSession.businessId]
    );
    if (rows[0]) {
      locationName = rows[0].name;
      if (rows[0].business_id) locationBusinessId = rows[0].business_id;
    }
  } catch {}

  const sessionData = {
    pos_user_id:   0,   // 0 = admin-as-POS cashier
    username:      adminSession.email ?? 'admin',
    full_name:     adminSession.name  ?? adminSession.email ?? 'Admin',
    tier:          adminSession.tier  ?? 'SuperAdmin',
    location_id:   locationId,
    location_name: locationName,
    businessId:    locationBusinessId,
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
