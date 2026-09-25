import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export type ContactChannelMapping = {
  id: number;
  businessId: string;
  channelInstanceId: string;
  contactId: number;
  externalCustomerId: string;
  mappingStatus: 'linked' | 'conflict' | 'archived';
};

type ContactChannelMappingRow = {
  id: number;
  business_id: string;
  channel_instance_id: string;
  contact_id: number;
  external_customer_id: string;
  mapping_status: ContactChannelMapping['mappingStatus'];
};

function mapRow(row: ContactChannelMappingRow): ContactChannelMapping {
  return {
    id: Number(row.id),
    businessId: row.business_id,
    channelInstanceId: row.channel_instance_id,
    contactId: Number(row.contact_id),
    externalCustomerId: row.external_customer_id,
    mappingStatus: row.mapping_status,
  };
}

function validateIdentity(input: { businessId: string; channelInstanceId: string; externalCustomerId: string }) {
  const businessId = input.businessId.trim();
  const channelInstanceId = input.channelInstanceId.trim();
  const externalCustomerId = input.externalCustomerId.trim();
  if (!businessId || !channelInstanceId || !externalCustomerId) {
    throw new Error('Business, channel instance and external customer identity are required.');
  }
  return { businessId, channelInstanceId, externalCustomerId };
}

export async function getContactChannelMapping(input: {
  businessId: string;
  channelInstanceId: string;
  externalCustomerId: string;
}): Promise<ContactChannelMapping | null> {
  const identity = validateIdentity(input);
  const rows = await imsQuery<ContactChannelMappingRow>(
    `SELECT id, business_id, channel_instance_id, contact_id, external_customer_id, mapping_status
       FROM ims_contact_channel_mappings
      WHERE business_id = ? AND channel_instance_id = ? AND external_customer_id = ?
      LIMIT 1`,
    [identity.businessId, identity.channelInstanceId, identity.externalCustomerId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getContactChannelMappingForContact(input: {
  businessId: string;
  channelInstanceId: string;
  contactId: number;
}): Promise<ContactChannelMapping | null> {
  const businessId = input.businessId.trim();
  const channelInstanceId = input.channelInstanceId.trim();
  const contactId = Math.floor(Number(input.contactId));
  if (!businessId || !channelInstanceId || !Number.isInteger(contactId) || contactId <= 0) {
    throw new Error('Business, channel instance and IMS contact are required.');
  }
  const rows = await imsQuery<ContactChannelMappingRow>(
    `SELECT id, business_id, channel_instance_id, contact_id, external_customer_id, mapping_status
       FROM ims_contact_channel_mappings
      WHERE business_id = ? AND channel_instance_id = ? AND contact_id = ?
      LIMIT 1`,
    [businessId, channelInstanceId, contactId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listContactChannelMappingsForContact(input: {
  businessId: string;
  contactId: number;
}): Promise<ContactChannelMapping[]> {
  const businessId = input.businessId.trim();
  const contactId = Math.floor(Number(input.contactId));
  if (!businessId || !Number.isInteger(contactId) || contactId <= 0) {
    throw new Error('Business and IMS contact are required.');
  }
  const rows = await imsQuery<ContactChannelMappingRow>(
    `SELECT id, business_id, channel_instance_id, contact_id, external_customer_id, mapping_status
       FROM ims_contact_channel_mappings
      WHERE business_id = ? AND contact_id = ? AND mapping_status = 'linked'
      ORDER BY channel_instance_id`,
    [businessId, contactId],
  );
  return rows.map(mapRow);
}

export async function recordInboundContactChannelMapping(input: {
  businessId: string;
  channelInstanceId: string;
  contactId: number;
  externalCustomerId: string;
}): Promise<ContactChannelMapping> {
  const identity = validateIdentity(input);
  const contactId = Math.floor(Number(input.contactId));
  if (!Number.isInteger(contactId) || contactId <= 0) throw new Error('A valid IMS contact is required.');
  const parameters = [identity.businessId, identity.channelInstanceId, contactId, identity.externalCustomerId];
  await imsExecute(
    `INSERT INTO ims_contact_channel_mappings
       (business_id, channel_instance_id, contact_id, external_customer_id,
        mapping_status, last_inbound_at, last_sync_status, safe_error)
     VALUES (?, ?, ?, ?, 'linked', CURRENT_TIMESTAMP(3), 'success', NULL)
     ON DUPLICATE KEY UPDATE
       mapping_status = IF(contact_id = VALUES(contact_id) AND external_customer_id = VALUES(external_customer_id),
                           'linked', 'conflict'),
       last_inbound_at = CURRENT_TIMESTAMP(3),
       last_sync_status = IF(contact_id = VALUES(contact_id) AND external_customer_id = VALUES(external_customer_id),
                             'success', 'error'),
       safe_error = IF(contact_id = VALUES(contact_id) AND external_customer_id = VALUES(external_customer_id),
                       NULL, 'Customer identity conflicts with an existing exact-store mapping.')`,
    parameters,
  );
  const rows = await imsQuery<ContactChannelMappingRow>(
    `SELECT id, business_id, channel_instance_id, contact_id, external_customer_id, mapping_status
       FROM ims_contact_channel_mappings
      WHERE business_id = ? AND channel_instance_id = ?
        AND (contact_id = ? OR external_customer_id = ?)
      ORDER BY (contact_id = ? AND external_customer_id = ?) DESC, id
      LIMIT 1`,
    [...parameters, contactId, identity.externalCustomerId],
  );
  if (!rows[0]) throw new Error('Customer channel mapping could not be read after it was recorded.');
  return mapRow(rows[0]);
}