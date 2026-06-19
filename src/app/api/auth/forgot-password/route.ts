import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { query, execute } from '@/services/MySQLService';

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Generates a reset token and emails a link. Always returns success to prevent email enumeration.
 */
export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }

    const normalised = email.toLowerCase().trim();

    // Look up user — don't reveal if they exist or not
    const users = await query<{ id: number; name: string | null }>(
      'SELECT id, name FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [normalised],
    );

    if (users.length > 0 && process.env.RESEND_API_KEY) {
      const user = users[0];

      // Expire any existing unused tokens for this user
      await execute(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
        [user.id],
      );

      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await execute(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, token, expiresAt],
      );

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Solvantis <onboarding@resend.dev>',
        to: normalised,
        subject: 'Reset your Solvantis password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <h2 style="color:#2563eb;margin:0 0 8px;">Reset your password</h2>
            <p style="color:#374151;margin:0 0 24px;">Hi${user.name ? ` ${user.name}` : ''}, we received a request to reset your Solvantis password. Click the button below to choose a new one.</p>
            <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;font-weight:700;border-radius:8px;text-decoration:none;">Reset Password</a>
            <p style="color:#6b7280;font-size:13px;margin:24px 0 0;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
            <p style="color:#9ca3af;font-size:12px;">Or copy this link: ${resetUrl}</p>
          </div>
        `,
      });
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Forgot password error:', err);
    return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
