import { UsersRepository, type UserRow } from '@/lib/db/UsersRepository';
import { query } from '@/services/MySQLService';
import type { UserTier } from '@/lib/sessionUtils';

export const INTERNAL_PLATFORM_BUSINESS_ID = '__solvantis_platform__';

export interface AccessibleBusiness {
  businessId: string;
  name: string;
  driveFolderId: string | null;
  hasForesight: boolean;
  hasIms: boolean;
  hasPos: boolean;
  isSandbox: boolean;
  tier: UserTier;
}

interface BusinessRow {
  business_id: string;
  name: string;
  drive_folder_id: string | null;
  has_foresight: number;
  has_ims: number;
  has_pos: number;
  is_sandbox: number;
  membership_tier?: UserTier;
}

function mapBusiness(row: BusinessRow, tier: UserTier): AccessibleBusiness {
  return {
    businessId: row.business_id,
    name: row.name || row.business_id,
    driveFolderId: row.drive_folder_id,
    hasForesight: Boolean(row.has_foresight),
    hasIms: Boolean(row.has_ims),
    hasPos: Boolean(row.has_pos),
    isSandbox: Boolean(row.is_sandbox),
    tier,
  };
}

export async function getAccessibleBusinesses(actor: UserRow): Promise<AccessibleBusiness[]> {
  const superAdmin = actor.tier === 'SuperAdmin';
  if (superAdmin) {
    const rows = await query<BusinessRow>(
      `SELECT business_id, name, drive_folder_id, has_foresight, has_ims, has_pos, is_sandbox
         FROM businesses
        WHERE deleted_at IS NULL AND business_id <> ?
        ORDER BY name, business_id`,
      [INTERNAL_PLATFORM_BUSINESS_ID],
    );
    return rows.map(row => mapBusiness(row, 'SuperAdmin'));
  }

  const rows = await query<BusinessRow>(
    `SELECT b.business_id, b.name, b.drive_folder_id, b.has_foresight, b.has_ims, b.has_pos,
            b.is_sandbox, m.tier AS membership_tier
       FROM user_business_memberships m
       JOIN businesses b ON b.business_id = m.business_id AND b.deleted_at IS NULL
      WHERE m.user_id = ? AND m.deleted_at IS NULL AND b.business_id <> ?
      ORDER BY b.name, b.business_id`,
    [actor.id, INTERNAL_PLATFORM_BUSINESS_ID],
  );
  return rows.map(row => mapBusiness(row, row.membership_tier ?? 'StandardUser'));
}

export async function resolveActorBusinessAccess(userId: number): Promise<{
  actor: UserRow;
  businesses: AccessibleBusiness[];
} | null> {
  const actor = await UsersRepository.findById(userId);
  if (!actor) return null;
  return { actor, businesses: await getAccessibleBusinesses(actor) };
}

export function findAccessibleBusiness(
  businesses: AccessibleBusiness[],
  businessId: string,
): AccessibleBusiness | null {
  return businesses.find(business => business.businessId === businessId) ?? null;
}