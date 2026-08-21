import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  clearAuthRateLimit,
  createAuthRateLimitSubject,
  getAuthRateLimit,
  recordAuthFailure,
} from '@/lib/auth/authRateLimit';
import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getActiveWholesaleBuyer } from '@/lib/wholesale/wholesaleIdentity';
import { verifyWholesaleOtpChallenge } from '@/lib/wholesale/wholesaleOtp';
import {
  signWholesaleSession,
  WHOLESALE_SESSION_COOKIE,
  WHOLESALE_SESSION_MAX_AGE,
} from '@/lib/wholesale/wholesaleSession';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

function invalidCodeResponse() {
  return NextResponse.json({ error: 'That code is invalid or has expired.' }, { status: 401 });
}

export async function POST(request: Request) {
  let businessId: string | null = null;
  try {
    const body = await request.json();
    const slug = typeof body.slug === 'string' ? body.slug : '';
    const challengeToken = typeof body.challengeToken === 'string' ? body.challengeToken : '';
    const code = typeof body.code === 'string' ? body.code : '';
    if (!challengeToken || challengeToken.length > 128 || !/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      return invalidCodeResponse();
    }

    const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(slug);
    if (!profile) return invalidCodeResponse();
    businessId = profile.businessId;

    const subject = createAuthRateLimitSubject(
      'wholesale-otp-verify',
      profile.businessId,
      challengeToken,
      getClientIp(request),
    );
    const limit = await getAuthRateLimit('wholesale-otp-verify', subject);
    if (limit.locked) {
      return NextResponse.json(
        { error: 'Too many code attempts. Request a new code and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const verification = await verifyWholesaleOtpChallenge({
      challengeToken,
      code,
      businessId: profile.businessId,
    });
    if (verification.status !== 'verified') {
      await recordAuthFailure({
        action: 'wholesale-otp-verify',
        subjectHash: subject,
        threshold: 5,
        windowSeconds: 10 * 60,
        lockSeconds: 15 * 60,
      });
      return invalidCodeResponse();
    }

    const buyer = await getActiveWholesaleBuyer(profile.businessId, verification.contactId);
    const imsDb = await getImsDbNameStrict(profile.businessId);
    if (!buyer || !imsDb) return invalidCodeResponse();

    cookies().set(WHOLESALE_SESSION_COOKIE, signWholesaleSession({
      contactId: buyer.contactId,
      businessId: buyer.businessId,
      imsDb,
      email: buyer.email,
      name: buyer.name,
      company: buyer.company,
      supplierSlug: profile.slug,
      companyId: buyer.companyId,
      locationId: buyer.locationId,
      memberId: buyer.memberId,
      memberRole: buyer.memberRole,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: WHOLESALE_SESSION_MAX_AGE,
      path: '/',
    });
    await clearAuthRateLimit('wholesale-otp-verify', subject);

    return NextResponse.json({ success: true, nextRoute: `/wholesale/${profile.slug}` });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'wholesale.auth',
      operation: 'verify_email_code',
      title: 'Wholesale sign-in code verification failed',
      error,
    });
    return NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 500 });
  }
}