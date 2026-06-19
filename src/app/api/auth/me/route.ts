import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { UsersRepository } from '@/lib/db/UsersRepository';

/**
 * GET /api/auth/me
 * Validates that the current session cookie user still exists and is not deleted.
 * Returns 401 if the session is invalid/expired, 403 if the user was deleted.
 * The frontend should call this on app init and redirect to /login on error.
 */
export async function GET() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let sessionUser: { userId?: number; email?: string; userSpreadsheetId?: string };
  try {
    sessionUser = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  if (!sessionUser.userId) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  const dbUser = await UsersRepository.findById(sessionUser.userId).catch(() => null);
  if (!dbUser) {
    // User was deleted after login — clear the stale cookie
    cookies().set('marketoir_session', '', { maxAge: 0, path: '/' });
    return NextResponse.json({ error: 'Account not found. Please log in again.' }, { status: 403 });
  }

  return NextResponse.json({
    valid: true,
    user: {
      name:              dbUser.name ?? '',
      company:           dbUser.company ?? '',
      email:             dbUser.email,
      userSpreadsheetId: dbUser.business_id ?? '',
      role:              dbUser.role,
      tier:              dbUser.tier,
      userId:            dbUser.id,
    },
  });
}
