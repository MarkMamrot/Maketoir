import { NextResponse } from 'next/server';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { primeImsDbMap } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  clearAdminSessionCookie,
  clearMfaTrustCookie,
  getMfaTrustCookie,
  setAdminSessionCookie,
  setMfaTrustCookie,
} from '@/lib/auth/adminAuthCookies';
import {
  canAccessLoginDestination,
  getLoginDestinationRoute,
  parseLoginDestination,
} from '@/lib/auth/loginDestination';
import { createPreauthSession, rotateTrustedBrowser } from '@/lib/auth/mfaRepository';
import {
  clearAuthRateLimit,
  createAuthRateLimitSubject,
  getAuthRateLimit,
  recordAuthFailure,
} from '@/lib/auth/authRateLimit';

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

export async function POST(req: Request) {
  try {
    const { email, password, destination: rawDestination } = await req.json();

    const destination = parseLoginDestination(rawDestination);
    if (!email || !password || !destination) {
      return NextResponse.json({ success: false, error: 'Email, password, and destination are required.' }, { status: 400 });
    }

    const rateLimitSubject = createAuthRateLimitSubject(String(email), getClientIp(req));
    const rateLimit = await getAuthRateLimit('password-login', rateLimitSubject);
    if (rateLimit.locked) {
      return NextResponse.json(
        { success: false, error: 'Too many sign-in attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    const user = await UsersRepository.findByEmail(email);
    const valid = user ? await UsersRepository.verifyPassword(user, password) : false;
    if (!user || !valid) {
      await recordAuthFailure({ action: 'password-login', subjectHash: rateLimitSubject });
      return NextResponse.json({ success: false, error: 'Invalid email or password.' }, { status: 401 });
    }

    if (!canAccessLoginDestination(user.tier, destination)) {
      return NextResponse.json({ success: false, error: 'Your account cannot access that destination.' }, { status: 403 });
    }

    const userData = {
      name:              user.name ?? '',
      company:           user.company ?? '',
      email:             user.email,
      businessId: user.business_id ?? '',
      role:              user.role ?? 'user',
      tier:              user.tier ?? 'StandardUser',
      userId:            user.id,
    };

    clearAdminSessionCookie();
    const trustToken = user.mfa_enabled === 1 ? getMfaTrustCookie() : null;
    const rotatedTrust = trustToken
      ? await rotateTrustedBrowser(user.id, trustToken)
      : null;

    if (rotatedTrust) {
      setAdminSessionCookie(userData);
      setMfaTrustCookie(rotatedTrust.token, rotatedTrust.expiresAt);
      await clearAuthRateLimit('password-login', rateLimitSubject);

      refreshVariantCache().catch(err => console.error('Failed background cache refresh on login:', err));
      primeImsDbMap().catch(() => {});

      return NextResponse.json({
        success: true,
        message: 'Login successful.',
        nextRoute: getLoginDestinationRoute(destination),
        user: userData,
      });
    }

    if (trustToken) clearMfaTrustCookie();
    await clearAuthRateLimit('password-login', rateLimitSubject);
    const purpose = user.mfa_enabled === 1 ? 'challenge' : 'enroll';
    const preauth = await createPreauthSession({
      userId: user.id,
      purpose,
      destination,
    });

    return NextResponse.json({
      success: true,
      requiresMfa: true,
      purpose,
      preauthToken: preauth.token,
      expiresAt: preauth.expiresAt.toISOString(),
      nextRoute: purpose === 'enroll' ? '/auth/mfa/enroll' : '/auth/mfa/challenge',
    });
  } catch (error: any) {
    console.error('Login error:', error);
    await reportRuntimeIssue({
      source: 'auth.login',
      operation: 'issue_admin_session',
      severity: 'critical',
      title: 'Admin login failed unexpectedly',
      error,
    });
    return NextResponse.json({ success: false, error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
