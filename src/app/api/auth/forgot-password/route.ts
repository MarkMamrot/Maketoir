import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { sendPasswordSetupEmail } from '@/lib/auth/passwordSetupEmail';

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
    const users = await query<{ id: number; name: string | null; business_id: string | null }>(
      'SELECT id, name, business_id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [normalised],
    );

    if (users.length > 0 && process.env.RESEND_API_KEY) {
      const user = users[0];
      await sendPasswordSetupEmail({
        userId: user.id,
        email: normalised,
        name: user.name,
        businessId: user.business_id,
        purpose: 'reset',
      }).catch(() => {});
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Forgot password error:', err);
    return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
