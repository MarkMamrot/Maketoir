import { randomUUID } from 'crypto';

import { execute, query } from '@/services/MySQLService';
import {
  isSalesChannelProvider,
  isSalesChannelReadinessStatus,
  isSalesChannelRuntimeStatus,
  type SalesChannelInstance,
  type SalesChannelProvider,
} from './types';

interface SalesChannelInstanceRow {
  channel_instance_id: string;
  business_id: string;
  provider: string;
  display_name: string;
  external_account_key: string | null;
  is_enabled: number;
  runtime_status: string;
  readiness_status: string;
  settings_json: string | Record<string, unknown> | null;
  last_sync_at: string | null;
  safe_error: string | null;
}

export class SalesChannelValidationError extends Error {}

function parseSettings(value: SalesChannelInstanceRow['settings_json']): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapInstance(row: SalesChannelInstanceRow): SalesChannelInstance {
  if (!isSalesChannelProvider(row.provider)) throw new Error(`Unsupported sales channel provider: ${row.provider}.`);
  if (!isSalesChannelRuntimeStatus(row.runtime_status)) throw new Error(`Unsupported sales channel runtime status: ${row.runtime_status}.`);
  if (!isSalesChannelReadinessStatus(row.readiness_status)) throw new Error(`Unsupported sales channel readiness status: ${row.readiness_status}.`);
  return {
    channelInstanceId: row.channel_instance_id,
    businessId: row.business_id,
    provider: row.provider,
    displayName: row.display_name,
    externalAccountKey: row.external_account_key,
    enabled: row.is_enabled === 1,
    runtimeStatus: row.runtime_status,
    readinessStatus: row.readiness_status,
    settings: parseSettings(row.settings_json),
    lastSyncAt: row.last_sync_at,
    safeError: row.safe_error,
  };
}

function validateCreateInput(input: {
  businessId: string;
  provider: SalesChannelProvider;
  displayName: string;
  externalAccountKey?: string | null;
}): { businessId: string; displayName: string; externalAccountKey: string | null } {
  const businessId = input.businessId.trim();
  const displayName = input.displayName.trim();
  const externalAccountKey = input.externalAccountKey?.trim() || null;
  if (!businessId) throw new SalesChannelValidationError('Business ID is required.');
  if (!displayName) throw new SalesChannelValidationError('Channel display name is required.');
  if (displayName.length > 120) throw new SalesChannelValidationError('Channel display name must be 120 characters or fewer.');
  if (input.provider !== 'native_shop' && !externalAccountKey) {
    throw new SalesChannelValidationError(`External account identity is required for ${input.provider}.`);
  }
  return { businessId, displayName, externalAccountKey };
}

export const SalesChannelInstanceRepository = {
  async listForBusiness(businessIdInput: string): Promise<SalesChannelInstance[]> {
    const businessId = businessIdInput.trim();
    if (!businessId) return [];
    const rows = await query<SalesChannelInstanceRow>(
      `SELECT channel_instance_id, business_id, provider, display_name, external_account_key,
              is_enabled, runtime_status, readiness_status, settings_json, last_sync_at, safe_error
         FROM sales_channel_instances
        WHERE business_id = ?
        ORDER BY provider, display_name, channel_instance_id`,
      [businessId],
    );
    return rows.map(mapInstance);
  },

  async getForBusiness(businessIdInput: string, channelInstanceIdInput: string): Promise<SalesChannelInstance | null> {
    const businessId = businessIdInput.trim();
    const channelInstanceId = channelInstanceIdInput.trim();
    if (!businessId || !channelInstanceId) return null;
    const rows = await query<SalesChannelInstanceRow>(
      `SELECT channel_instance_id, business_id, provider, display_name, external_account_key,
              is_enabled, runtime_status, readiness_status, settings_json, last_sync_at, safe_error
         FROM sales_channel_instances
        WHERE business_id = ? AND channel_instance_id = ?
        LIMIT 1`,
      [businessId, channelInstanceId],
    );
    return rows[0] ? mapInstance(rows[0]) : null;
  },

  async create(input: {
    businessId: string;
    provider: SalesChannelProvider;
    displayName: string;
    externalAccountKey?: string | null;
    settings?: Record<string, unknown>;
    channelInstanceId?: string;
  }): Promise<string> {
    const validated = validateCreateInput(input);
    const channelInstanceId = input.channelInstanceId?.trim() || randomUUID();
    const singletonKey = input.provider === 'native_shop' ? 'native_shop' : null;
    await execute(
      `INSERT INTO sales_channel_instances
         (channel_instance_id, business_id, provider, display_name, external_account_key,
          singleton_key, is_enabled, runtime_status, readiness_status, settings_json)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', 'not_tested', ?)`,
      [channelInstanceId, validated.businessId, input.provider, validated.displayName,
        validated.externalAccountKey, singletonKey, JSON.stringify(input.settings ?? {})],
    );
    return channelInstanceId;
  },

  async renameForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    displayName: string;
  }): Promise<SalesChannelInstance | null> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    if (!businessId || !channelInstanceId) return null;
    const displayName = input.displayName.trim();
    if (!displayName) throw new SalesChannelValidationError('Channel display name is required.');
    if (displayName.length > 120) throw new SalesChannelValidationError('Channel display name must be 120 characters or fewer.');

    await execute(
      `UPDATE sales_channel_instances
          SET display_name = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ?`,
      [displayName, businessId, channelInstanceId],
    );
    return this.getForBusiness(businessId, channelInstanceId);
  },

  async setReadinessForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    ready: boolean;
    safeError?: string | null;
  }): Promise<SalesChannelInstance | null> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    if (!businessId || !channelInstanceId) return null;
    const safeError = input.ready ? null : (input.safeError?.trim() || 'Connection test failed.').slice(0, 1000);
    await execute(
      `UPDATE sales_channel_instances
          SET readiness_status = ?, safe_error = ?,
              runtime_status = CASE
                WHEN is_enabled = 0 THEN 'paused'
                WHEN ? = 1 THEN 'active'
                ELSE 'error'
              END,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ?`,
      [input.ready ? 'ready' : 'error', safeError, input.ready ? 1 : 0, businessId, channelInstanceId],
    );
    return this.getForBusiness(businessId, channelInstanceId);
  },
};
