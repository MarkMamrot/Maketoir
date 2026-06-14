import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { execute, query } from '@/services/MySQLService';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
    }

    const user = JSON.parse(session.value);
    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Only admins can invite users.' }, { status: 403 });
    }
    if (!user.userSpreadsheetId) {
      return NextResponse.json({ success: false, error: 'No business associated with your account.' }, { status: 400 });
    }

    const { email, role = 'user' } = await req.json();
    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }

    // Check if user already exists
    const existing = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [email.toLowerCase()]);
    if (existing.length > 0) {
      return NextResponse.json({ success: false, error: 'A user with this email already exists.' }, { status: 409 });
    }

    // Look up business name
    const businesses = await query<{ name: string }>(
      'SELECT name FROM businesses WHERE business_id = ? LIMIT 1',
      [user.userSpreadsheetId],
    );
    const businessName = businesses[0]?.name ?? 'Solvantis';

    // Generate token, expires in 48 hours
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await execute(
      `INSERT INTO invites (token, email, business_id, invited_by, role, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [token, email.toLowerCase(), user.userSpreadsheetId, user.userId, role, expiresAt],
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://maketoir.vercel.app';
    const inviteUrl = `${appUrl}/accept-invite?token=${token}`;

    await resend.emails.send({
      from: 'Solvantis <onboarding@resend.dev>',
      to: email,
      subject: `You've been invited to join ${businessName} on Solvantis`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #1d4ed8;">You're invited to Solvantis</h2>
          <p>${user.name || user.email} has invited you to join <strong>${businessName}</strong> on Solvantis.</p>
          <p>Click the button below to set up your account. This link expires in 48 hours.</p>
          <a href="${inviteUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;">
            Accept Invite
          </a>
          <p style="color:#6b7280;font-size:13px;">Or copy this link: ${inviteUrl}</p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, message: `Invite sent to ${email}.` });
  } catch (error: any) {
    console.error('Invite error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}
