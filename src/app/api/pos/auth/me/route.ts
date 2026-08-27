import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { getAdminSession, getPosSession } from '@/lib/sessionUtils';

export async function GET(req: Request) {
  try {
  const { searchParams } = new URL(req.url);
  const locationId = parseInt(searchParams.get('location_id') ?? '0', 10);
  const deviceBusinessId = searchParams.get('business_id') ?? '';
  const adminSession = getAdminSession();
  const posSession = getPosSession();

  // A signed back-office session is authoritative. A POS cookie may belong to
  // another business previously used in this browser.
  if (adminSession) {
    if (deviceBusinessId && deviceBusinessId !== adminSession.businessId) {
      cookies().set('pos_session', '', { maxAge: 0, path: '/' });
      return NextResponse.json({ session: null, device_mismatch: true });
    }
    if (!locationId) return NextResponse.json({ session: null });

    await getImsSession(['marketoir_session']);
    const rows = await imsQuery<{ name: string; business_id: string | null }>(
      'SELECT name, business_id FROM ims_locations WHERE id = ? AND business_id = ? LIMIT 1',
      [locationId, adminSession.businessId],
    );
    if (!rows[0]) {
      cookies().set('pos_session', '', { maxAge: 0, path: '/' });
      return NextResponse.json({ session: null, device_mismatch: true });
    }

    const sessionData = {
      pos_user_id:   0,
      username:      adminSession.email ?? 'admin',
      full_name:     adminSession.name  ?? adminSession.email ?? 'Admin',
      tier:          adminSession.tier  ?? 'SuperAdmin',
      location_id:   locationId,
      location_name: rows[0].name,
      businessId:    adminSession.businessId,
    };

    cookies().set('pos_session', JSON.stringify(sessionData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 16,
      path: '/',
    });

    return NextResponse.json({ session: sessionData });
  }

  if (posSession) {
    const matchesDevice =
      (!deviceBusinessId || posSession.businessId === deviceBusinessId) &&
      (!locationId || posSession.location_id === locationId);
    if (!matchesDevice) {
      cookies().set('pos_session', '', { maxAge: 0, path: '/' });
      return NextResponse.json({ session: null, device_mismatch: true });
    }
    await getImsSession(['pos_session']);
    return NextResponse.json({ session: posSession });
  }

  return NextResponse.json({ session: null });
  } catch {
    return NextResponse.json({ session: null });
  }
}
