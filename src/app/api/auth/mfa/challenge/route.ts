import { NextResponse } from 'next/server';
import { UsersRepository } from '@/lib/db/UsersRepository';
import {
  consumePreauthSession,
  consumeRecoveryCode,
  getActivePreauthSession,
  getMfaTotpState,
  issueTrustedBrowser,
  recordAcceptedTotpStep,
  recordPreauthFailure,
} from '@/lib/auth/mfaRepository';
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

function getBrowserLabel(req: Request): string {
  const userAgent = req.headers.get('user-agent') || '';
  if (/Edg\//.test(userAgent)) return 'Microsoft Edge browser';
  if (/Chrome\//.test(userAgent)) return 'Google Chrome browser';
  if (/Firefox\//.test(userAgent)) return 'Mozilla Firefox browser';
  if (/Safari\//.test(userAgent)) return 'Safari browser';
  return 'Remembered browser';
}

export async function POST(req: Request) {
  let businessId: string | null = null;
  try {
    const { preauthToken, code, recoveryCode, rememberBrowser } = await req.json();
    if (typeof preauthToken !== 'string' || (
      typeof code !== 'string' && typeof recoveryCode !== 'string'
    )) {
      return NextResponse.json({ success: false, error: 'Challenge session and verification code are required.' }, { status: 400 });
    }

    const preauth = await getActivePreauthSession(preauthToken, 'challenge');
    if (!preauth) {
      return NextResponse.json({ success: false, error: 'Challenge session has expired. Please sign in again.' }, { status: 401 });
    }
    const subject = createAuthRateLimitSubject(String(preauth.userId), getClientIp(req));
    const limiter = await getAuthRateLimit('mfa-challenge', subject);
    if (limiter.locked) {
      return NextResponse.json(
        { success: false, error: 'Too many verification attempts. Please sign in again.' },
        { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
      );
    }

    let verified = false;
    if (typeof recoveryCode === 'string' && recoveryCode.trim()) {
      verified = await consumeRecoveryCode(preauth.userId, recoveryCode);
    } else {
      const state = await getMfaTotpState(preauth.userId);
      if (state?.enabled && state.secret && typeof code === 'string') {
        const verification = await verifyTotpCode({
          secret: state.secret,
          code,
          afterTimeStep: state.lastTotpStep,
        });
        verified = verification.valid && verification.timeStep != null
          ? await recordAcceptedTotpStep(preauth.userId, verification.timeStep)
          : false;
      }
    }

    if (!verified) {
      await recordPreauthFailure(preauth.id);
      await recordAuthFailure({ action: 'mfa-challenge', subjectHash: subject });
      return NextResponse.json({ success: false, error: 'Invalid verification code.' }, { status: 401 });
    }
    if (!await consumePreauthSession(preauth.id)) {
      return NextResponse.json({ success: false, error: 'Challenge session was already used or expired.' }, { status: 409 });
    }

    const user = await UsersRepository.findById(preauth.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Account not found.' }, { status: 401 });
    }
    const membership = await resolveLoginMembership(user);
    if (!membership) {
      return NextResponse.json({ success: false, error: 'Your account is not enrolled in an active business.' }, { status: 403 });
    }
    businessId = membership.businessId;
    const trustedBrowser = rememberBrowser === true
      ? await issueTrustedBrowser({ userId: user.id, displayLabel: getBrowserLabel(req) })
      : null;
    await clearAuthRateLimit('mfa-challenge', subject);
    const completed = completeAdminLogin({
      user,
      membership,
      destination: preauth.destination,
      trustedBrowser,
    });
    return NextResponse.json({ success: true, nextRoute: completed.nextRoute });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'auth.mfa',
      operation: 'complete_challenge',
      severity: 'error',
      title: 'MFA challenge failed unexpectedly',
      error,
    });
    return NextResponse.json({ success: false, error: 'Unable to complete verification.' }, { status: 500 });
  }
}