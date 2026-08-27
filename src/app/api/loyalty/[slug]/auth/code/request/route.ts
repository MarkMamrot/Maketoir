import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAuthRateLimitSubject, getAuthRateLimit, recordAuthFailure } from '@/lib/auth/authRateLimit';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { decrypt } from '@/lib/encryption';
import { upsertLoyaltyPortalCustomer } from '@/lib/loyalty/LoyaltyPortalIdentity';
import { LoyaltyPortalProfileRepository } from '@/lib/loyalty/LoyaltyPortalProfile';
import { createCustomerOtp, ONLINE_SHOP_OTP_EXPIRES_SECONDS } from '@/lib/onlineShop/onlineShopOtp';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { ShopifyService } from '@/services/ShopifyService';

const MESSAGE = 'If a Shopify customer matches that email, a sign-in code is on its way.';
const fakeToken = () => randomBytes(32).toString('base64url');
const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  let businessId: string | null = null;
  try {
    const email = String((await request.json())?.email ?? '').trim().toLowerCase();
    const fallback = fakeToken();
    const profile = await LoyaltyPortalProfileRepository.getActiveBySlug(params.slug);
    if (!profile || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fallback });
    businessId = profile.businessId;
    const subject = createAuthRateLimitSubject('loyalty-portal-otp-request', businessId, email, clientIp(request));
    if ((await getAuthRateLimit('loyalty-portal-otp-request', subject)).locked) return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fallback });
    await recordAuthFailure({ action: 'loyalty-portal-otp-request', subjectHash: subject, threshold: 3, windowSeconds: 600, lockSeconds: 600 });
    const connection = await ConnectionsRepository.get(businessId);
    if (!connection?.shopify_shop_id || !connection.shopify_access_token) throw new Error('Shopify is not configured for this loyalty portal.');
    let token = connection.shopify_access_token;
    try { token = decrypt(token); } catch { /* Legacy unencrypted token. */ }
    const customers = await new ShopifyService(connection.shopify_shop_id, token).findCustomersByExactEmail(email);
    if (customers.length !== 1) return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fallback });
    const contactId = await runImsForBusiness(businessId, () => upsertLoyaltyPortalCustomer(businessId!, customers[0]));
    const challenge = await createCustomerOtp({ businessId, contactId, email, purpose: 'loyalty_portal' });
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Solvantis <onboarding@resend.dev>', to: email,
      subject: `${challenge.code} is your ${profile.displayName} rewards sign-in code`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;color:#17202a"><p>Use this code to sign in to ${escapeHtml(profile.displayName)} rewards:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${challenge.code}</p><p>This code expires in 10 minutes and can be used once.</p></div>`,
    }, { idempotencyKey: `loyalty-portal-otp-${challenge.challengeToken}` });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, message: MESSAGE, challengeToken: challenge.challengeToken, expiresInSeconds: ONLINE_SHOP_OTP_EXPIRES_SECONDS });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'loyalty_portal', operation: 'request_code', title: 'Loyalty portal sign-in code request failed', error }).catch(() => {});
    return NextResponse.json({ success: true, message: MESSAGE, challengeToken: fakeToken() });
  }
}