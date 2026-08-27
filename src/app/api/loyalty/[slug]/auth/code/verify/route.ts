import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearAuthRateLimit, createAuthRateLimitSubject, getAuthRateLimit, recordAuthFailure } from '@/lib/auth/authRateLimit';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { LoyaltyPortalProfileRepository } from '@/lib/loyalty/LoyaltyPortalProfile';
import { LOYALTY_PORTAL_SESSION_COOKIE, LOYALTY_PORTAL_SESSION_MAX_AGE, signLoyaltyPortalSession } from '@/lib/loyalty/LoyaltyPortalSession';
import { verifyCustomerOtp } from '@/lib/onlineShop/onlineShopOtp';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  let businessId: string | null = null;
  try {
    const body = await request.json();
    const token = String(body?.challengeToken ?? '');
    const code = String(body?.code ?? '').replace(/\s/g, '');
    const profile = await LoyaltyPortalProfileRepository.getActiveBySlug(params.slug);
    if (!profile || !token || token.length > 128 || !/^\d{6}$/.test(code)) return NextResponse.json({ error: 'That code is invalid or has expired.' }, { status: 401 });
    businessId = profile.businessId;
    const subject = createAuthRateLimitSubject('loyalty-portal-otp-verify', businessId, token, clientIp(request));
    const limit = await getAuthRateLimit('loyalty-portal-otp-verify', subject);
    if (limit.locked) return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
    const result = await verifyCustomerOtp({ businessId, challengeToken: token, code, purpose: 'loyalty_portal' });
    if (!result) {
      await recordAuthFailure({ action: 'loyalty-portal-otp-verify', subjectHash: subject, threshold: 5, windowSeconds: 600, lockSeconds: 900 });
      return NextResponse.json({ error: 'That code is invalid or has expired.' }, { status: 401 });
    }
    const valid = await runImsForBusiness(businessId, async () => (await imsQuery<{ id: number }>(
      `SELECT id FROM ims_contacts WHERE id=? AND business_id=? AND shopify_customer_id IS NOT NULL AND is_active=1 LIMIT 1`,
      [result.contactId, businessId!])).length === 1);
    if (!valid) return NextResponse.json({ error: 'This customer account is unavailable.' }, { status: 403 });
    cookies().set(LOYALTY_PORTAL_SESSION_COOKIE, signLoyaltyPortalSession({ businessId, contactId: result.contactId, email: result.email, portalSlug: profile.slug }),
      { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: LOYALTY_PORTAL_SESSION_MAX_AGE, path: '/' });
    await clearAuthRateLimit('loyalty-portal-otp-verify', subject);
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'loyalty_portal', operation: 'verify_code', title: 'Loyalty portal sign-in failed', error }).catch(() => {});
    return NextResponse.json({ error: 'Sign in failed.' }, { status: 500 });
  }
}