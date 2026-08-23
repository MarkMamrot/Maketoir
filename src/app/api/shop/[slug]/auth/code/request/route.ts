import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

import { createAuthRateLimitSubject, getAuthRateLimit, recordAuthFailure } from '@/lib/auth/authRateLimit';
import { findOnlineShopCustomerByEmail } from '@/lib/onlineShop/onlineShopIdentity';
import { createOnlineShopOtp, ONLINE_SHOP_OTP_EXPIRES_SECONDS } from '@/lib/onlineShop/onlineShopOtp';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const MESSAGE = 'If an account matches that email, a sign-in code is on its way.';
function clientIp(request: Request) { return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'; }
function fakeToken() { return randomBytes(32).toString('base64url'); }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char); }

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  let businessId: string | null = null;
  try {
    const body = await request.json(); const email = String(body?.email ?? '').trim().toLowerCase(); const fallback = fakeToken();
    const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
    if (!profile || !email || email.length > 320) return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fallback });
    businessId = profile.businessId;
    const subject = createAuthRateLimitSubject('native-shop-otp-request', businessId, email, clientIp(request));
    if ((await getAuthRateLimit('native-shop-otp-request', subject)).locked) return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fallback });
    await recordAuthFailure({ action: 'native-shop-otp-request', subjectHash: subject, threshold: 3, windowSeconds: 600, lockSeconds: 600 });
    const customer = await findOnlineShopCustomerByEmail(businessId, email);
    if (!customer) return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fallback });
    const challenge = await createOnlineShopOtp({ businessId, contactId: customer.contactId, email: customer.email });
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: 'Solvantis <onboarding@resend.dev>', to: customer.email,
      subject: `${challenge.code} is your ${profile.displayName} sign-in code`, html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#17202a"><p>Use this code to sign in to ${escapeHtml(profile.displayName)}:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${challenge.code}</p><p>This code expires in 10 minutes and can be used once.</p></div>` },
    { idempotencyKey: `native-shop-otp-${challenge.challengeToken}` });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, message: MESSAGE, challengeToken: challenge.challengeToken, expiresInSeconds: ONLINE_SHOP_OTP_EXPIRES_SECONDS });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'online_shop_auth', operation: 'request_code', title: 'Online shop sign-in code request failed', error }).catch(() => {});
    return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fakeToken() });
  }
}