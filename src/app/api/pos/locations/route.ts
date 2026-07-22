import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// Returns active locations for the signed-in business (admin/POS session
// required). Device setup uses this for the admin-shortcut path (already
// logged in via marketoir_session). Otherwise enrol via POST /api/pos/setup/by-code.
export async function GET() {
  const session = await getImsSession(['marketoir_session', 'pos_session']);
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  try {
    const rows = await imsQuery<{ id: number; name: string; code: string | null; is_active: number }>(
      'SELECT id, name, code, is_active FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name',
      [session.businessId],
    );
    // Include business_id so DeviceSetup can populate DeviceConfig without a
    // separate round-trip when an admin is already signed in.
    return NextResponse.json({ locations: rows, business_id: session.businessId });
  } catch (err: any) {
    console.error('POS locations error:', err);
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 });
  }
}
