/**
 * sessionUtils.ts
 * Shared helpers for parsing and validating session cookies in API routes.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserTier = 'SuperAdmin' | 'Admin' | 'StandardUser' | 'PosManager' | 'PosUser' | 'Advisor';

export interface AdminSession {
  name: string;
  company: string;
  email: string;
  businessId: string;
  role: string;
  tier: UserTier;
  userId: number;
}

export interface PosSession {
  pos_user_id: number;
  username: string;
  full_name: string;
  location_id: number;
  location_name: string;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function getAdminSession(): AdminSession | null {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as AdminSession; } catch { return null; }
}

export function getPosSession(): PosSession | null {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as PosSession; } catch { return null; }
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Require a valid admin (marketoir_session) cookie.
 * Returns { user } on success, or { response } (a 401) to return immediately.
 */
export function requireAdminSession():
  | { user: AdminSession; response?: never }
  | { user?: never; response: NextResponse } {
  const user = getAdminSession();
  if (!user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }),
    };
  }
  return { user };
}

/**
 * Require that the supplied databaseId matches the logged-in user's business.
 * Prevents cross-business data access where databaseId comes from the request.
 */
export function assertBusinessAccess(
  user: AdminSession,
  databaseId: string | null | undefined,
): NextResponse | null {
  if (!databaseId) {
    return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });
  }
  if (databaseId !== user.businessId) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }
  return null;
}

// ─── Tier-Based Access Guards ─────────────────────────────────────────────────

/**
 * Check if user has required tier.
 * Tier hierarchy: SuperAdmin > Admin > StandardUser > PosManager > PosUser
 */
function hasTierAccess(userTier: UserTier, requiredTier: UserTier): boolean {
  const tierHierarchy: Record<UserTier, number> = {
    'SuperAdmin': 5,
    'Admin': 4,
    'StandardUser': 3,
    'PosManager': 2,
    'PosUser': 1,
    'Advisor': 0,  // read-only; not in the write hierarchy
  };
  return tierHierarchy[userTier] >= tierHierarchy[requiredTier];
}

/**
 * Require SuperAdmin tier access.
 * SuperAdmin only — system-wide configuration and user management.
 */
export function requireSuperAdminTier():
  | { user: AdminSession; response?: never }
  | { user?: never; response: NextResponse } {
  const user = getAdminSession();
  if (!user || !hasTierAccess(user.tier, 'SuperAdmin')) {
    return {
      response: NextResponse.json(
        { error: 'SuperAdmin access required.' },
        { status: 403 },
      ),
    };
  }
  return { user };
}

/**
 * Require Admin or higher tier access.
 * Admin and SuperAdmin — full org access, settings, user management.
 */
export function requireAdminTier():
  | { user: AdminSession; response?: never }
  | { user?: never; response: NextResponse } {
  const user = getAdminSession();
  if (!user || !hasTierAccess(user.tier, 'Admin')) {
    return {
      response: NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      ),
    };
  }
  return { user };
}

/**
 * Require StandardUser or higher tier access.
 * Everyone except PosUser — access everything except settings.
 */
export function requireStandardUserTier():
  | { user: AdminSession; response?: never }
  | { user?: never; response: NextResponse } {
  const user = getAdminSession();
  if (!user || !hasTierAccess(user.tier, 'StandardUser')) {
    return {
      response: NextResponse.json(
        { error: 'User access required.' },
        { status: 403 },
      ),
    };
  }
  return { user };
}

/**
 * Require any valid session (all tiers).
 */
export function requireAnyTier():
  | { user: AdminSession; response?: never }
  | { user?: never; response: NextResponse } {
  const user = getAdminSession();
  if (!user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }),
    };
  }
  return { user };
}

/**
 * Block write operations for Advisor tier (read-only role).
 * Returns { user } if allowed, or { response } (403) if Advisor tries to write.
 */
export function requireWriteAccess():
  | { user: AdminSession; response?: never }
  | { user?: never; response: NextResponse } {
  const user = getAdminSession();
  if (!user) {
    return { response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) };
  }
  if (user.tier === 'Advisor') {
    return { response: NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 }) };
  }
  return { user };
}

