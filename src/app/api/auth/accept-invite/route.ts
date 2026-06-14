import { NextResponse } from 'next/server';
import { query, execute } from '@/services/MySQLService';
import { UsersRepository } from '@/lib/db/UsersRepository';

interface InviteRow {
  id: number;
  token: string;
  email: string;
  business_id: string;
  invited_by: number;
  role: 'admin' | 'user';
  expires_at: string;
  accepted_at: string | null;
}

// GET /api/auth/accept-invite?token=xxx — validate token and return invite info
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      return NextResponse.json({ success: false, error: 'Token is required.' }, { status: 400 });
    }

    const rows = await query<InviteRow>(
      'SELECT * FROM invites WHERE token = ? LIMIT 1',
      [token],
    );
    const invite = rows[0];

    if (!invite) {
      return NextResponse.json({ success: false, error: 'Invalid or expired invite link.' }, { status: 404 });
    }
    if (invite.accepted_at) {
      return NextResponse.json({ success: false, error: 'This invite has already been used.' }, { status: 410 });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: 'This invite link has expired.' }, { status: 410 });
    }

    // Look up business name
    const businesses = await query<{ name: string }>(
      'SELECT name FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
      [invite.business_id],
    );

    return NextResponse.json({
      success: true,
      email: invite.email,
      businessName: businesses[0]?.name ?? 'Solvantis',
      role: invite.role,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: 'Failed to load invite.' }, { status: 500 });
  }
}

// POST /api/auth/accept-invite — complete registration from invite
export async function POST(req: Request) {
  try {
    const { token, name, password } = await req.json();
    if (!token || !password) {
      return NextResponse.json({ success: false, error: 'Token and password are required.' }, { status: 400 });
    }

    // Atomically claim the invite — prevents concurrent accepts (TOCTOU)
    const claimResult = await execute(
      `UPDATE invites SET accepted_at = NOW()
       WHERE token = ? AND accepted_at IS NULL AND expires_at > NOW()`,
      [token],
    );

    if (claimResult.affectedRows === 0) {
      // Could be invalid token, already used, or expired — look up to give specific message
      const rows = await query<InviteRow>('SELECT * FROM invites WHERE token = ? LIMIT 1', [token]);
      const invite = rows[0];
      if (!invite) return NextResponse.json({ success: false, error: 'Invalid invite token.' }, { status: 404 });
      if (invite.accepted_at) return NextResponse.json({ success: false, error: 'This invite has already been used.' }, { status: 410 });
      return NextResponse.json({ success: false, error: 'This invite link has expired.' }, { status: 410 });
    }

    // Fetch the invite row now that we own it
    const rows = await query<InviteRow>('SELECT * FROM invites WHERE token = ? LIMIT 1', [token]);
    const invite = rows[0];

    // Check email not already taken (race condition guard)
    const existing = await UsersRepository.findByEmail(invite.email);
    if (existing) {
      // Un-claim the invite so it can be retried or re-investigated
      await execute('UPDATE invites SET accepted_at = NULL WHERE id = ?', [invite.id]);
      return NextResponse.json({ success: false, error: 'An account with this email already exists. Try logging in instead.' }, { status: 409 });
    }

    // Look up business company name
    const businesses = await query<{ name: string }>(
      'SELECT name FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
      [invite.business_id],
    );
    const company = businesses[0]?.name;

    try {
      await UsersRepository.create({
        email: invite.email,
        password,
        name: name || undefined,
        company,
        businessId: invite.business_id,
        role: invite.role,
      });
    } catch (createErr: any) {
      // User creation failed — un-claim the invite so it remains usable
      await execute('UPDATE invites SET accepted_at = NULL WHERE id = ?', [invite.id]);
      throw createErr;
    }

    return NextResponse.json({ success: true, message: 'Account created. You can now log in.' });
  } catch (error: any) {
    console.error('Accept invite error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create account. Please try again.' }, { status: 500 });
  }
}
