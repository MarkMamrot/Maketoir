import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';
import { sendPasswordSetupEmail } from '@/lib/auth/passwordSetupEmail';
import { recordAuthEvent } from '@/lib/auth/authActivity';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

interface ManagedUser {
  id: number;
  email: string;
  name: string | null;
}

async function getManagedUser(userId: number, businessId: string): Promise<ManagedUser | null> {
  const rows = await query<ManagedUser>(
    `SELECT u.id, u.email, u.name
       FROM user_business_memberships m
       JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
      WHERE m.user_id = ? AND m.business_id = ? AND m.deleted_at IS NULL
      LIMIT 1`,
    [userId, businessId],
  );
  return rows[0] ?? null;
}

function getAdminContext() {
  const session = getAdminSession();
  if (!session) return { error: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) };
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return { error: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }) };
  }
  if (!session.businessId) return { error: NextResponse.json({ error: 'No active business.' }, { status: 400 }) };
  return { session };
}

export async function GET(_req: Request, context: { params: { userId: string } }) {
  const auth = getAdminContext();
  if ('error' in auth) return auth.error;
  const userId = Number(context.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'Invalid user ID.' }, { status: 400 });
  }

  try {
    const managedUser = await getManagedUser(userId, auth.session.businessId);
    if (!managedUser) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    const events = await query(
      `SELECT e.id, e.event_type, e.ip_address, e.city, e.region, e.country,
              e.user_agent, e.created_at, actor.name AS actor_name, actor.email AS actor_email
         FROM user_auth_events e
         LEFT JOIN users actor ON actor.id = e.actor_user_id
        WHERE e.user_id = ?
          AND e.created_at >= DATE_SUB(NOW(3), INTERVAL 90 DAY)
          AND e.business_id = ?
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 250`,
      [userId, auth.session.businessId],
    );
    return NextResponse.json({ success: true, user: managedUser, events });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.session.businessId,
      source: 'admin.users',
      operation: 'read_auth_activity',
      title: 'User authentication activity could not be loaded',
      error,
      context: { userId },
      reference: { type: 'user', id: userId },
    });
    return NextResponse.json({ error: 'Failed to load authentication activity.' }, { status: 500 });
  }
}

export async function POST(req: Request, context: { params: { userId: string } }) {
  const auth = getAdminContext();
  if ('error' in auth) return auth.error;
  const userId = Number(context.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'Invalid user ID.' }, { status: 400 });
  }

  try {
    const managedUser = await getManagedUser(userId, auth.session.businessId);
    if (!managedUser) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    await sendPasswordSetupEmail({
      userId,
      email: managedUser.email,
      name: managedUser.name,
      businessId: auth.session.businessId,
      purpose: 'reset',
    });
    await recordAuthEvent({
      userId,
      businessId: auth.session.businessId,
      eventType: 'password_reset_requested',
      actorUserId: auth.session.userId,
      request: req,
    });
    return NextResponse.json({ success: true, message: `Password reset email sent to ${managedUser.email}.` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send password reset email.' },
      { status: 500 },
    );
  }
}