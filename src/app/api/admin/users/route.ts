import { NextResponse } from 'next/server';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { query, execute } from '@/services/MySQLService';
import { UserTier } from '@/lib/sessionUtils';
import bcrypt from 'bcryptjs';
import { getAdminSession } from '@/lib/sessionUtils';
import { enrollUserInBusiness } from '@/lib/auth/businessMemberships';

async function requireAdminOrSuperAdmin() {
  const session = getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  if (session.tier === 'SuperAdmin' || session.tier === 'Admin') return null;
  return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
}

function resolveEffectiveTier(): UserTier {
  const session = getAdminSession();
  if (session?.tier) return session.tier as UserTier;
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

  const session = getAdminSession();
  const businessId = session?.businessId as string | undefined;

  try {
    const users = await query<any>(
      `SELECT u.id, u.username, u.name, u.email, u.company, u.role, m.tier,
              m.deleted_at, m.created_at, CASE WHEN u.pos_pin_hash IS NOT NULL THEN 1 ELSE 0 END AS has_pos_pin
         FROM user_business_memberships m
         JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
        WHERE m.business_id = ? AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC`,
      [businessId],
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

    if (!email) {
      return NextResponse.json(
        { error: 'email is required.' },
        { status: 400 },
      );
    }

    const existing = await UsersRepository.findByEmail(email);

    if (username) {
      const existingUsername = await query<any>(
        'SELECT id FROM users WHERE username = ? AND (? IS NULL OR id <> ?) AND deleted_at IS NULL LIMIT 1',
        [username, existing?.id ?? null, existing?.id ?? null],
      );
      if (existingUsername.length > 0) {
        return NextResponse.json(
          { error: 'A user with this username already exists.' },
          { status: 409 },
        );
      }
    }

    // Determine valid tiers based on requester's tier
    const effectiveTier = resolveEffectiveTier();
    let validTiers: UserTier[] = ['StandardUser', 'PosManager', 'PosUser'];
    if (effectiveTier === 'SuperAdmin') {
      validTiers = ['Admin', 'Advisor', 'StandardUser', 'PosManager', 'PosUser'];
    } else if (effectiveTier === 'Admin') {
      validTiers = ['Admin', 'Advisor', 'StandardUser', 'PosManager', 'PosUser'];
    }
    
    const userTier = (tier && validTiers.includes(tier)) ? tier : 'StandardUser';

    const session = getAdminSession();
    const businessId = session?.businessId as string | undefined;

    if (!businessId) return NextResponse.json({ error: 'No active business.' }, { status: 400 });
    if (!existing && !password) return NextResponse.json({ error: 'password is required for a new user.' }, { status: 400 });
    const userId = existing?.id ?? await UsersRepository.create({
        email,
        password,
        username: username ?? undefined,
        name: name ?? undefined,
        company: company ?? undefined,
        businessId,
        role: userTier === 'PosUser' ? 'user' : 'admin',
        tier: userTier,
      });
    await enrollUserInBusiness({ userId, businessId, tier: userTier, enrolledByUserId: session?.userId });

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
    const { tier, name, username, company, pos_pin } = body;

    const user = await UsersRepository.findById(Number(userId));
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    
    const effectiveTier = resolveEffectiveTier();
    let validUpdateTiers: UserTier[] = ['StandardUser', 'PosManager', 'PosUser'];
    if (effectiveTier === 'SuperAdmin') {
      validUpdateTiers = ['Admin', 'Advisor', 'StandardUser', 'PosManager', 'PosUser'];
    } else if (effectiveTier === 'Admin') {
      validUpdateTiers = ['Admin', 'Advisor', 'StandardUser', 'PosManager', 'PosUser'];
    }

    if (tier && validUpdateTiers.includes(tier)) {
      const session = getAdminSession();
      await execute(
        'UPDATE user_business_memberships SET tier = ? WHERE user_id = ? AND business_id = ? AND deleted_at IS NULL',
        [tier, userId, session?.businessId],
      );
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

    if (pos_pin !== undefined) {
      if (pos_pin === '' || pos_pin === null) {
        updates.push('pos_pin_hash = ?');
        values.push(null);
      } else {
        const pinHash = await bcrypt.hash(String(pos_pin), 10);
        updates.push('pos_pin_hash = ?');
        values.push(pinHash);
      }
    }

    if (updates.length === 0) {
      if (tier && validUpdateTiers.includes(tier)) {
        return NextResponse.json({ success: true, message: 'User updated.' });
      }
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

    const session = getAdminSession();
    if (Number(userId) === session?.userId) {
      return NextResponse.json({ error: 'You cannot remove your own active business access.' }, { status: 400 });
    }
    await execute(
      'UPDATE user_business_memberships SET deleted_at = NOW() WHERE user_id = ? AND business_id = ? AND deleted_at IS NULL',
      [userId, session?.businessId],
    );
    await execute(
      `UPDATE users u SET u.deleted_at = NOW()
        WHERE u.id = ? AND NOT EXISTS (
          SELECT 1 FROM user_business_memberships m WHERE m.user_id = u.id AND m.deleted_at IS NULL
        )`,
      [userId],
    );

    return NextResponse.json({ success: true, message: 'User deleted.' });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    return NextResponse.json({ error: 'Failed to delete user.' }, { status: 500 });
  }
}
