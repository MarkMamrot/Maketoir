import { execute, query } from '@/services/MySQLService';

export const BUSINESS_FEATURES = [
  {
    key: 'foresight.marketing',
    label: 'Foresight Marketing',
    description: 'Marketing data sync, assistant, planning, recommendations, creative review, campaign audit, and Marketing Settings.',
    product: 'Foresight',
  },
] as const;

export type BusinessFeatureKey = typeof BUSINESS_FEATURES[number]['key'];
export type BusinessFeatureFlags = Record<BusinessFeatureKey, boolean>;

const FEATURE_KEYS = new Set<string>(BUSINESS_FEATURES.map(feature => feature.key));

export function isBusinessFeatureKey(value: string): value is BusinessFeatureKey {
  return FEATURE_KEYS.has(value);
}

export function emptyBusinessFeatureFlags(): BusinessFeatureFlags {
  return Object.fromEntries(BUSINESS_FEATURES.map(feature => [feature.key, false])) as BusinessFeatureFlags;
}

export async function getBusinessFeatureFlags(businessId: string): Promise<BusinessFeatureFlags> {
  const flags = emptyBusinessFeatureFlags();
  if (!businessId) return flags;
  const rows = await query<{ feature_key: string; enabled: number }>(
    `SELECT feature_key, enabled FROM business_feature_flags
     WHERE business_id = ?`,
    [businessId],
  );
  for (const row of rows) {
    if (isBusinessFeatureKey(row.feature_key)) flags[row.feature_key] = Boolean(row.enabled);
  }
  return flags;
}

export async function setBusinessFeatureFlag(input: {
  businessId: string;
  featureKey: BusinessFeatureKey;
  enabled: boolean;
  actorUserId: number;
  actorName: string;
}): Promise<void> {
  await execute(
    `INSERT INTO business_feature_flags
       (business_id, feature_key, enabled, changed_by_user_id, changed_by_name)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), changed_by_user_id = VALUES(changed_by_user_id),
       changed_by_name = VALUES(changed_by_name), changed_at = CURRENT_TIMESTAMP(3)`,
    [input.businessId, input.featureKey, input.enabled ? 1 : 0, input.actorUserId, input.actorName.slice(0, 255)],
  );
}
