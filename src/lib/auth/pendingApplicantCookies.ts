/**
 * A short-lived, narrowly-scoped session for a user who has registered but is
 * not yet enrolled in any business. It intentionally carries NO businessId and
 * NO tier — it must never be usable to access IMS/POS/Dashboard. It exists
 * only so the new-business application form and the pending-approval page can
 * identify who is submitting/checking an application.
 */
import { cookies } from 'next/headers';
import { signAdminSession, verifyAdminSessionDetails } from '@/lib/auth/adminSessionToken';

export const PENDING_APPLICANT_COOKIE = 'marketoir_pending';
const PENDING_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

export interface PendingApplicantSession {
  userId: number;
  name: string;
  email: string;
}

export function setPendingApplicantCookie(session: PendingApplicantSession): void {
  cookies().set(
    PENDING_APPLICANT_COOKIE,
    signAdminSession(session, { maxAgeSeconds: PENDING_SESSION_MAX_AGE_SECONDS }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: PENDING_SESSION_MAX_AGE_SECONDS,
      path: '/',
    },
  );
}

export function getPendingApplicantSession(): PendingApplicantSession | null {
  const raw = cookies().get(PENDING_APPLICANT_COOKIE)?.value;
  if (!raw) return null;
  const verified = verifyAdminSessionDetails<PendingApplicantSession>(raw);
  return verified?.data ?? null;
}

export function clearPendingApplicantCookie(): void {
  cookies().delete(PENDING_APPLICANT_COOKIE);
}
