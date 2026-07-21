import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// Returns location names for device setup dropdown after a business session is known.
export async function GET() {
  const session = await getImsSession(['marketoir_session', 'pos_session']);
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  try {
    const rows = await imsQuery<{ id: number; name: string; code: string | null; is_active: number }>(
      'SELECT id, name, code, is_active FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name',
      [session.businessId],
    );
    return NextResponse.json({ locations: rows });
  } catch (err: any) {
    console.error('POS locations error:', err);
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 });
  }
}
