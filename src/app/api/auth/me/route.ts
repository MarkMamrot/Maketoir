import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { getAdminSession } from '@/lib/sessionUtils';
import { findAccessibleBusiness, getAccessibleBusinesses } from '@/lib/auth/businessAccess';

/**
 * GET /api/auth/me
 * Validates that the current session cookie user still exists and is not deleted.
 * Returns 401 if the session is invalid/expired, 403 if the user was deleted.
 * The frontend should call this on app init and redirect to /login on error.
 */
export async function GET() {
  const sessionUser = getAdminSession();
  if (!sessionUser) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  const dbUser = await UsersRepository.findById(sessionUser.userId).catch(() => null);
  if (!dbUser) {
    // User was deleted after login — clear the stale cookie
    cookies().set('marketoir_session', '', { maxAge: 0, path: '/' });
    return NextResponse.json({ error: 'Account not found. Please log in again.' }, { status: 403 });
  }

  const activeBusiness = findAccessibleBusiness(
    await getAccessibleBusinesses(dbUser),
    sessionUser.businessId,
  );
  if (!activeBusiness) {
    cookies().set('marketoir_session', '', { maxAge: 0, path: '/' });
    return NextResponse.json({ error: 'Business access is no longer available. Please log in again.' }, { status: 403 });
  }

  return NextResponse.json({
    valid: true,
    user: {
      name:              dbUser.name ?? '',
      company:           activeBusiness.name,
      email:             dbUser.email,
      businessId:        activeBusiness.businessId,
      role:              dbUser.role,
      tier:              dbUser.tier,
      userId:            dbUser.id,
      hasForesight:      activeBusiness.hasForesight,
      activeBusiness,
    },
  });
}
