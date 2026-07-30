import { createHash } from 'crypto';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { MetaAdsReadService, type MetaBudgetSettings } from '@/services/MetaAdsReadService';
import { ForesightMetaRollbackPreflightService } from './ForesightMetaRollbackPreflightService';
import {
  metaRollbackPreflightFingerprint,
  type MetaRollbackChangePreview,
  type MetaRollbackPreflightResult,
} from './metaRollbackPreflight';
import { ForesightExecutionRepository, type ForesightExecutionRow } from './repositories/ForesightExecutionRepository';

interface MetaRollbackClient {
  updateDailyBudgets(changes: Array<{ entityType: 'campaign' | 'adset'; entityId: string; dailyBudgetMinor: number }>): Promise<unknown[]>;
  getBudgetSettings(input: { campaignIds: string[]; adSetIds: string[] }): Promise<MetaBudgetSettings>;
}

interface Dependencies {
  preflight(businessId: string, recommendationId: number, originalExecutionId: number, proposalHash: string): Promise<MetaRollbackPreflightResult>;
  findExecution(businessId: string, idempotencyKey: string): Promise<ForesightExecutionRow | null>;
  claimCompensation(input: Parameters<typeof ForesightExecutionRepository.claimCompensation>[0]): ReturnType<typeof ForesightExecutionRepository.claimCompensation>;
  completeCompensation(input: Parameters<typeof ForesightExecutionRepository.completeCompensation>[0]): ReturnType<typeof ForesightExecutionRepository.completeCompensation>;
  createMetaClient(businessId: string): Promise<MetaRollbackClient>;
}

function idempotencyKey(input: { businessId: string; recommendationId: number; originalExecutionId: number; proposalHash: string; confirmationFingerprint: string }): string {
  return createHash('sha256').update([
    'meta_ads', input.businessId, input.recommendationId, input.originalExecutionId,
    'rollback', input.proposalHash, input.confirmationFingerprint,
  ].join(':')).digest('hex');
}

function changes(execution: ForesightExecutionRow): MetaRollbackChangePreview[] {
  const value = execution.request_json.changes;
  if (!Array.isArray(value)) throw new Error('Stored Meta compensation request is invalid.');
  return value as MetaRollbackChangePreview[];
}

function matches(settings: MetaBudgetSettings, values: MetaRollbackChangePreview[], field: 'currentDailyBudgetMinor' | 'proposedDailyBudgetMinor'): boolean {
  return values.length > 0 && values.every(change => {
    const live = change.entityType === 'campaign'
      ? settings.campaigns.find(item => item.campaignId === change.entityId)
      : settings.adSets.find(item => item.adSetId === change.entityId);
    return live?.dailyBudgetMinor === change[field];
  });
}

async function readBack(client: MetaRollbackClient, values: MetaRollbackChangePreview[]) {
  return client.getBudgetSettings({
    campaignIds: values.filter(change => change.entityType === 'campaign').map(change => change.entityId),
    adSetIds: values.filter(change => change.entityType === 'adset').map(change => change.entityId),
  });
}

async function defaultClient(businessId: string): Promise<MetaRollbackClient> {
  const connection = await ConnectionsRepository.get(businessId);
  const accountId = connection?.meta_ad_account_id?.trim() ?? '';
  const token = connection?.meta_access_token?.trim() ?? '';
  if (!accountId || !token) throw new Error('Meta ad account ID and tenant access token are required.');
  return new MetaAdsReadService(decrypt(token), accountId);
}

const defaults: Dependencies = {
  preflight: (...args) => ForesightMetaRollbackPreflightService.preflight(...args),
  findExecution: (...args) => ForesightExecutionRepository.findByIdempotencyKey(...args),
  claimCompensation: input => ForesightExecutionRepository.claimCompensation(input),
  completeCompensation: input => ForesightExecutionRepository.completeCompensation(input),
  createMetaClient: defaultClient,
};

export function createForesightMetaRollbackService(dependencies: Dependencies = defaults) {
  async function reconcile(businessId: string, actorId: number, execution: ForesightExecutionRow, client: MetaRollbackClient, response: Record<string, unknown> | null, mutationError: string | null) {
    const stored = changes(execution);
    try {
      const live = await readBack(client, stored);
      const matchesRestored = matches(live, stored, 'proposedDailyBudgetMinor');
      const matchesPreRollback = matches(live, stored, 'currentDailyBudgetMinor');
      return dependencies.completeCompensation({
        businessId, executionId: execution.id, actorId,
        state: matchesRestored ? 'succeeded' : 'failed', response,
        after: { settings: live, matchesRestored, matchesPreRollback },
        errorText: matchesRestored ? null : matchesPreRollback
          ? mutationError ?? 'Meta Ads budgets remain unchanged after rollback.'
          : 'Meta Ads rollback read-back matches neither the pre-rollback nor restored values. Manual review is required.',
        platform: 'meta_ads',
      });
    } catch (error) {
      const readBackError = error instanceof Error ? error.message : 'Meta Ads rollback read-back failed.';
      return dependencies.completeCompensation({
        businessId, executionId: execution.id, actorId, state: 'failed', response, after: null,
        errorText: mutationError ? `${mutationError} Rollback read-back also failed: ${readBackError}` : `Rollback state is uncertain because read-back failed: ${readBackError}`,
        platform: 'meta_ads',
      });
    }
  }

  return {
    async rollback(input: { businessId: string; recommendationId: number; originalExecutionId: number; actorId: number; proposalHash: string; confirmationFingerprint: string }) {
      const key = idempotencyKey(input);
      const existing = await dependencies.findExecution(input.businessId, key);
      if (existing && existing.state !== 'in_progress') return { execution: existing, idempotentReplay: true, mutationSubmitted: false };
      if (existing) {
        const client = await dependencies.createMetaClient(input.businessId);
        return { execution: await reconcile(input.businessId, input.actorId, existing, client, null, null), idempotentReplay: true, mutationSubmitted: false };
      }

      const preflight = await dependencies.preflight(input.businessId, input.recommendationId, input.originalExecutionId, input.proposalHash);
      const fingerprint = metaRollbackPreflightFingerprint(preflight);
      if (!preflight.ready || preflight.blockers.length > 0 || preflight.changes.length === 0) {
        throw new Error('Live rollback preflight is blocked; no Meta Ads changes were submitted.');
      }
      if (fingerprint !== input.confirmationFingerprint || preflight.confirmationFingerprint !== fingerprint) {
        throw new Error('Live Meta Ads settings changed; run rollback preflight and confirm the exact restoration again.');
      }

      const claim = await dependencies.claimCompensation({
        businessId: input.businessId, recommendationId: input.recommendationId,
        originalExecutionId: input.originalExecutionId, actorId: input.actorId,
        proposalHash: input.proposalHash, idempotencyKey: key,
        before: { account: preflight.account, changes: preflight.changes.map(change => ({ entityType: change.entityType, entityId: change.entityId, dailyBudgetMinor: change.currentDailyBudgetMinor })) },
        request: { platform: 'meta_ads', operation: 'restore_daily_budgets', confirmationFingerprint: fingerprint, changes: preflight.changes },
        platform: 'meta_ads',
      });
      const client = await dependencies.createMetaClient(input.businessId);
      if (!claim.created) {
        if (claim.execution.state !== 'in_progress') return { execution: claim.execution, idempotentReplay: true, mutationSubmitted: false };
        return { execution: await reconcile(input.businessId, input.actorId, claim.execution, client, null, null), idempotentReplay: true, mutationSubmitted: false };
      }

      let response: Record<string, unknown> | null = null;
      let mutationError: string | null = null;
      try {
        const result = await client.updateDailyBudgets(preflight.changes.map(change => ({
          entityType: change.entityType, entityId: change.entityId, dailyBudgetMinor: change.proposedDailyBudgetMinor,
        })));
        response = { metaAds: JSON.parse(JSON.stringify(result)) };
      } catch (error) {
        mutationError = error instanceof Error ? error.message : 'Meta Ads rollback mutation failed.';
        response = { metaAdsError: mutationError };
      }
      return {
        execution: await reconcile(input.businessId, input.actorId, claim.execution, client, response, mutationError),
        idempotentReplay: false, mutationSubmitted: true,
      };
    },
  };
}

export const ForesightMetaRollbackService = createForesightMetaRollbackService();
