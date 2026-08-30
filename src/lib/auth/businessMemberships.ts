import type { UserTier } from '@/lib/sessionUtils';
import { execute, query } from '@/services/MySQLService';
import type { UserRow } from '@/lib/db/UsersRepository';

export interface BusinessMembership {
  userId: number;
  businessId: string;
  businessName: string;
  tier: UserTier;
  isDefault: boolean;
  lastActiveAt: string | null;
}

interface MembershipRow {
  user_id: number;
  business_id: string;
  business_name: string;
  tier: UserTier;
  is_default: number;
  last_active_at: string | null;
}

function mapMembership(row: MembershipRow): BusinessMembership {
  return {
    userId: row.user_id,
    businessId: row.business_id,
    businessName: row.business_name || row.business_id,
    tier: row.tier,
    isDefault: Boolean(row.is_default),
    lastActiveAt: row.last_active_at,
  };
}

export async function listBusinessMemberships(userId: number): Promise<BusinessMembership[]> {
  const rows = await query<MembershipRow>(
    `SELECT m.user_id, m.business_id, b.name AS business_name, m.tier,
            m.is_default, m.last_active_at
       FROM user_business_memberships m
       JOIN businesses b ON b.business_id = m.business_id AND b.deleted_at IS NULL
      WHERE m.user_id = ? AND m.deleted_at IS NULL
      ORDER BY m.last_active_at IS NULL, m.last_active_at DESC, m.is_default DESC, b.name`,
    [userId],
  );
  return rows.map(mapMembership);
}

export function selectLoginMembership(memberships: BusinessMembership[]): BusinessMembership | null {
  if (!memberships.length) return null;
  return memberships.find(membership => membership.lastActiveAt != null)
    ?? memberships.find(membership => membership.isDefault)
    ?? memberships[0];
}

export async function findBusinessMembership(userId: number, businessId: string): Promise<BusinessMembership | null> {
  const memberships = await listBusinessMemberships(userId);
  return memberships.find(membership => membership.businessId === businessId) ?? null;
}

export async function recordActiveBusiness(userId: number, businessId: string): Promise<void> {
  await execute(
    `UPDATE user_business_memberships
        SET last_active_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ? AND business_id = ? AND deleted_at IS NULL`,
    [userId, businessId],
  );
}

export async function enrollUserInBusiness(input: {
  userId: number;
  businessId: string;
  tier: UserTier;
  enrolledByUserId?: number | null;
  isDefault?: boolean;
}): Promise<void> {
  await execute(
    `INSERT INTO user_business_memberships
       (user_id, business_id, tier, is_default, enrolled_by_user_id, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       tier = VALUES(tier),
       enrolled_by_user_id = VALUES(enrolled_by_user_id),
       deleted_at = NULL`,
    [input.userId, input.businessId, input.tier, input.isDefault ? 1 : 0, input.enrolledByUserId ?? null],
  );
}

export async function resolveLoginMembership(user: UserRow): Promise<BusinessMembership | null> {
  if (user.tier === 'SuperAdmin') {
    if (!user.business_id) return null;
    return {
      userId: user.id,
      businessId: user.business_id,
      businessName: user.company ?? user.business_id,
      tier: 'SuperAdmin',
      isDefault: true,
      lastActiveAt: null,
    };
  }
  return selectLoginMembership(await listBusinessMemberships(user.id));
}