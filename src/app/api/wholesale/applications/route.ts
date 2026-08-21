import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import {
  createAuthRateLimitSubject,
  getAuthRateLimit,
  recordAuthFailure,
} from '@/lib/auth/authRateLimit';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  normalizeWholesaleApplication,
  submitWholesaleApplication,
  WholesaleApplicationValidationError,
} from '@/lib/wholesale/wholesaleApplication';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

const CONSENT_VERSION = '2026-08-21';
const SUCCESS_MESSAGE = 'Check your email to verify your application. If you already applied, your existing application remains with the supplier.';

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

async function sendVerificationEmail(input: {
  applicationId: number;
  token: string;
  slug: string;
  supplierName: string;
  contactName: string;
  email: string;
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const verifyUrl = `${appUrl}/wholesale/${encodeURIComponent(input.slug)}/verify?token=${encodeURIComponent(input.token)}`;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Solvantis <onboarding@resend.dev>',
    to: input.email,
    subject: `Verify your ${input.supplierName} wholesale application`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#17202a">
      <p>Hi ${escapeHtml(input.contactName)},</p>
      <p>Confirm your email address to send your wholesale application to ${escapeHtml(input.supplierName)} for review.</p>
      <p style="margin:28px 0"><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:12px 20px;background:#163f34;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Verify email address</a></p>
      <p>This link expires in 24 hours. Approval is completed separately by the supplier.</p>
      <p style="color:#667085;font-size:13px">If you did not submit this application, you can ignore this email.</p>
    </div>`,
  }, {
    idempotencyKey: `wholesale-application-${input.applicationId}-${createHash('sha256').update(input.token).digest('hex').slice(0, 16)}`,
  });
  if (error) throw new Error(error.message);
}

export async function POST(request: Request) {
  let businessId: string | null = null;
  let applicationId: number | null = null;
  try {
    const body = await request.json();
    const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(body.slug);
    if (!profile) return NextResponse.json({ error: 'Wholesale supplier not found.' }, { status: 404 });
    businessId = profile.businessId;

    const application = normalizeWholesaleApplication(body.application);
    const subject = createAuthRateLimitSubject(
      'wholesale-application', profile.businessId, application.email, getClientIp(request),
    );
    const limit = await getAuthRateLimit('wholesale-application', subject);
    if (limit.locked) {
      return NextResponse.json(
        { error: 'Too many application attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }
    await recordAuthFailure({
      action: 'wholesale-application', subjectHash: subject,
      threshold: 4, windowSeconds: 60 * 60, lockSeconds: 60 * 60,
    });

    const submission = await submitWholesaleApplication({
      businessId: profile.businessId,
      application,
      termsVersion: CONSENT_VERSION,
      privacyVersion: CONSENT_VERSION,
    });
    applicationId = submission.applicationId;
    if (submission.shouldSendVerification) {
      await sendVerificationEmail({
        applicationId: submission.applicationId,
        token: submission.verificationToken,
        slug: profile.slug,
        supplierName: profile.displayName,
        contactName: application.contactName,
        email: application.email,
      });
    }

    return NextResponse.json({ success: true, message: SUCCESS_MESSAGE });
  } catch (error) {
    if (error instanceof WholesaleApplicationValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'wholesale.application',
      operation: 'submit',
      title: 'Wholesale application submission failed',
      error,
      context: { applicationId },
      reference: applicationId ? { type: 'wholesale_application', id: applicationId } : undefined,
    });
    return NextResponse.json({ error: 'Your application could not be submitted. Please try again.' }, { status: 500 });
  }
}