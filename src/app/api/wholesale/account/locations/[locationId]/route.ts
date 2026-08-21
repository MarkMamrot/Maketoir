import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';
import { normalizeWholesaleLocationName } from '@/lib/wholesale/wholesaleLocations';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';

class LocationConflictError extends Error {}
function parseId(value: string) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function canManage(role: string) { return role === 'owner' || role === 'admin'; }

async function mutate(request: Request, locationId: number, action: 'rename' | 'archive') {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (!canManage(session.memberRole)) return NextResponse.json({ error: 'Only company owners and admins can manage locations.' }, { status: 403 });
  let name: string | null = null;
  if (action === 'rename') {
    try { name = normalizeWholesaleLocationName((await request.json()).name); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Enter a valid location name.' }, { status: 400 }); }
  }
  return runImsForBusiness(session.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows]: any = await connection.execute(
        `SELECT id, location_name, is_primary FROM ims_wholesale_company_locations
          WHERE id = ? AND business_id = ? AND company_id = ? AND status = 'active' FOR UPDATE`,
        [locationId, session.businessId, session.companyId],
      );
      const location = rows[0];
      if (!location) throw new LocationConflictError('Buying location not found.');
      if (action === 'archive') {
        if (locationId === session.locationId) throw new LocationConflictError('Switch to another buying location before archiving this one.');
        if (Number(location.is_primary) === 1) throw new LocationConflictError('The primary location cannot be archived.');
        const [drafts]: any = await connection.execute(
          `SELECT id FROM wholesale_draft_orders WHERE business_id = ? AND wholesale_company_id = ?
            AND wholesale_location_id = ? AND status = 'draft' LIMIT 1 FOR UPDATE`,
          [session.businessId, session.companyId, locationId],
        );
        if (drafts[0]) throw new LocationConflictError('This location still has an open draft order.');
        const [grants]: any = await connection.execute(
          `SELECT wm.id AS member_id, ml.location_id
             FROM ims_wholesale_company_members wm
             JOIN ims_wholesale_member_locations ml ON ml.member_id = wm.id AND ml.business_id = wm.business_id AND ml.company_id = wm.company_id
             JOIN ims_wholesale_company_locations wl ON wl.id = ml.location_id AND wl.business_id = ml.business_id AND wl.company_id = ml.company_id AND wl.status = 'active'
            WHERE wm.business_id = ? AND wm.company_id = ? AND wm.is_active = 1 FOR UPDATE`,
          [session.businessId, session.companyId],
        );
        const counts = new Map<number, number>();
        for (const grant of grants) counts.set(Number(grant.member_id), (counts.get(Number(grant.member_id)) || 0) + 1);
        if (grants.some((grant: any) => Number(grant.location_id) === locationId && counts.get(Number(grant.member_id)) === 1)) {
          throw new LocationConflictError('Every active member must retain at least one buying location.');
        }
        await connection.execute(`UPDATE ims_wholesale_company_locations SET status = 'archived' WHERE id = ? AND business_id = ? AND company_id = ?`, [locationId, session.businessId, session.companyId]);
      } else {
        await connection.execute(`UPDATE ims_wholesale_company_locations SET location_name = ? WHERE id = ? AND business_id = ? AND company_id = ?`, [name, locationId, session.businessId, session.companyId]);
      }
      await connection.execute(
        `INSERT INTO ims_wholesale_team_events
           (business_id, company_id, actor_member_id, actor_name, target_name, target_email, action, details_json)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
        [session.businessId, session.companyId, session.memberId, session.name || session.email, location.location_name,
          action === 'archive' ? 'location_archived' : 'location_renamed', JSON.stringify({ locationId, name })],
      );
      await connection.commit();
      return NextResponse.json({ success: true });
    } catch (error: any) {
      await connection.rollback().catch(() => {});
      if (error instanceof LocationConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
      if (error?.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'A location with that name already exists.' }, { status: 409 });
      await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: `${action}_buying_location`, title: 'Wholesale buying location could not be updated', error, reference: { type: 'wholesale_location', id: locationId } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The buying location could not be updated.' }, { status: 500 });
    } finally { connection.release(); }
  });
}

export async function PATCH(request: Request, { params }: { params: { locationId: string } }) {
  const id = parseId(params.locationId); return id ? mutate(request, id, 'rename') : NextResponse.json({ error: 'Invalid buying location.' }, { status: 400 });
}
export async function DELETE(request: Request, { params }: { params: { locationId: string } }) {
  const id = parseId(params.locationId); return id ? mutate(request, id, 'archive') : NextResponse.json({ error: 'Invalid buying location.' }, { status: 400 });
}