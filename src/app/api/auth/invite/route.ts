import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { execute, query } from '@/services/MySQLService';

export async function POST(req: Request) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ success: false, error: 'Email service not configured. Contact your administrator.' }, { status: 503 });
    }
    const resend = new Resend(process.env.RESEND_API_KEY);

    const session = cookies().get('marketoir_session');
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
    }

    let user: any;
    try {
      user = JSON.parse(session.value);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid session.' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Only admins can invite users.' }, { status: 403 });
    }
    if (!user.businessId) {
      return NextResponse.json({ success: false, error: 'No business associated with your account.' }, { status: 400 });
    }

    const { email, role = 'user' } = await req.json();
    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Invalid email address.' }, { status: 400 });
    }

    // Check if user already exists
    const existing = await query('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1', [email.toLowerCase()]);
    if (existing.length > 0) {
      return NextResponse.json({ success: false, error: 'A user with this email already exists.' }, { status: 409 });
    }

    // Check for an already-active (unused, not expired) invite for this email+business
    const activeInvite = await query(
      'SELECT id FROM invites WHERE email = ? AND business_id = ? AND accepted_at IS NULL AND expires_at > NOW() LIMIT 1',
      [email.toLowerCase(), user.businessId],
    );
    if (activeInvite.length > 0) {
      return NextResponse.json({ success: false, error: 'An active invite already exists for this email.' }, { status: 409 });
    }

    // Enforce max_users cap
    const bizRows = await query<{ name: string; max_users: number | null }>(
      'SELECT name, max_users FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
      [user.businessId],
    );
    const cap = bizRows[0]?.max_users ?? null;
    if (cap !== null) {
      const [countRow] = await query<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM users WHERE business_id = ? AND deleted_at IS NULL',
        [user.businessId],
      );
      if ((countRow?.cnt ?? 0) >= cap) {
        return NextResponse.json(
          { success: false, error: `User limit reached. Your plan allows a maximum of ${cap} user${cap !== 1 ? 's' : ''}.` },
          { status: 403 },
        );
      }
    }

    // Look up business name (already fetched above)
    const businessName = bizRows[0]?.name ?? 'Solvantis';

    // Generate token, expires in 48 hours
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await execute(
      `INSERT INTO invites (token, email, business_id, invited_by, role, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [token, email.toLowerCase(), user.businessId, user.userId, role, expiresAt],
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
