import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';
import {
  canInviteWholesaleRole,
  normalizeWholesaleTeamEmail,
  normalizeWholesaleTeamRole,
  WholesaleTeamValidationError,
} from '@/lib/wholesale/wholesaleTeam';
import { sendWholesaleTeamAccessEmail } from '@/lib/wholesale/wholesaleTeamNotifications';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

class TeamConflictError extends Error {}

function canManage(role: string) {
  return role === 'owner' || role === 'admin';
}

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (!canManage(session.memberRole)) return NextResponse.json({ error: 'Only company owners and admins can manage the team.' }, { status: 403 });

  return runImsForBusiness(session.businessId, async () => {
    try {
      const [members, events] = await Promise.all([
        imsQuery<any>(
            `SELECT m.id, m.contact_id, m.role, m.location_id, m.created_at,
              c.name, c.email, l.location_name,
              (SELECT GROUP_CONCAT(ml.location_id ORDER BY ml.location_id)
                 FROM ims_wholesale_member_locations ml
                WHERE ml.business_id = m.business_id AND ml.company_id = m.company_id AND ml.member_id = m.id) AS location_ids
             FROM ims_wholesale_company_members m
             JOIN ims_contacts c ON c.id = m.contact_id AND c.business_id = m.business_id
             JOIN ims_wholesale_company_locations l
               ON l.id = m.location_id AND l.company_id = m.company_id AND l.business_id = m.business_id
            WHERE m.business_id = ? AND m.company_id = ? AND m.is_active = 1
            ORDER BY FIELD(m.role, 'owner', 'admin', 'buyer'), c.name, m.id`,
          [session.businessId, session.companyId],
        ),
        imsQuery<any>(
          `SELECT id, actor_name, target_name, target_email, action, before_role, after_role, details_json, created_at
             FROM ims_wholesale_team_events
            WHERE business_id = ? AND company_id = ?
            ORDER BY created_at DESC, id DESC LIMIT 25`,
          [session.businessId, session.companyId],
        ),
      ]);
      return NextResponse.json({
        success: true,
        members: members.map(member => ({
          id: Number(member.id), contactId: Number(member.contact_id), name: member.name || member.email,
          email: member.email, role: member.role, locationId: Number(member.location_id),
          locationName: member.location_name, isCurrent: Number(member.id) === session.memberId,
          locationIds: String(member.location_ids || '').split(',').map(Number).filter(Number.isSafeInteger),
        })),
        events: events.map(event => ({
          id: Number(event.id), actorName: event.actor_name, targetName: event.target_name,
          targetEmail: event.target_email, action: event.action, beforeRole: event.before_role,
          afterRole: event.after_role, createdAt: event.created_at,
          details: typeof event.details_json === 'string' ? JSON.parse(event.details_json) : event.details_json,
        })),
      });
    } catch (error) {
      await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: 'load_account_team', title: 'Wholesale account team could not be loaded', error, reference: { type: 'wholesale_company', id: session.companyId } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The account team could not be loaded.' }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (!canManage(session.memberRole)) return NextResponse.json({ error: 'Only company owners and admins can invite team members.' }, { status: 403 });

  return runImsForBusiness(session.businessId, async () => {
    try {
      const body = await request.json();
      const email = normalizeWholesaleTeamEmail(body.email);
      const role = normalizeWholesaleTeamRole(body.role);
      if (!canInviteWholesaleRole(session.memberRole, role)) throw new WholesaleTeamValidationError('You cannot grant that account role.');

      const connection = await getIMSPool().getConnection();
      let eventId = 0;
      let memberId = 0;
      let targetName = '';
      try {
        await connection.beginTransaction();
        const [contacts]: any = await connection.execute(
          `SELECT id, name, email FROM ims_contacts
            WHERE business_id = ? AND LOWER(email) = ? AND is_active = 1
              AND type IN ('b2b_customer','both') AND LOWER(COALESCE(price_tier,'')) = 'wholesale'
            LIMIT 1 FOR UPDATE`,
          [session.businessId, email],
        );
        const contact = contacts[0];
        if (!contact) throw new TeamConflictError('No active approved wholesale contact matches that email.');
        targetName = String(contact.name || contact.email);

        const [memberships]: any = await connection.execute(
          `SELECT id, company_id, is_active FROM ims_wholesale_company_members
            WHERE business_id = ? AND contact_id = ? FOR UPDATE`,
          [session.businessId, contact.id],
        );
        if (memberships.some((membership: any) => Number(membership.is_active) === 1)) {
          throw new TeamConflictError('That contact already belongs to an active wholesale account.');
        }
        const reusable = memberships.find((membership: any) => Number(membership.company_id) === session.companyId);
        if (reusable) {
          await connection.execute(
            `UPDATE ims_wholesale_company_members
                SET location_id = ?, role = ?, is_active = 1, updated_at = NOW()
              WHERE id = ? AND business_id = ? AND company_id = ?`,
            [session.locationId, role, reusable.id, session.businessId, session.companyId],
          );
          memberId = Number(reusable.id);
        } else {
          const [result]: any = await connection.execute(
            `INSERT INTO ims_wholesale_company_members
               (business_id, company_id, location_id, contact_id, role, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [session.businessId, session.companyId, session.locationId, contact.id, role],
          );
          memberId = Number(result.insertId);
        }
        await connection.execute(
          `INSERT IGNORE INTO ims_wholesale_member_locations (business_id, company_id, member_id, location_id)
           VALUES (?, ?, ?, ?)`,
          [session.businessId, session.companyId, memberId, session.locationId],
        );
        const [eventResult]: any = await connection.execute(
          `INSERT INTO ims_wholesale_team_events
             (business_id, company_id, actor_member_id, actor_name, target_member_id, target_contact_id,
              target_name, target_email, action, before_role, after_role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'access_granted', NULL, ?)`,
          [session.businessId, session.companyId, session.memberId, session.name || session.email,
            memberId, contact.id, targetName, String(contact.email).toLowerCase(), role],
        );
        eventId = Number(eventResult.insertId);
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }

      const emailResult = await sendWholesaleTeamAccessEmail({
        eventId, businessId: session.businessId, email, name: targetName,
        companyName: session.company, supplierSlug: session.supplierSlug || '', role,
      }).catch(async error => {
        await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: 'send_team_access_email', title: 'Wholesale team access email could not be sent', error, reference: { type: 'wholesale_team_event', id: eventId } }).catch(() => {});
        return { sent: false as const, reason: 'delivery_failed' as const };
      });
      return NextResponse.json({ success: true, memberId, emailSent: emailResult.sent });
    } catch (error) {
      if (error instanceof WholesaleTeamValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
      if (error instanceof TeamConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
      await reportRuntimeIssue({ businessId: session.businessId, source: 'wholesale_portal', operation: 'invite_account_member', title: 'Wholesale account member could not be invited', error, reference: { type: 'wholesale_company', id: session.companyId } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The team member could not be added.' }, { status: 500 });
    }
  });
}