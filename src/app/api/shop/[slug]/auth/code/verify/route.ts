import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { clearAuthRateLimit, createAuthRateLimitSubject, getAuthRateLimit, recordAuthFailure } from '@/lib/auth/authRateLimit';
import { verifyOnlineShopOtp } from '@/lib/onlineShop/onlineShopOtp';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { ONLINE_SHOP_SESSION_COOKIE, ONLINE_SHOP_SESSION_MAX_AGE, signOnlineShopSession } from '@/lib/onlineShop/onlineShopSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function clientIp(request: Request) { return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'; }
export async function POST(request: Request, { params }: { params: { slug: string } }) {
  let businessId: string | null = null;
  try {
    const body = await request.json(); const token = String(body?.challengeToken ?? ''); const code = String(body?.code ?? '').replace(/\s/g, '');
    const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
    if (!profile || !token || token.length > 128 || !/^\d{6}$/.test(code)) return NextResponse.json({ error: 'That code is invalid or has expired.' }, { status: 401 });
    businessId = profile.businessId; const subject = createAuthRateLimitSubject('native-shop-otp-verify', businessId, token, clientIp(request));
    const limit = await getAuthRateLimit('native-shop-otp-verify', subject);
    if (limit.locked) return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
    const result = await verifyOnlineShopOtp({ businessId, challengeToken: token, code });
    if (!result) { await recordAuthFailure({ action: 'native-shop-otp-verify', subjectHash: subject, threshold: 5, windowSeconds: 600, lockSeconds: 900 }); return NextResponse.json({ error: 'That code is invalid or has expired.' }, { status: 401 }); }
    cookies().set(ONLINE_SHOP_SESSION_COOKIE, signOnlineShopSession({ businessId, contactId: result.contactId, email: result.email, storeSlug: profile.slug }),
      { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: ONLINE_SHOP_SESSION_MAX_AGE, path: '/' });
    await clearAuthRateLimit('native-shop-otp-verify', subject);
    return NextResponse.json({ success: true, nextRoute: `/shop/${profile.slug}/account` });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'online_shop_auth', operation: 'verify_code', title: 'Online shop sign-in failed', error }).catch(() => {});
    return NextResponse.json({ error: 'Sign in failed.' }, { status: 500 });
  }
}