import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';
import { normalizeWholesaleLocationIds, WholesaleLocationValidationError } from '@/lib/wholesale/wholesaleLocations';
import { canRemoveWholesaleMember } from '@/lib/wholesale/wholesaleTeam';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';

class AssignmentConflictError extends Error {}
class AssignmentPermissionError extends Error {}

export async function PUT(request: Request, { params }: { params: { memberId: string } }) {
  const memberId = Number(params.memberId);
  if (!Number.isSafeInteger(memberId) || memberId <= 0) return NextResponse.json({ error: 'Invalid team member.' }, { status: 400 });
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (session.memberRole !== 'owner' && session.memberRole !== 'admin') return NextResponse.json({ error: 'Only company owners and admins can assign locations.' }, { status: 403 });
  if (memberId === session.memberId) return NextResponse.json({ error: 'Use another account owner to change your own locations.' }, { status: 409 });
  let locationIds: number[];
  let defaultLocationId: number;
  try {
    const body = await request.json();
    locationIds = normalizeWholesaleLocationIds(body.locationIds);
    defaultLocationId = Number(body.defaultLocationId);
    if (!locationIds.includes(defaultLocationId)) throw new WholesaleLocationValidationError('The default must be one of the assigned locations.');
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Select valid buying locations.' }, { status: 400 }); }

  return runImsForBusiness(session.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      const [members]: any = await connection.execute(
        `SELECT m.id, m.contact_id, m.role, c.name, c.email FROM ims_wholesale_company_members m
          JOIN ims_contacts c ON c.id = m.contact_id AND c.business_id = m.business_id
          WHERE m.id = ? AND m.business_id = ? AND m.company_id = ? AND m.is_active = 1 FOR UPDATE`,
        [memberId, session.businessId, session.companyId],
      );
      const target = members[0];
      if (!target) throw new AssignmentConflictError('Team member not found.');
      if (!canRemoveWholesaleMember(session.memberRole, target.role)) throw new AssignmentPermissionError('You cannot change locations for that team member.');
      const placeholders = locationIds.map(() => '?').join(',');
      const [locations]: any = await connection.execute(
        `SELECT id FROM ims_wholesale_company_locations WHERE business_id = ? AND company_id = ? AND status = 'active' AND id IN (${placeholders}) FOR UPDATE`,
        [session.businessId, session.companyId, ...locationIds],
      );
      if (locations.length !== locationIds.length) throw new AssignmentConflictError('One or more buying locations are no longer available.');
      const [previous]: any = await connection.execute(
        `SELECT location_id FROM ims_wholesale_member_locations WHERE business_id = ? AND company_id = ? AND member_id = ? FOR UPDATE`,
        [session.businessId, session.companyId, memberId],
      );
      await connection.execute(`DELETE FROM ims_wholesale_member_locations WHERE business_id = ? AND company_id = ? AND member_id = ?`, [session.businessId, session.companyId, memberId]);
      const values = locationIds.map(() => '(?, ?, ?, ?)').join(',');
      await connection.execute(
        `INSERT INTO ims_wholesale_member_locations (business_id, company_id, member_id, location_id) VALUES ${values}`,
        locationIds.flatMap(locationId => [session.businessId, session.companyId, memberId, locationId]),
      );
      await connection.execute(`UPDATE ims_wholesale_company_members SET location_id = ? WHERE id = ? AND business_id = ? AND company_id = ?`, [defaultLocationId, memberId, session.businessId, session.companyId]);
      await connection.execute(
        `INSERT INTO ims_wholesale_team_events
           (business_id, company_id, actor_member_id, actor_name, target_member_id, target_contact_id, target_name, target_email, action, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'locations_changed', ?)`,
        [session.businessId, session.companyId, session.memberId, session.name || session.email, memberId, target.contact_id,
          target.name || target.email, String(target.email).toLowerCase(), JSON.stringify({ before: previous.map((row: any) => Number(row.location_id)), after: locationIds, defaultLocationId })],
      );
      await connection.commit();
      return NextResponse.json({ success: true });
    } catch (error) {
      await connection.rollback().catch(() => {});
      if (error instanceof AssignmentPermissionError) return NextResponse.json({ error: error.message }, { status: 403 });
      if (error instanceof AssignmentConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
      await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: 'assign_buying_locations', title: 'Wholesale member locations could not be assigned', error, reference: { type: 'wholesale_member', id: memberId } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Buying locations could not be assigned.' }, { status: 500 });
    } finally { connection.release(); }
  });
}