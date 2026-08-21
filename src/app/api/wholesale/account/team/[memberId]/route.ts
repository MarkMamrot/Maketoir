import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import { canRemoveWholesaleMember, normalizeWholesaleTeamRole, WholesaleTeamValidationError } from '@/lib/wholesale/wholesaleTeam';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

class TeamConflictError extends Error {}

function parseMemberId(value: string) {
  const memberId = Number(value);
  return Number.isSafeInteger(memberId) && memberId > 0 ? memberId : null;
}

async function mutateMember(input: {
  memberId: number;
  action: 'role_changed' | 'access_removed';
  nextRole?: 'owner' | 'admin' | 'buyer';
}) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (session.memberRole !== 'owner' && session.memberRole !== 'admin') {
    return NextResponse.json({ error: 'Only company owners and admins can manage the team.' }, { status: 403 });
  }
  if (input.memberId === session.memberId) {
    return NextResponse.json({ error: 'Use another account owner to change your own access.' }, { status: 409 });
  }

  return runImsForBusiness(session.businessId, async () => {
    try {
      const connection = await getIMSPool().getConnection();
      try {
        await connection.beginTransaction();
        const [rows]: any = await connection.execute(
          `SELECT m.id, m.contact_id, m.role, c.name, c.email
             FROM ims_wholesale_company_members m
             JOIN ims_contacts c ON c.id = m.contact_id AND c.business_id = m.business_id
            WHERE m.id = ? AND m.business_id = ? AND m.company_id = ? AND m.is_active = 1
            LIMIT 1 FOR UPDATE`,
          [input.memberId, session.businessId, session.companyId],
        );
        const target = rows[0];
        if (!target) throw new TeamConflictError('Team member not found.');
        if (input.action === 'role_changed' && session.memberRole !== 'owner') {
          throw new WholesaleTeamValidationError('Only an account owner can change roles.');
        }
        if (input.action === 'access_removed' && !canRemoveWholesaleMember(session.memberRole, target.role)) {
          throw new WholesaleTeamValidationError('You cannot remove that team member.');
        }
        if (target.role === 'owner' && (input.action === 'access_removed' || input.nextRole !== 'owner')) {
          const [owners]: any = await connection.execute(
            `SELECT id FROM ims_wholesale_company_members
              WHERE business_id = ? AND company_id = ? AND is_active = 1 AND role = 'owner'
              FOR UPDATE`,
            [session.businessId, session.companyId],
          );
          if (owners.length <= 1) throw new TeamConflictError('The account must keep at least one active owner.');
        }

        if (input.action === 'role_changed') {
          await connection.execute(
            `UPDATE ims_wholesale_company_members SET role = ?, updated_at = NOW()
              WHERE id = ? AND business_id = ? AND company_id = ? AND is_active = 1`,
            [input.nextRole, input.memberId, session.businessId, session.companyId],
          );
        } else {
          await connection.execute(
            `UPDATE ims_wholesale_company_members SET is_active = 0, updated_at = NOW()
              WHERE id = ? AND business_id = ? AND company_id = ? AND is_active = 1`,
            [input.memberId, session.businessId, session.companyId],
          );
        }
        await connection.execute(
          `INSERT INTO ims_wholesale_team_events
             (business_id, company_id, actor_member_id, actor_name, target_member_id, target_contact_id,
              target_name, target_email, action, before_role, after_role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [session.businessId, session.companyId, session.memberId, session.name || session.email,
            input.memberId, target.contact_id, target.name || target.email, String(target.email).toLowerCase(),
            input.action, target.role, input.action === 'role_changed' ? input.nextRole : null],
        );
        await connection.commit();
        return NextResponse.json({ success: true });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      if (error instanceof WholesaleTeamValidationError) return NextResponse.json({ error: error.message }, { status: 403 });
      if (error instanceof TeamConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
      await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: input.action, title: 'Wholesale team member update failed', error, reference: { type: 'wholesale_member', id: input.memberId } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The team member could not be updated.' }, { status: 500 });
    }
  });
}

export async function PATCH(request: Request, { params }: { params: { memberId: string } }) {
  const memberId = parseMemberId(params.memberId);
  if (!memberId) return NextResponse.json({ error: 'Invalid team member.' }, { status: 400 });
  try {
    const body = await request.json();
    return mutateMember({ memberId, action: 'role_changed', nextRole: normalizeWholesaleTeamRole(body.role) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Select a valid account role.' }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { memberId: string } }) {
  const memberId = parseMemberId(params.memberId);
  if (!memberId) return NextResponse.json({ error: 'Invalid team member.' }, { status: 400 });
  return mutateMember({ memberId, action: 'access_removed' });
}