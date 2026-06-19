import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { query, execute } from '@/services/MySQLService';
import { UserTier } from '@/lib/sessionUtils';

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function requireAdminOrSuperAdmin() {
  const session = getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  // If tier is already in session, use it
  if (session.tier === 'SuperAdmin' || session.tier === 'Admin') return null;
  // Tier may be missing from old sessions — look up from DB
  if (session.userId) {
    const dbUser = await UsersRepository.findById(Number(session.userId)).catch(() => null);
    if (dbUser && (dbUser.tier === 'SuperAdmin' || dbUser.tier === 'Admin')) return null;
  }
  return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
}

async function resolveEffectiveTier(): Promise<UserTier> {
  const session = getAdminSession();
  if (session?.tier) return session.tier as UserTier;
  if (session?.userId) {
    const dbUser = await UsersRepository.findById(Number(session.userId)).catch(() => null);
    if (dbUser?.tier) return dbUser.tier;
  }
  return 'StandardUser';
}

/**
 * GET /api/admin/users
 * List all users with their tier information.
 * Admin and SuperAdmin only.
 */
export async function GET() {
  const error = await requireAdminOrSuperAdmin();
  if (error) return error;

  try {
    const users = await query<any>(
      `SELECT id, username, name, email, company, role, tier, deleted_at, created_at 
       FROM users 
       ORDER BY created_at DESC`,
      [],
    );
    return NextResponse.json({ success: true, users });
  } catch (err: any) {
    console.error('Error fetching users:', err);
    return NextResponse.json({ error: 'Failed to fetch users.' }, { status: 500 });
  }
}

/**
 * POST /api/admin/users
 * Create a new user with specified tier.
 * Admin and SuperAdmin only. (Admins cannot create SuperAdmin users)
 * Body: { email, password, name?, company?, tier? }
 */
export async function POST(req: Request) {
  const error = await requireAdminOrSuperAdmin();
  if (error) return error;

  try {
    const { email, password, name, username, company, tier } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required.' },
        { status: 400 },
      );
    }

    const existing = await UsersRepository.findByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'A user with this email already exists.' },
        { status: 409 },
      );
    }

    if (username) {
      const existingUsername = await query<any>(
        'SELECT id FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1',
        [username],
      );
      if (existingUsername.length > 0) {
        return NextResponse.json(
          { error: 'A user with this username already exists.' },
          { status: 409 },
        );
      }
    }

    // Determine valid tiers based on requester's tier
    const effectiveTier = await resolveEffectiveTier();
    let validTiers: UserTier[] = ['StandardUser', 'PosUser'];
    if (effectiveTier === 'SuperAdmin') {
      validTiers = ['SuperAdmin', 'Admin', 'StandardUser', 'PosUser'];
    } else if (effectiveTier === 'Admin') {
      validTiers = ['Admin', 'StandardUser', 'PosUser'];
    }
    
    const userTier = (tier && validTiers.includes(tier)) ? tier : 'StandardUser';

    const userId = await UsersRepository.create({
      email,
      password,
      username: username ?? undefined,
      name: name ?? undefined,
      company: company ?? undefined,
      role: userTier === 'PosUser' ? 'user' : 'admin',
      tier: userTier,
    });

    return NextResponse.json({
      success: true,
      userId,
      message: `User created with ${userTier} tier.`,
    });
  } catch (err: any) {
    console.error('Error creating user:', err);
    return NextResponse.json({ error: err?.message ?? 'Failed to create user.' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users/[userId]
 * Update a user's tier or other properties.
 * Admin and SuperAdmin only. (Admins cannot promote to SuperAdmin or Admin)
 * Body: { tier?, name?, company? }
 */
export async function PATCH(req: Request) {
  const error = await requireAdminOrSuperAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId || isNaN(Number(userId))) {
      return NextResponse.json(
        { error: 'Invalid userId.' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { tier, name, username, company } = body;

    const user = await UsersRepository.findById(Number(userId));
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    
    const effectiveTier = await resolveEffectiveTier();
    let validUpdateTiers: UserTier[] = ['StandardUser', 'PosUser'];
    if (effectiveTier === 'SuperAdmin') {
      validUpdateTiers = ['SuperAdmin', 'Admin', 'StandardUser', 'PosUser'];
    } else if (effectiveTier === 'Admin') {
      validUpdateTiers = ['Admin', 'StandardUser', 'PosUser'];
    }

    if (tier && validUpdateTiers.includes(tier)) {
      updates.push('tier = ?');
      values.push(tier);
    }

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name || null);
    }

    if (username !== undefined) {
      if (username) {
        const existing = await query<any>(
          'SELECT id FROM users WHERE username = ? AND id != ? AND deleted_at IS NULL LIMIT 1',
          [username, userId],
        );
        if (existing.length > 0) {
          return NextResponse.json({ error: 'A user with this username already exists.' }, { status: 409 });
        }
      }
      updates.push('username = ?');
      values.push(username || null);
    }

    if (company !== undefined) {
      updates.push('company = ?');
      values.push(company || null);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update.' },
        { status: 400 },
      );
    }

    values.push(userId);
    await execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      values,
    );

    return NextResponse.json({ success: true, message: 'User updated.' });
  } catch (err: any) {
    console.error('Error updating user:', err);
    return NextResponse.json({ error: 'Failed to update user.' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/users/[userId]
 * Soft-delete a user (set deleted_at).
 * Admin and SuperAdmin only.
 */
export async function DELETE(req: Request) {
  const error = await requireAdminOrSuperAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId || isNaN(Number(userId))) {
      return NextResponse.json(
        { error: 'Invalid userId.' },
        { status: 400 },
      );
    }

    const user = await UsersRepository.findById(Number(userId));
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    await execute(
      'UPDATE users SET deleted_at = NOW() WHERE id = ?',
      [userId],
    );

    return NextResponse.json({ success: true, message: 'User deleted.' });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    return NextResponse.json({ error: 'Failed to delete user.' }, { status: 500 });
  }
}
