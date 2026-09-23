import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { execute } from '@/services/MySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type PasswordSetupPurpose = 'set' | 'reset';

interface SendPasswordSetupEmailInput {
  userId: number;
  email: string;
  name?: string | null;
  businessId?: string | null;
  purpose: PasswordSetupPurpose;
}

export async function sendPasswordSetupEmail(input: SendPasswordSetupEmailInput): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    await reportRuntimeIssue({
      businessId: input.businessId ?? null,
      source: 'auth',
      operation: 'password-setup-email',
      title: 'Password setup email service is not configured',
      error: new Error('RESEND_API_KEY is not configured.'),
      context: { userId: input.userId, purpose: input.purpose, provider: 'resend' },
      reference: { type: 'user', id: input.userId },
    });
    throw new Error('Email service is not configured.');
  }

  const email = input.email.toLowerCase().trim();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await execute(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
    [input.userId],
  );
  await execute(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [input.userId, token, expiresAt],
  );

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const setupUrl = `${appUrl}/reset-password?token=${token}`;
  const isFirstSetup = input.purpose === 'set';
  const action = isFirstSetup ? 'Set Password' : 'Reset Password';
  const subject = isFirstSetup ? 'Set your Solvantis password' : 'Reset your Solvantis password';
  const intro = isFirstSetup
    ? 'Your Solvantis account is ready. Choose a password to finish setting up your sign-in.'
    : 'We received a request to reset your Solvantis password.';

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
      to: email,
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
          <h2 style="color:#2563eb;margin:0 0 8px;">${action}</h2>
          <p style="color:#374151;margin:0 0 24px;">Hi${input.name ? ` ${input.name}` : ''}, ${intro}</p>
          <a href="${setupUrl}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;font-weight:700;border-radius:8px;text-decoration:none;">${action}</a>
          <p style="color:#6b7280;font-size:13px;margin:24px 0 0;">This link expires in 1 hour. If you did not expect this email, you can safely ignore it.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
          <p style="color:#9ca3af;font-size:12px;">Or copy this link: ${setupUrl}</p>
        </div>
      `,
    });
    if (error) throw error;
  } catch (error) {
    await reportRuntimeIssue({
      businessId: input.businessId ?? null,
      source: 'auth',
      operation: 'password-setup-email',
      title: 'Password setup email delivery failed',
      error,
      context: { userId: input.userId, purpose: input.purpose, provider: 'resend' },
      reference: { type: 'user', id: input.userId },
    });
    throw new Error('The user was created, but the password setup email could not be sent.');
  }
}