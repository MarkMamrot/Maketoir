import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

// This endpoint is accessible to either admin or pos session users.
// Used by the POS device setup screen.
export async function GET() {
  const adminRaw = cookies().get('marketoir_session')?.value;
  const posRaw   = cookies().get('pos_session')?.value;

  if (!adminRaw && !posRaw) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  try {
    const rows = await imsQuery<{ id: number; name: string; code: string | null; is_active: number }>(
      'SELECT id, name, code, is_active FROM ims_locations WHERE is_active = 1 ORDER BY name',
    );
    return NextResponse.json({ locations: rows });
  } catch (err: any) {
    console.error('POS locations error:', err);
    return NextResponse.json({ locations: [] });
  }
}
