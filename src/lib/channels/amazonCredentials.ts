import { decrypt } from '@/lib/encryption';
import { query } from '@/services/MySQLService';
import { refreshAmazonAccessToken } from './amazonSpApi';

interface AmazonCredentialRow {
  encrypted_payload: string;
  external_account_key: string;
}

interface AmazonCredentialEnvelope {
  refreshToken?: string;
  sellerId?: string;
  region?: string;
}

export async function getAmazonChannelAccess(
  businessIdInput: string,
  channelInstanceIdInput: string,
): Promise<{ accessToken: string; sellerId: string } | null> {
  const businessId = businessIdInput.trim();
  const channelInstanceId = channelInstanceIdInput.trim();
  if (!businessId || !channelInstanceId) return null;
  const rows = await query<AmazonCredentialRow>(
    `SELECT credential.encrypted_payload, instance.external_account_key
       FROM sales_channel_instances instance
       JOIN sales_channel_credentials credential
         ON credential.channel_instance_id = instance.channel_instance_id
        AND credential.credential_type = 'amazon_sp_api'
      WHERE instance.business_id = ? AND instance.channel_instance_id = ? AND instance.provider = 'amazon'
      LIMIT 1`,
    [businessId, channelInstanceId],
  );
  if (!rows[0]) return null;
  const envelope = JSON.parse(decrypt(rows[0].encrypted_payload)) as AmazonCredentialEnvelope;
  const refreshToken = String(envelope.refreshToken ?? '').trim();
  const sellerId = String(rows[0].external_account_key ?? '').trim().toUpperCase();
  if (!refreshToken || !sellerId || (envelope.sellerId && String(envelope.sellerId).toUpperCase() !== sellerId)) {
    throw new Error('Amazon channel credentials are invalid.');
  }
  const token = await refreshAmazonAccessToken(refreshToken);
  return { accessToken: token.accessToken, sellerId };
}
