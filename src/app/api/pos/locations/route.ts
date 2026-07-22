import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// Returns active location names for the POS device setup dropdown.
// When called before any session exists (fresh device setup), falls back to
// the default IMS tenant so staff can complete setup without an admin login.
export async function GET() {
  const session = await getImsSession(['marketoir_session', 'pos_session']);
  try {
    let rows: { id: number; name: string; code: string | null; is_active: number }[];
    if (session?.businessId) {
      // Authenticated — scope to this business only.
      rows = await imsQuery<{ id: number; name: string; code: string | null; is_active: number }>(
        'SELECT id, name, code, is_active FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name',
        [session.businessId],
      );
    } else {
      // No session yet (device setup before first login). Use the env-default
      // IMS schema — safe for single-tenant deployments; multi-tenant deployments
      // should reach this endpoint via a /pos?b=<businessId> link that pre-seeds
      // a session via the auth/me endpoint.
      rows = await imsQuery<{ id: number; name: string; code: string | null; is_active: number }>(
        'SELECT id, name, code, is_active FROM ims_locations WHERE is_active = 1 ORDER BY name',
        [],
      );
    }
    return NextResponse.json({ locations: rows });
  } catch (err: any) {
    console.error('POS locations error:', err);
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 });
  }
}
