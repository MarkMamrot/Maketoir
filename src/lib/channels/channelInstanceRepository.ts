import { randomUUID } from 'crypto';

import { execute, query } from '@/services/MySQLService';
import {
  isSalesChannelProvider,
  isSalesChannelReadinessStatus,
  isSalesChannelRuntimeStatus,
  type SalesChannelInstance,
  type SalesChannelProvider,
} from './types';
import { normalizeChannelInventoryLocationIds } from './buildCapacityPolicy';

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

  async setProductPublicationEnabledForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    enabled: boolean;
  }): Promise<SalesChannelInstance | null> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    if (!businessId || !channelInstanceId) return null;
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()), '$.productPublicationEnabled', CAST(? AS UNSIGNED)),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ?`,
      [input.enabled ? 1 : 0, businessId, channelInstanceId],
    );
    return this.getForBusiness(businessId, channelInstanceId);
  },

  async setBuildCapacityPolicyForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    enabled: boolean;
    inventoryLocationIds: number[];
  }): Promise<SalesChannelInstance | null> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    if (!businessId || !channelInstanceId) return null;
    const inventoryLocationIds = normalizeChannelInventoryLocationIds(input.inventoryLocationIds);
    if (inventoryLocationIds.length > 100) {
      throw new SalesChannelValidationError('A channel can use at most 100 inventory locations.');
    }
    const locationArraySql = inventoryLocationIds.length
      ? `JSON_ARRAY(${inventoryLocationIds.map(() => 'CAST(? AS UNSIGNED)').join(', ')})`
      : 'JSON_ARRAY()';
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(
                COALESCE(settings_json, JSON_OBJECT()),
                '$.buildCapacityEnabled', CAST(? AS UNSIGNED),
                '$.inventoryLocationIds', ${locationArraySql}
              ),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ?`,
      [input.enabled ? 1 : 0, ...inventoryLocationIds, businessId, channelInstanceId],
    );
    return this.getForBusiness(businessId, channelInstanceId);
  },

  async setAmazonOrderLocationForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    locationId: number;
  }): Promise<SalesChannelInstance | null> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    const locationId = Math.floor(Number(input.locationId));
    if (!businessId || !channelInstanceId || !Number.isInteger(locationId) || locationId <= 0) {
      throw new SalesChannelValidationError('A valid Amazon dispatch location is required.');
    }
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()), '$.orderLocationId', CAST(? AS UNSIGNED)),
              readiness_status = 'not_tested', safe_error = NULL, updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [locationId, businessId, channelInstanceId],
    );
    return this.getForBusiness(businessId, channelInstanceId);
  },

  async invalidateAmazonReadinessForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
  }): Promise<void> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    if (!businessId || !channelInstanceId) return;
    await execute(
      `UPDATE sales_channel_instances
          SET readiness_status = 'not_tested', safe_error = NULL, updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [businessId, channelInstanceId],
    );
  },

  async markAmazonSetupOperationForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    operation: 'authorization' | 'listings' | 'inventory';
    completedAt?: string;
  }): Promise<void> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    const completedAt = (input.completedAt ?? new Date().toISOString()).trim();
    const settingPath = {
      authorization: '$.authorizationVerifiedAt',
      listings: '$.listingsLastSyncedAt',
      inventory: '$.inventoryLastSyncedAt',
    }[input.operation];
    const invalidatesActiveReadiness = input.operation === 'listings' ? 1 : 0;
    if (!businessId || !channelInstanceId || !completedAt) {
      throw new SalesChannelValidationError('A valid Amazon setup operation is required.');
    }
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()), ?, ?),
              readiness_status = IF(is_enabled = 1 AND ? = 0, readiness_status, 'not_tested'),
              safe_error = IF(is_enabled = 1 AND ? = 0, safe_error, NULL),
              last_sync_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [settingPath, completedAt, invalidatesActiveReadiness, invalidatesActiveReadiness, businessId, channelInstanceId],
    );
  },

  async setAmazonOrderSyncCursorForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    lastUpdatedAt: string;
  }): Promise<void> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    const lastUpdatedAt = input.lastUpdatedAt.trim();
    if (!businessId || !channelInstanceId || !lastUpdatedAt) {
      throw new SalesChannelValidationError('A valid Amazon order cursor is required.');
    }
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_REMOVE(
                JSON_SET(COALESCE(settings_json, JSON_OBJECT()), '$.ordersLastUpdatedAt', ?),
                '$.ordersContinuationAfter', '$.ordersContinuationBefore', '$.ordersContinuationToken'),
              last_sync_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [lastUpdatedAt, businessId, channelInstanceId],
    );
  },

  async setAmazonOrderSyncContinuationForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    lastUpdatedAfter: string;
    lastUpdatedBefore: string;
    nextToken: string;
  }): Promise<void> {
    const { businessId, channelInstanceId, lastUpdatedAfter, lastUpdatedBefore, nextToken } = input;
    if (![businessId, channelInstanceId, lastUpdatedAfter, lastUpdatedBefore].every(value => value.trim())) {
      throw new SalesChannelValidationError('A valid Amazon order continuation is required.');
    }
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()),
                '$.ordersContinuationAfter', ?, '$.ordersContinuationBefore', ?, '$.ordersContinuationToken', ?),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [lastUpdatedAfter, lastUpdatedBefore, nextToken, businessId, channelInstanceId],
    );
  },

  async clearAmazonOrderSyncContinuationForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
  }): Promise<void> {
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_REMOVE(COALESCE(settings_json, JSON_OBJECT()),
                '$.ordersContinuationAfter', '$.ordersContinuationBefore', '$.ordersContinuationToken'),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [input.businessId.trim(), input.channelInstanceId.trim()],
    );
  },

  async setAmazonReturnSyncCursorForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    lastRequestedAt: string;
  }): Promise<void> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    const lastRequestedAt = input.lastRequestedAt.trim();
    if (!businessId || !channelInstanceId || !lastRequestedAt) {
      throw new SalesChannelValidationError('A valid Amazon returns cursor is required.');
    }
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()), '$.returnsLastRequestedAt', ?),
              last_sync_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [lastRequestedAt, businessId, channelInstanceId],
    );
  },

  async setAmazonRefundSyncCursorForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    lastPostedAt: string;
    ambiguousCount?: number;
  }): Promise<void> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    const lastPostedAt = input.lastPostedAt.trim();
    if (!businessId || !channelInstanceId || !lastPostedAt) {
      throw new SalesChannelValidationError('A valid Amazon refund cursor is required.');
    }
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_REMOVE(
                JSON_SET(COALESCE(settings_json, JSON_OBJECT()),
                  '$.refundsLastPostedAt', ?, '$.refundsAmbiguousCount', CAST(? AS UNSIGNED),
                  '$.refundsLastReconciledAt', ?),
                '$.refundsContinuationAfter', '$.refundsContinuationBefore', '$.refundsContinuationToken'),
              last_sync_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [lastPostedAt, Math.max(0, Math.floor(Number(input.ambiguousCount ?? 0))), new Date().toISOString(),
        businessId, channelInstanceId],
    );
  },

  async setAmazonRefundSyncContinuationForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    postedAfter: string;
    postedBefore: string;
    nextToken: string;
    ambiguousCount?: number;
  }): Promise<void> {
    const { businessId, channelInstanceId, postedAfter, postedBefore, nextToken } = input;
    if (![businessId, channelInstanceId, postedAfter, postedBefore, nextToken].every(value => value.trim())) {
      throw new SalesChannelValidationError('A valid Amazon refund continuation is required.');
    }
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()),
            '$.refundsContinuationAfter', ?, '$.refundsContinuationBefore', ?, '$.refundsContinuationToken', ?,
            '$.refundsAmbiguousCount', CAST(? AS UNSIGNED), '$.refundsLastReconciledAt', ?),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [postedAfter, postedBefore, nextToken, Math.max(0, Math.floor(Number(input.ambiguousCount ?? 0))),
        new Date().toISOString(), businessId, channelInstanceId],
    );
  },

  async clearAmazonRefundSyncContinuationForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
  }): Promise<void> {
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_REMOVE(COALESCE(settings_json, JSON_OBJECT()),
                '$.refundsContinuationAfter', '$.refundsContinuationBefore', '$.refundsContinuationToken'),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [input.businessId.trim(), input.channelInstanceId.trim()],
    );
  },

  async setAmazonRefundAmbiguityForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    ambiguousCount: number;
  }): Promise<void> {
    await execute(
      `UPDATE sales_channel_instances
          SET settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()),
                '$.refundsAmbiguousCount', CAST(? AS UNSIGNED), '$.refundsLastReconciledAt', ?),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'`,
      [Math.max(0, Math.floor(Number(input.ambiguousCount))), new Date().toISOString(),
        input.businessId.trim(), input.channelInstanceId.trim()],
    );
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
                WHEN is_enabled = 0 AND runtime_status = 'draft' THEN 'draft'
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

  async setAmazonActivationForBusiness(input: {
    businessId: string;
    channelInstanceId: string;
    active: boolean;
    actorUserId?: number | null;
  }): Promise<SalesChannelInstance | null> {
    const businessId = input.businessId.trim();
    const channelInstanceId = input.channelInstanceId.trim();
    if (!businessId || !channelInstanceId) return null;
    const changedAt = new Date().toISOString();
    const settingPath = input.active ? '$.activatedAt' : '$.deactivatedAt';
    const actorPath = input.active ? '$.activatedByUserId' : '$.deactivatedByUserId';
    const result = await execute(
      `UPDATE sales_channel_instances
          SET is_enabled = ?, runtime_status = ?, safe_error = NULL,
              settings_json = JSON_SET(COALESCE(settings_json, JSON_OBJECT()), ?, ?, ?, ?),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'
          AND (? = 0 OR readiness_status = 'ready')`,
      [input.active ? 1 : 0, input.active ? 'active' : 'paused', settingPath, changedAt,
        actorPath, input.actorUserId ?? null, businessId, channelInstanceId, input.active ? 1 : 0],
    );
    if (Number(result.affectedRows ?? 0) !== 1) return null;
    return this.getForBusiness(businessId, channelInstanceId);
  },

  async markSyncedForBusiness(businessIdInput: string, channelInstanceIdInput: string): Promise<void> {
    const businessId = businessIdInput.trim();
    const channelInstanceId = channelInstanceIdInput.trim();
    if (!businessId || !channelInstanceId) return;
    await execute(
      `UPDATE sales_channel_instances
          SET last_sync_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
        WHERE business_id = ? AND channel_instance_id = ?`,
      [businessId, channelInstanceId],
    );
  },
};
