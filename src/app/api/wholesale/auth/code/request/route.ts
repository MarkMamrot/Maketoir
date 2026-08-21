import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import {
  createAuthRateLimitSubject,
  getAuthRateLimit,
  recordAuthFailure,
} from '@/lib/auth/authRateLimit';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { findWholesaleBuyerByEmail } from '@/lib/wholesale/wholesaleIdentity';
import {
  createWholesaleOtpChallenge,
  WHOLESALE_OTP_EXPIRES_SECONDS,
} from '@/lib/wholesale/wholesaleOtp';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

const GENERIC_RESPONSE = 'If an approved wholesale account matches that email, a sign-in code is on its way.';

function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function fakeChallengeToken(): string {
  return randomBytes(32).toString('base64url');
}

async function sendCodeEmail(input: {
  email: string;
  name: string;
  supplierName: string;
  code: string;
  challengeToken: string;
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : 'Hello,';
  const { error } = await resend.emails.send({
    from: 'Solvantis <onboarding@resend.dev>',
    to: input.email,
    subject: `${input.code} is your ${input.supplierName} sign-in code`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#17202a">
      <p>${greeting}</p>
      <p>Use this code to sign in to the ${escapeHtml(input.supplierName)} wholesale portal:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${input.code}</p>
      <p>This code expires in 10 minutes and can be used once.</p>
      <p style="color:#667085;font-size:13px">If you did not request this code, you can ignore this email.</p>
    </div>`,
  }, {
    idempotencyKey: `wholesale-otp-${input.challengeToken}`,
  });
  if (error) throw new Error(error.message);
}

export async function POST(request: Request) {
  let businessId: string | null = null;
  let slugLength = 0;
  try {
    const body = await request.json();
    const slug = typeof body.slug === 'string' ? body.slug : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    slugLength = slug.length;
    const fallbackToken = fakeChallengeToken();

    if (!email || email.length > 320) {
      return NextResponse.json({ success: true, message: GENERIC_RESPONSE, challengeToken: fallbackToken });
    }

    const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(slug);
    if (!profile) {
      return NextResponse.json({ success: true, message: GENERIC_RESPONSE, challengeToken: fallbackToken });
    }
    businessId = profile.businessId;

    const subject = createAuthRateLimitSubject('wholesale-otp-request', profile.businessId, email, getClientIp(request));
    const limit = await getAuthRateLimit('wholesale-otp-request', subject);
    if (limit.locked) {
      return NextResponse.json({ success: true, message: GENERIC_RESPONSE, challengeToken: fallbackToken });
    }
    await recordAuthFailure({
      action: 'wholesale-otp-request',
      subjectHash: subject,
      threshold: 3,
      windowSeconds: 10 * 60,
      lockSeconds: 10 * 60,
    });

    const buyer = await findWholesaleBuyerByEmail(profile.businessId, email);
    if (!buyer) {
      return NextResponse.json({ success: true, message: GENERIC_RESPONSE, challengeToken: fallbackToken });
    }

    const challenge = await createWholesaleOtpChallenge({
      businessId: buyer.businessId,
      contactId: buyer.contactId,
      email: buyer.email,
    });
    await sendCodeEmail({
      email: buyer.email,
      name: buyer.name,
      supplierName: profile.displayName,
      code: challenge.code,
      challengeToken: challenge.challengeToken,
    });

    return NextResponse.json({
      success: true,
      message: GENERIC_RESPONSE,
      challengeToken: challenge.challengeToken,
      expiresInSeconds: WHOLESALE_OTP_EXPIRES_SECONDS,
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'wholesale.auth',
      operation: 'request_email_code',
      title: 'Wholesale sign-in code request failed',
      error,
      context: { slugLength },
    });
    return NextResponse.json({
      success: true,
      message: GENERIC_RESPONSE,
      challengeToken: fakeChallengeToken(),
    });
  }
}