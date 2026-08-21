import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';
import { normalizeWholesaleLocationName, WholesaleLocationValidationError } from '@/lib/wholesale/wholesaleLocations';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';

function canManage(role: string) { return role === 'owner' || role === 'admin'; }

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (!canManage(session.memberRole)) return NextResponse.json({ error: 'Only company owners and admins can manage locations.' }, { status: 403 });
  return runImsForBusiness(session.businessId, async () => {
    try {
      const locations = await imsQuery<any>(
        `SELECT id, location_name, is_primary, status FROM ims_wholesale_company_locations
          WHERE business_id = ? AND company_id = ? AND status = 'active'
          ORDER BY is_primary DESC, location_name, id`,
        [session.businessId, session.companyId],
      );
      return NextResponse.json({ success: true, locations: locations.map(location => ({
        id: Number(location.id), name: location.location_name, isPrimary: Boolean(location.is_primary), status: location.status,
      })) });
    } catch (error) {
      await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: 'load_buying_locations', title: 'Wholesale buying locations could not be loaded', error, reference: { type: 'wholesale_company', id: session.companyId } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Buying locations could not be loaded.' }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (!canManage(session.memberRole)) return NextResponse.json({ error: 'Only company owners and admins can create locations.' }, { status: 403 });
  let name: string;
  try { name = normalizeWholesaleLocationName((await request.json()).name); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Enter a valid location name.' }, { status: 400 }); }

  return runImsForBusiness(session.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      const [result]: any = await connection.execute(
        `INSERT INTO ims_wholesale_company_locations (business_id, company_id, location_name, is_primary, status)
         VALUES (?, ?, ?, 0, 'active')`, [session.businessId, session.companyId, name],
      );
      const locationId = Number(result.insertId);
      await connection.execute(
        `INSERT INTO ims_wholesale_member_locations (business_id, company_id, member_id, location_id) VALUES (?, ?, ?, ?)`,
        [session.businessId, session.companyId, session.memberId, locationId],
      );
      await connection.execute(
        `INSERT INTO ims_wholesale_team_events
           (business_id, company_id, actor_member_id, actor_name, target_name, target_email, action, details_json)
         VALUES (?, ?, ?, ?, ?, '', 'location_created', ?)`,
        [session.businessId, session.companyId, session.memberId, session.name || session.email, name, JSON.stringify({ locationId })],
      );
      await connection.commit();
      return NextResponse.json({ success: true, location: { id: locationId, name, isPrimary: false } });
    } catch (error: any) {
      await connection.rollback().catch(() => {});
      if (error?.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'A location with that name already exists.' }, { status: 409 });
      await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: 'create_buying_location', title: 'Wholesale buying location could not be created', error, reference: { type: 'wholesale_company', id: session.companyId } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The buying location could not be created.' }, { status: 500 });
    } finally { connection.release(); }
  });
}