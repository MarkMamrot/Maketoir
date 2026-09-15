import { randomUUID } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { encrypt } from '@/lib/encryption';
import { getPool } from '@/services/MySQLService';
import { AMAZON_AU_MARKETPLACE_ID } from './amazonSpApi';

interface ExistingAmazonInstanceRow extends RowDataPacket {
  channel_instance_id: string;
  business_id: string;
  settings_json: string | Record<string, unknown> | null;
}

export interface AuthorizeAmazonChannelInput {
  businessId: string;
  sellerId: string;
  displayName: string;
  storeName: string;
  refreshToken: string;
}

function validate(input: AuthorizeAmazonChannelInput): AuthorizeAmazonChannelInput {
  const normalized = {
    businessId: input.businessId.trim(),
    sellerId: input.sellerId.trim().toUpperCase(),
    displayName: input.displayName.trim(),
    storeName: input.storeName.trim(),
    refreshToken: input.refreshToken.trim(),
  };
  if (!normalized.businessId) throw new Error('Business ID is required.');
  if (!/^[A-Z0-9]{8,32}$/.test(normalized.sellerId)) throw new Error('Amazon returned an invalid seller ID.');
  if (!normalized.displayName || normalized.displayName.length > 120) throw new Error('Amazon channel name is invalid.');
  if (!normalized.refreshToken) throw new Error('Amazon refresh token is required.');
  return normalized;
}

async function findInstance(connection: PoolConnection, sellerId: string): Promise<ExistingAmazonInstanceRow | null> {
  const [rows] = await connection.execute<ExistingAmazonInstanceRow[]>(
    `SELECT channel_instance_id, business_id, settings_json
       FROM sales_channel_instances
      WHERE provider = 'amazon' AND external_account_key = ?
      LIMIT 1 FOR UPDATE`,
    [sellerId],
  );
  return rows[0] ?? null;
}

export async function authorizeAmazonChannel(input: AuthorizeAmazonChannelInput): Promise<string> {
  const value = validate(input);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const existing = await findInstance(connection, value.sellerId);
    if (existing && existing.business_id !== value.businessId) {
      throw new Error('This Amazon seller account is already connected to another business.');
    }
    const channelInstanceId = existing?.channel_instance_id ?? randomUUID();
    const settings = {
      region: 'far_east',
      marketplaces: [{ id: AMAZON_AU_MARKETPLACE_ID, countryCode: 'AU', storeName: value.storeName }],
      requiredOperations: ['listings', 'inventory', 'orders', 'fulfilments', 'returns'],
      authorizationVerifiedAt: new Date().toISOString(),
    };
    if (existing) {
      let existingSettings: Record<string, unknown> = {};
      try {
        const parsed = typeof existing.settings_json === 'string' ? JSON.parse(existing.settings_json) : existing.settings_json;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existingSettings = parsed;
      } catch {}
      await connection.execute(
        `UPDATE sales_channel_instances
            SET display_name = ?, settings_json = ?,
                readiness_status = 'not_tested', safe_error = NULL, updated_at = CURRENT_TIMESTAMP(3)
          WHERE business_id = ? AND channel_instance_id = ?`,
        [value.displayName, JSON.stringify({ ...existingSettings, ...settings }), value.businessId, channelInstanceId],
      );
    } else {
      await connection.execute(
        `INSERT INTO sales_channel_instances
           (channel_instance_id, business_id, provider, display_name, external_account_key, singleton_key,
            is_enabled, runtime_status, readiness_status, settings_json)
          VALUES (?, ?, 'amazon', ?, ?, NULL, 0, 'draft', 'not_tested', ?)`,
        [channelInstanceId, value.businessId, value.displayName, value.sellerId, JSON.stringify(settings)],
      );
    }
    const encryptedPayload = encrypt(JSON.stringify({
      refreshToken: value.refreshToken,
      sellerId: value.sellerId,
      region: 'far_east',
      authorizedAt: new Date().toISOString(),
    }));
    await connection.execute(
      `INSERT INTO sales_channel_credentials
         (channel_instance_id, credential_type, encrypted_payload, last_rotated_at)
       VALUES (?, 'amazon_sp_api', ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE encrypted_payload = VALUES(encrypted_payload),
         last_rotated_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)`,
      [channelInstanceId, encryptedPayload],
    );
    await connection.commit();
    return channelInstanceId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
