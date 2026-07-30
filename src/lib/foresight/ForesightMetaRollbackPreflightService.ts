import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { MetaAdsReadService } from '@/services/MetaAdsReadService';
import type { MetaBudgetChangePreview } from './metaExecutionPreflight';
import {
  planMetaBudgetRollbackPreflight,
  type MetaRollbackPreflightResult,
} from './metaRollbackPreflight';
import { ForesightExecutionRepository } from './repositories/ForesightExecutionRepository';
import { ForesightRepository } from './repositories/ForesightRepository';

function blocked(originalExecutionId: number, code: string, message: string): MetaRollbackPreflightResult {
  return {
    mode: 'meta_rollback_preflight', executable: false, ready: false,
    checkedAt: new Date().toISOString(), confirmationFingerprint: null,
    originalExecutionId, account: null, changes: [], blockers: [{ code, message }],
  };
}

function originalChanges(value: unknown): MetaBudgetChangePreview[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === 'object'
    && (item as MetaBudgetChangePreview).source === 'meta_ads'
    && ((item as MetaBudgetChangePreview).entityType === 'campaign' || (item as MetaBudgetChangePreview).entityType === 'adset')) as MetaBudgetChangePreview[];
}

export const ForesightMetaRollbackPreflightService = {
  async preflight(
    businessId: string,
    recommendationId: number,
    originalExecutionId: number,
    proposalHash: string,
  ): Promise<MetaRollbackPreflightResult> {
    const [execution, recommendation, compensation] = await Promise.all([
      ForesightExecutionRepository.getExecution(businessId, originalExecutionId),
      ForesightRepository.getRecommendation(businessId, recommendationId),
      ForesightExecutionRepository.findCompensation(businessId, originalExecutionId),
    ]);
    if (!execution) return blocked(originalExecutionId, 'execution_not_found', 'The original Meta execution was not found.');
    if (execution.recommendation_id !== recommendationId || execution.compensates_execution_id != null || execution.request_json.platform !== 'meta_ads') {
      return blocked(originalExecutionId, 'execution_mismatch', 'The execution is not an original Meta execution for this recommendation.');
    }
    if (execution.state !== 'succeeded' || execution.after_json?.matchesProposed !== true) {
      return blocked(originalExecutionId, 'execution_not_verified', 'Only a verified successful Meta execution can be rolled back.');
    }
    if (compensation) return blocked(originalExecutionId, 'rollback_already_attempted', 'A compensation receipt already exists for this execution.');
    if (!recommendation || recommendation.state !== 'succeeded') {
      return blocked(originalExecutionId, 'recommendation_not_succeeded', 'The recommendation is not eligible for rollback.');
    }
    if (!recommendation.proposal_hash || recommendation.proposal_hash !== proposalHash) {
      return blocked(originalExecutionId, 'proposal_hash_mismatch', 'The proposal changed; refresh before rollback.');
    }

    const changes = originalChanges(execution.request_json.changes);
    if (changes.length === 0) return blocked(originalExecutionId, 'invalid_execution_receipt', 'The Meta receipt has no reversible budget changes.');
    const receiptAccount = execution.before_json.account as { accountId?: unknown } | undefined;
    const receiptAccountId = typeof receiptAccount?.accountId === 'string' ? receiptAccount.accountId.replace(/^act_/i, '') : '';
    const connection = await ConnectionsRepository.get(businessId);
    const accountId = connection?.meta_ad_account_id?.trim() ?? '';
    const storedToken = connection?.meta_access_token?.trim() ?? '';
    if (!accountId || !storedToken) return blocked(originalExecutionId, 'meta_connection_incomplete', 'Meta ad account ID and tenant access token are required.');
    if (receiptAccountId !== accountId.replace(/^act_/i, '')) {
      return blocked(originalExecutionId, 'account_changed', 'The connected Meta account differs from the original execution receipt.');
    }

    const service = new MetaAdsReadService(decrypt(storedToken), accountId);
    const settings = await service.getBudgetSettings({
      campaignIds: changes.filter(change => change.entityType === 'campaign').map(change => change.entityId),
      adSetIds: changes.filter(change => change.entityType === 'adset').map(change => change.entityId),
    });
    return planMetaBudgetRollbackPreflight({
      originalExecutionId, expectedAccountId: accountId, originalChanges: changes,
      liveSettings: settings, checkedAt: new Date().toISOString(),
    });
  },
};
