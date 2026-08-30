import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { setAdminSessionCookie } from '@/lib/auth/adminAuthCookies';
import { verifyAdminSessionDetails } from '@/lib/auth/adminSessionToken';
import { findAccessibleBusiness, resolveActorBusinessAccess } from '@/lib/auth/businessAccess';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { AdminSession } from '@/lib/sessionUtils';
import { execute } from '@/services/MySQLService';

export async function POST(request: Request) {
  const raw = cookies().get('marketoir_session')?.value;
  const verified = raw ? verifyAdminSessionDetails<AdminSession>(raw) : null;
  if (!verified) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let requestedBusinessId = '';
  try {
    requestedBusinessId = String((await request.json())?.businessId ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'A valid business is required.' }, { status: 400 });
  }
  if (!requestedBusinessId) {
    return NextResponse.json({ error: 'A valid business is required.' }, { status: 400 });
  }

  try {
    const access = await resolveActorBusinessAccess(verified.data.userId);
    if (!access) return NextResponse.json({ error: 'Account not found.' }, { status: 403 });
    if (access.actor.tier !== 'SuperAdmin') {
      return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
    }

    const target = findAccessibleBusiness(access.businesses, requestedBusinessId);
    if (!target) return NextResponse.json({ error: 'Business is not available.' }, { status: 404 });

    const nowSeconds = Math.floor(Date.now() / 1000);
    const remainingSeconds = verified.expiresAt - nowSeconds;
    if (remainingSeconds <= 0) {
      return NextResponse.json({ error: 'Session expired.' }, { status: 401 });
    }

    if (verified.data.businessId !== target.businessId) {
      await execute(
        `INSERT INTO super_admin_business_context_events
           (actor_user_id, previous_business_id, target_business_id)
         VALUES (?, ?, ?)`,
        [verified.data.userId, verified.data.businessId || null, target.businessId],
      );
    }

    const session: AdminSession = {
      ...verified.data,
      name: access.actor.name ?? verified.data.name,
      company: target.name,
      email: access.actor.email,
      role: access.actor.role,
      tier: 'SuperAdmin',
      userId: access.actor.id,
      businessId: target.businessId,
    };
    setAdminSessionCookie(session, remainingSeconds);

    return NextResponse.json({ success: true, activeBusiness: target });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: verified.data.businessId || undefined,
      source: 'auth',
      operation: 'super_admin_business_context_switch',
      severity: 'error',
      title: 'SuperAdmin business switch failed',
      error,
      context: {
        actorUserId: verified.data.userId,
        requestedBusinessId,
      },
    }).catch(() => null);
    return NextResponse.json({ error: 'Business could not be selected.' }, { status: 500 });
  }
}