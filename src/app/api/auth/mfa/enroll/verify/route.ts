import { NextResponse } from 'next/server';
import { UsersRepository } from '@/lib/db/UsersRepository';
import {
  enableTotpWithRecoveryCodes,
  getActivePreauthSession,
  getMfaTotpState,
  recordPreauthFailure,
} from '@/lib/auth/mfaRepository';
import { createRecoveryCodes } from '@/lib/auth/mfaTokens';
import { verifyTotpCode } from '@/lib/auth/totp';
import {
  clearAuthRateLimit,
  createAuthRateLimitSubject,
  getAuthRateLimit,
  recordAuthFailure,
} from '@/lib/auth/authRateLimit';
import { completeAdminLogin } from '@/lib/auth/adminLoginCompletion';
import { resolveLoginMembership } from '@/lib/auth/businessMemberships';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

export async function POST(req: Request) {
  try {
    const { preauthToken, code } = await req.json();
    if (typeof preauthToken !== 'string' || typeof code !== 'string') {
      return NextResponse.json({ success: false, error: 'Enrollment session and code are required.' }, { status: 400 });
    }

    const preauth = await getActivePreauthSession(preauthToken, 'enroll');
    if (!preauth) {
      return NextResponse.json({ success: false, error: 'Enrollment session has expired. Please sign in again.' }, { status: 401 });
    }
    const subject = createAuthRateLimitSubject(String(preauth.userId), getClientIp(req));
    const limiter = await getAuthRateLimit('mfa-enroll', subject);
    if (limiter.locked) {
      return NextResponse.json(
        { success: false, error: 'Too many verification attempts. Please sign in again.' },
        { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
      );
    }

    const state = await getMfaTotpState(preauth.userId);
    if (!state?.secret) {
      return NextResponse.json({ success: false, error: 'Authenticator setup has not been started.' }, { status: 409 });
    }
    const verification = await verifyTotpCode({ secret: state.secret, code });
    if (!verification.valid || verification.timeStep == null) {
      await recordPreauthFailure(preauth.id);
      await recordAuthFailure({ action: 'mfa-enroll', subjectHash: subject });
      return NextResponse.json({ success: false, error: 'Invalid authenticator code.' }, { status: 401 });
    }

    const recoveryCodes = createRecoveryCodes();
    const enabled = await enableTotpWithRecoveryCodes(
      preauth.id,
      preauth.userId,
      verification.timeStep,
      recoveryCodes,
    );
    if (!enabled) {
      return NextResponse.json({ success: false, error: 'Enrollment session was already used or expired.' }, { status: 409 });
    }
    const user = await UsersRepository.findById(preauth.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Account not found.' }, { status: 401 });
    }

    const membership = await resolveLoginMembership(user);
    if (!membership) {
      return NextResponse.json({ success: false, error: 'Your account is not enrolled in an active business.' }, { status: 403 });
    }

    await clearAuthRateLimit('mfa-enroll', subject);
    const completed = completeAdminLogin({ user, membership, destination: preauth.destination });
    return NextResponse.json({
      success: true,
      nextRoute: completed.nextRoute,
      recoveryCodes,
    });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'auth.mfa',
      operation: 'complete_enrollment',
      severity: 'error',
      title: 'MFA enrollment confirmation failed',
      error,
    });
    return NextResponse.json({ success: false, error: 'Unable to complete authenticator setup.' }, { status: 500 });
  }
}