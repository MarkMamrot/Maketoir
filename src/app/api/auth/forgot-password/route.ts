import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { sendPasswordSetupEmail } from '@/lib/auth/passwordSetupEmail';
import { recordAuthEvent } from '@/lib/auth/authActivity';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Generates a reset token and emails a link. Always returns success to prevent email enumeration.
 */
export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const email = body && typeof body === 'object' && !Array.isArray(body) && 'email' in body ? body.email : null;
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }
    if (!process.env.RESEND_API_KEY) {
      await reportRuntimeIssue({
        source: 'auth.password-recovery', operation: 'email_service_unconfigured',
        title: 'Password recovery email is not configured', severity: 'error',
      });
      return NextResponse.json({ success: false, error: 'Password recovery is temporarily unavailable. Contact your administrator.' }, { status: 503 });
    }

    const normalised = email.toLowerCase().trim();

    // Look up user — don't reveal if they exist or not
    const users = await query<{ id: number; name: string | null; business_id: string | null }>(
      'SELECT id, name, business_id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [normalised],
    );

    if (users.length > 0) {
      const user = users[0];
      let sent = false;
      try {
        await sendPasswordSetupEmail({
          userId: user.id, email: normalised, name: user.name, businessId: user.business_id, purpose: 'reset',
        });
        sent = true;
      } catch (error) {
        await reportRuntimeIssue({
          businessId: user.business_id, source: 'auth.password-recovery', operation: 'send_reset_instructions',
          title: 'Password recovery instructions could not be sent', error,
          context: { userId: user.id }, reference: { type: 'user', id: user.id },
        });
      }
      if (sent) await recordAuthEvent({
        userId: user.id, businessId: user.business_id, eventType: 'password_reset_requested', request: req,
      });
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Forgot password error:', err);
    await reportRuntimeIssue({ source: 'auth.password-recovery', operation: 'request_reset', title: 'Password recovery request failed', error: err });
    return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
