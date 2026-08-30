import { UsersRepository, type UserRow } from '@/lib/db/UsersRepository';
import { query } from '@/services/MySQLService';

export const INTERNAL_PLATFORM_BUSINESS_ID = '__solvantis_platform__';

export interface AccessibleBusiness {
  businessId: string;
  name: string;
  driveFolderId: string | null;
  hasForesight: boolean;
  hasIms: boolean;
  hasPos: boolean;
  isSandbox: boolean;
}

interface BusinessRow {
  business_id: string;
  name: string;
  drive_folder_id: string | null;
  has_foresight: number;
  has_ims: number;
  has_pos: number;
  is_sandbox: number;
}

function mapBusiness(row: BusinessRow): AccessibleBusiness {
  return {
    businessId: row.business_id,
    name: row.name || row.business_id,
    driveFolderId: row.drive_folder_id,
    hasForesight: Boolean(row.has_foresight),
    hasIms: Boolean(row.has_ims),
    hasPos: Boolean(row.has_pos),
    isSandbox: Boolean(row.is_sandbox),
  };
}

export async function getAccessibleBusinesses(actor: UserRow): Promise<AccessibleBusiness[]> {
  const superAdmin = actor.tier === 'SuperAdmin';
  if (!superAdmin && !actor.business_id) return [];

  const rows = await query<BusinessRow>(
    `SELECT business_id, name, drive_folder_id, has_foresight, has_ims, has_pos, is_sandbox
       FROM businesses
      WHERE deleted_at IS NULL
        AND business_id <> ?
        ${superAdmin ? '' : 'AND business_id = ?'}
      ORDER BY name, business_id`,
    superAdmin ? [INTERNAL_PLATFORM_BUSINESS_ID] : [INTERNAL_PLATFORM_BUSINESS_ID, actor.business_id],
  );
  return rows.map(mapBusiness);
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