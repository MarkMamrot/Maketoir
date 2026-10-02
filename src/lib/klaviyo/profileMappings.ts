import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export type KlaviyoProfileMappingStatus = 'linked' | 'conflict' | 'archived';

export interface KlaviyoProfileMapping {
  contactId: number;
  profileId: string | null;
  externalId: string;
  status: KlaviyoProfileMappingStatus;
  safeError: string | null;
}

interface MappingRow {
  contact_id: number;
  klaviyo_profile_id: string | null;
  external_id: string;
  reconciliation_status: KlaviyoProfileMappingStatus;
  safe_error: string | null;
}

function mapRow(row: MappingRow): KlaviyoProfileMapping {
  return {
    contactId: Number(row.contact_id),
    profileId: row.klaviyo_profile_id,
    externalId: row.external_id,
    status: row.reconciliation_status,
    safeError: row.safe_error,
  };
}

export async function getKlaviyoProfileMapping(
  businessId: string,
  contactId: number,
): Promise<KlaviyoProfileMapping | null> {
  const rows = await imsQuery<MappingRow>(
    `SELECT contact_id, klaviyo_profile_id, external_id, reconciliation_status, safe_error
       FROM ims_klaviyo_profile_mappings
      WHERE business_id = ? AND contact_id = ?
      LIMIT 1`,
    [businessId, contactId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function recordLinkedKlaviyoProfileMapping(input: {
  businessId: string;
  contactId: number;
  profileId: string;
  externalId: string;
}): Promise<KlaviyoProfileMapping> {
  await imsExecute(
    `INSERT INTO ims_klaviyo_profile_mappings
       (business_id, contact_id, klaviyo_profile_id, external_id,
        reconciliation_status, last_sync_at, safe_error, error_at)
     VALUES (?, ?, ?, ?, 'linked', CURRENT_TIMESTAMP(3), NULL, NULL)
     ON DUPLICATE KEY UPDATE
       reconciliation_status = IF(contact_id = VALUES(contact_id)
                                  AND (klaviyo_profile_id IS NULL OR klaviyo_profile_id = VALUES(klaviyo_profile_id))
                                  AND external_id = VALUES(external_id), 'linked', 'conflict'),
       klaviyo_profile_id = IF(contact_id = VALUES(contact_id)
                               AND (klaviyo_profile_id IS NULL OR klaviyo_profile_id = VALUES(klaviyo_profile_id))
                               AND external_id = VALUES(external_id), VALUES(klaviyo_profile_id), klaviyo_profile_id),
       last_sync_at = IF(reconciliation_status = 'linked', CURRENT_TIMESTAMP(3), last_sync_at),
       safe_error = IF(reconciliation_status = 'linked', NULL, 'Profile identity conflicts with an existing Klaviyo mapping.'),
       error_at = IF(reconciliation_status = 'linked', NULL, CURRENT_TIMESTAMP(3))`,
    [input.businessId, input.contactId, input.profileId, input.externalId],
  );
  const rows = await imsQuery<MappingRow>(
    `SELECT contact_id, klaviyo_profile_id, external_id, reconciliation_status, safe_error
       FROM ims_klaviyo_profile_mappings
      WHERE business_id = ? AND (contact_id = ? OR klaviyo_profile_id = ? OR external_id = ?)
      ORDER BY contact_id = ? DESC, id
      LIMIT 1`,
    [input.businessId, input.contactId, input.profileId, input.externalId, input.contactId],
  );
  if (!rows[0]) throw new Error('Klaviyo profile mapping could not be read after it was recorded.');
  return mapRow(rows[0]);
}

export async function recordKlaviyoProfileConflict(input: {
  businessId: string;
  contactId: number;
  externalId: string;
  safeError: string;
}): Promise<void> {
  await imsExecute(
    `INSERT INTO ims_klaviyo_profile_mappings
       (business_id, contact_id, external_id, reconciliation_status, safe_error, error_at)
     VALUES (?, ?, ?, 'conflict', ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE reconciliation_status = 'conflict', safe_error = VALUES(safe_error),
                             error_at = CURRENT_TIMESTAMP(3)`,
    [input.businessId, input.contactId, input.externalId, input.safeError],
  );
}