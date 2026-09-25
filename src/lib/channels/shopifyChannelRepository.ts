import { randomUUID } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { encrypt, decrypt } from '@/lib/encryption';
import { normalizeShopifyShopDomain, type ShopifyAuthMode } from '@/lib/shopifyCredentials';
import { getPool } from '@/services/MySQLService';

interface ShopifyInstanceRow extends RowDataPacket {
  channel_instance_id: string;
  business_id: string;
  display_name: string;
  external_account_key: string | null;
  encrypted_payload: string | null;
}

interface ShopifyCredentialEnvelope {
  authMode: ShopifyAuthMode;
  shopDomain: string;
  accessToken: string;
  clientId: string;
  clientSecret: string;
  tokenExpiresAt: number | null;
}

export interface ShopifyChannelConfiguration {
  channelInstanceId: string;
  displayName: string;
  shopDomain: string;
  authMode: ShopifyAuthMode;
  clientId: string;
  secretConfigured: boolean;
}

export class ShopifyChannelValidationError extends Error {}

function parseEnvelope(payload: string | null): ShopifyCredentialEnvelope | null {
  if (!payload) return null;
  const parsed = JSON.parse(decrypt(payload)) as Partial<ShopifyCredentialEnvelope>;
  if (parsed.authMode !== 'legacy_token' && parsed.authMode !== 'client_credentials') return null;
  return {
    authMode: parsed.authMode,
    shopDomain: normalizeShopifyShopDomain(String(parsed.shopDomain ?? '')),
    accessToken: String(parsed.accessToken ?? ''),
    clientId: String(parsed.clientId ?? ''),
    clientSecret: String(parsed.clientSecret ?? ''),
    tokenExpiresAt: parsed.tokenExpiresAt == null ? null : Number(parsed.tokenExpiresAt),
  };
}

async function loadInstance(connection: PoolConnection, channelInstanceId: string): Promise<ShopifyInstanceRow | null> {
  const [rows] = await connection.execute<ShopifyInstanceRow[]>(
    `SELECT instance.channel_instance_id, instance.business_id, instance.display_name,
            instance.external_account_key, credential.encrypted_payload
       FROM sales_channel_instances instance
       LEFT JOIN sales_channel_credentials credential
         ON credential.channel_instance_id = instance.channel_instance_id
        AND credential.credential_type = 'shopify_admin_api'
      WHERE instance.channel_instance_id = ? AND instance.provider = 'shopify'
      LIMIT 1 FOR UPDATE`,
    [channelInstanceId],
  );
  return rows[0] ?? null;
}

export async function getShopifyChannelConfiguration(input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<ShopifyChannelConfiguration | null> {
  const connection = await getPool().getConnection();
  try {
    const instance = await loadInstance(connection, input.channelInstanceId.trim());
    if (!instance || instance.business_id !== input.businessId.trim()) return null;
    const envelope = parseEnvelope(instance.encrypted_payload);
    return {
      channelInstanceId: instance.channel_instance_id,
      displayName: instance.display_name,
      shopDomain: normalizeShopifyShopDomain(instance.external_account_key ?? envelope?.shopDomain ?? ''),
      authMode: envelope?.authMode ?? 'client_credentials',
      clientId: envelope?.clientId ?? '',
      secretConfigured: Boolean(envelope && (envelope.authMode === 'client_credentials' ? envelope.clientSecret : envelope.accessToken)),
    };
  } finally {
    connection.release();
  }
}

export async function saveShopifyChannel(input: {
  businessId: string;
  channelInstanceId?: string | null;
  displayName: string;
  shopDomain: string;
  authMode: ShopifyAuthMode;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<string> {
  const businessId = input.businessId.trim();
  const channelInstanceId = input.channelInstanceId?.trim() || randomUUID();
  const displayName = input.displayName.trim();
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain);
  if (!businessId) throw new ShopifyChannelValidationError('Business ID is required.');
  if (!displayName || displayName.length > 120) throw new ShopifyChannelValidationError('Channel name must be 1-120 characters.');
  if (!shopDomain.endsWith('.myshopify.com')) {
    throw new ShopifyChannelValidationError('Enter the permanent Shopify store domain ending in .myshopify.com.');
  }
  if (input.authMode !== 'legacy_token' && input.authMode !== 'client_credentials') {
    throw new ShopifyChannelValidationError('Choose a valid Shopify authentication mode.');
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const existing = input.channelInstanceId ? await loadInstance(connection, channelInstanceId) : null;
    if (input.channelInstanceId && (!existing || existing.business_id !== businessId)) {
      throw new ShopifyChannelValidationError('Shopify channel not found.');
    }
    const [domainRows] = await connection.execute<ShopifyInstanceRow[]>(
      `SELECT channel_instance_id, business_id FROM sales_channel_instances
        WHERE provider = 'shopify' AND external_account_key = ? AND channel_instance_id <> ?
        LIMIT 1 FOR UPDATE`,
      [shopDomain, channelInstanceId],
    );
    if (domainRows[0]) throw new ShopifyChannelValidationError('This Shopify store is already connected.');

    const previous = parseEnvelope(existing?.encrypted_payload ?? null);
    const accessToken = input.authMode === 'legacy_token'
      ? (input.accessToken?.trim() || (previous?.authMode === 'legacy_token' ? previous.accessToken : '')) : '';
    const clientId = input.authMode === 'client_credentials' ? String(input.clientId ?? '').trim() : '';
    const clientSecret = input.authMode === 'client_credentials'
      ? (input.clientSecret?.trim() || (previous?.authMode === 'client_credentials' ? previous.clientSecret : '')) : '';
    if (input.authMode === 'legacy_token' && !accessToken) {
      throw new ShopifyChannelValidationError('Enter the Shopify Admin API access token.');
    }
    if (input.authMode === 'client_credentials' && (!clientId || !clientSecret)) {
      throw new ShopifyChannelValidationError('Enter the Shopify client ID and client secret.');
    }

    const credentialsChanged = !previous || previous.authMode !== input.authMode
      || previous.shopDomain !== shopDomain || previous.accessToken !== accessToken
      || previous.clientId !== clientId || previous.clientSecret !== clientSecret;
    const envelope: ShopifyCredentialEnvelope = {
      authMode: input.authMode,
      shopDomain,
      accessToken: credentialsChanged ? accessToken : previous?.accessToken ?? accessToken,
      clientId,
      clientSecret,
      tokenExpiresAt: credentialsChanged ? null : previous?.tokenExpiresAt ?? null,
    };
    if (existing) {
      await connection.execute(
        `UPDATE sales_channel_instances
            SET display_name = ?, external_account_key = ?, readiness_status = 'not_tested',
                runtime_status = IF(is_enabled = 1, 'paused', runtime_status), safe_error = NULL,
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify'`,
        [displayName, shopDomain, businessId, channelInstanceId],
      );
    } else {
      await connection.execute(
        `INSERT INTO sales_channel_instances
           (channel_instance_id, business_id, provider, display_name, external_account_key, singleton_key,
            is_enabled, runtime_status, readiness_status, settings_json)
         VALUES (?, ?, 'shopify', ?, ?, NULL, 0, 'draft', 'not_tested', JSON_OBJECT())`,
        [channelInstanceId, businessId, displayName, shopDomain],
      );
    }
    await connection.execute(
      `INSERT INTO sales_channel_credentials
         (channel_instance_id, credential_type, encrypted_payload, expires_at, last_rotated_at)
       VALUES (?, 'shopify_admin_api', ?, NULL, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE encrypted_payload = VALUES(encrypted_payload), expires_at = NULL,
         last_rotated_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)`,
      [channelInstanceId, encrypt(JSON.stringify(envelope))],
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