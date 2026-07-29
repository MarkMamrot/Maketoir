import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { normalizeCampaignSetting } from './ForesightExecutionPreflightService';
import type { GoogleCampaignSetting } from './executionPreflight';
import {
  planGoogleBudgetRollbackPreflight,
  type RollbackPreflightResult,
  type StoredBudgetValue,
} from './rollbackPreflight';
import { ForesightExecutionRepository } from './repositories/ForesightExecutionRepository';
import { ForesightRepository } from './repositories/ForesightRepository';

function blocked(
  originalExecutionId: number,
  code: string,
  message: string,
): RollbackPreflightResult {
  return {
    mode: 'rollback_preflight',
    executable: false,
    ready: false,
    checkedAt: new Date().toISOString(),
    confirmationFingerprint: null,
    originalExecutionId,
    account: null,
    changes: [],
    blockers: [{ code, message }],
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function storedBeforeValues(value: unknown): StoredBudgetValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const amountMicros = Number(row?.amountMicros);
    if (!row || typeof row.campaignId !== 'string' || typeof row.budgetId !== 'string') return [];
    return [{
      campaignId: row.campaignId,
      budgetId: row.budgetId,
      amountMicros,
      currencyCode: typeof row.currencyCode === 'string' ? row.currencyCode : '',
    }];
  });
}

function storedAfterValues(value: unknown): GoogleCampaignSetting[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    if (!row) return [];
    const amountMicros = Number(row.amountMicros);
    const referenceCount = Number(row.referenceCount);
    if (
      typeof row.customerId !== 'string'
      || typeof row.campaignId !== 'string'
      || typeof row.budgetId !== 'string'
      || !Number.isFinite(amountMicros)
    ) return [];
    return [{
      customerId: row.customerId,
      currencyCode: typeof row.currencyCode === 'string' ? row.currencyCode : '',
      campaignId: row.campaignId,
      campaignName: typeof row.campaignName === 'string' ? row.campaignName : row.campaignId,
      status: typeof row.status === 'string' ? row.status : '',
      budgetId: row.budgetId,
      budgetName: typeof row.budgetName === 'string' ? row.budgetName : row.budgetId,
      amountMicros,
      explicitlyShared: row.explicitlyShared === true,
      referenceCount: Number.isFinite(referenceCount) ? referenceCount : 0,
    }];
  });
}

export const ForesightRollbackPreflightService = {
  async preflight(
    businessId: string,
    recommendationId: number,
    originalExecutionId: number,
    proposalHash: string,
  ): Promise<RollbackPreflightResult> {
    const [execution, recommendation, compensation] = await Promise.all([
      ForesightExecutionRepository.getExecution(businessId, originalExecutionId),
      ForesightRepository.getRecommendation(businessId, recommendationId),
      ForesightExecutionRepository.findCompensation(businessId, originalExecutionId),
    ]);
    if (!execution) return blocked(originalExecutionId, 'execution_not_found', 'The original execution was not found.');
    if (execution.recommendation_id !== recommendationId || execution.compensates_execution_id != null) {
      return blocked(originalExecutionId, 'execution_mismatch', 'The execution does not belong to this recommendation or is already a compensation.');
    }
    if (execution.state !== 'succeeded') {
      return blocked(originalExecutionId, 'execution_not_succeeded', 'Only a verified successful execution can be rolled back.');
    }
    if (compensation) {
      return blocked(originalExecutionId, 'rollback_already_attempted', 'A compensation receipt already exists for this execution.');
    }
    if (!recommendation || recommendation.state !== 'succeeded') {
      return blocked(originalExecutionId, 'recommendation_not_succeeded', 'The recommendation is not eligible for rollback.');
    }
    if (!recommendation.proposal_hash || recommendation.proposal_hash !== proposalHash) {
      return blocked(originalExecutionId, 'proposal_hash_mismatch', 'The proposal changed; refresh before rollback.');
    }

    const before = record(execution.before_json);
    const after = record(execution.after_json);
    if (after?.matchesProposed !== true) {
      return blocked(originalExecutionId, 'execution_not_verified', 'The original execution has no verified successful read-back.');
    }
    const beforeValues = storedBeforeValues(before?.campaigns);
    const afterValues = storedAfterValues(after.campaigns);
    if (beforeValues.length === 0 || afterValues.length !== beforeValues.length) {
      return blocked(originalExecutionId, 'invalid_execution_receipt', 'The execution receipt does not contain a complete reversible budget state.');
    }

    const connection = await ConnectionsRepository.get(businessId);
    const customerId = connection?.google_ads_customer_id?.trim() ?? '';
    const storedRefreshToken = connection?.google_ads_refresh_token?.trim() ?? '';
    if (!customerId || !storedRefreshToken) {
      return blocked(originalExecutionId, 'google_connection_incomplete', 'Google Ads customer ID and tenant refresh token are required.');
    }
    const receiptCustomerId = String(record(before?.account)?.customerId ?? '');
    if (receiptCustomerId.replace(/-/g, '') !== customerId.replace(/-/g, '')) {
      return blocked(originalExecutionId, 'account_changed', 'The connected Google Ads customer differs from the original execution receipt.');
    }

    const service = new GoogleAdsService(customerId, decrypt(storedRefreshToken));
    const rows = await service.getCampaignSettings(beforeValues.map((value) => value.campaignId));
    return planGoogleBudgetRollbackPreflight({
      originalExecutionId,
      expectedCustomerId: customerId,
      beforeValues,
      verifiedAfterValues: afterValues,
      liveCampaigns: (Array.isArray(rows) ? rows : []).map(normalizeCampaignSetting),
      checkedAt: new Date().toISOString(),
    });
  },
};