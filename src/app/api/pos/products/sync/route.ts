import { NextResponse } from 'next/server';
import { getAdminSession, getPosSession } from '@/lib/sessionUtils';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import { catalogueSync, CatalogueRequestError, parseCatalogueRequest } from '@/lib/pos/catalogueSync.server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const admin = getAdminSession();
  const pos = getPosSession();
  const session = admin ?? pos;
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const locationId = Number(new URL(request.url).searchParams.get('location_id'));
  if (!Number.isSafeInteger(locationId) || locationId <= 0) return NextResponse.json({ error: 'A valid location is required.' }, { status: 400 });
  if (!admin && pos?.location_id !== locationId) return NextResponse.json({ error: 'Not authorised for this location.' }, { status: 403 });
  try {
    await getImsSession(admin ? ['marketoir_session'] : ['pos_session']);
    let body: unknown;
    try { body = await request.json(); } catch { throw new CatalogueRequestError('Invalid JSON request.', 400); }
    const parsed = parseCatalogueRequest(body);
    const result = await runImsForBusiness(session.businessId, async () => {
      const connection = await getIMSPool().getConnection();
      try {
        const [locations] = await connection.query('SELECT id FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1', [session.businessId, locationId]);
        if (!Array.isArray(locations) || locations.length === 0) throw new CatalogueRequestError('Location not found.', 404);
        return await catalogueSync(connection, session.businessId, locationId, parsed);
      } finally { connection.release(); }
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CatalogueRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    await reportRuntimeIssue({ businessId: session.businessId, source: 'pos', operation: 'catalogue_sync', title: 'POS catalogue refresh failed', error, context: { locationId } });
    return NextResponse.json({ error: 'Catalogue refresh failed. Saved products remain available; try Sync again.' }, { status: 503 });
  }
}
