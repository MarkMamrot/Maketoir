import { cookies } from 'next/headers';
import type { AdminSession } from '@/lib/sessionUtils';
import { ADMIN_SESSION_MAX_AGE_SECONDS, signAdminSession } from '@/lib/auth/adminSessionToken';

export const ADMIN_SESSION_COOKIE = 'marketoir_session';
export const MFA_TRUST_COOKIE = 'marketoir_mfa_trust';

const secure = process.env.NODE_ENV === 'production';

export function setAdminSessionCookie(session: AdminSession): void {
  cookies().set(ADMIN_SESSION_COOKIE, signAdminSession(session, {
    maxAgeSeconds: ADMIN_SESSION_MAX_AGE_SECONDS,
  }), {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
}

export function clearAdminSessionCookie(): void {
  cookies().delete(ADMIN_SESSION_COOKIE);
}

export function getMfaTrustCookie(): string | null {
  return cookies().get(MFA_TRUST_COOKIE)?.value ?? null;
}

export function setMfaTrustCookie(token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  cookies().set(MFA_TRUST_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge,
    expires: expiresAt,
    path: '/',
  });
}

export function clearMfaTrustCookie(): void {
  cookies().delete(MFA_TRUST_COOKIE);
}