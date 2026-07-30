import { createHash } from 'crypto';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { MetaAdsReadService, type MetaBudgetSettings } from '@/services/MetaAdsReadService';
import {
  metaExecutionPreflightFingerprint,
  type MetaBudgetChangePreview,
  type MetaExecutionPreflightResult,
} from './metaExecutionPreflight';
import { ForesightMetaExecutionPreflightService } from './ForesightMetaExecutionPreflightService';
import {
  ForesightExecutionRepository,
  type ForesightExecutionRow,
} from './repositories/ForesightExecutionRepository';
import {
  getBudgetChangeNotificationEmail,
  sendMetaBudgetChangeNotification,
} from './budgetChangeNotification';

interface MetaBudgetClient {
  updateDailyBudgets(changes: Array<{
    entityType: 'campaign' | 'adset';
    entityId: string;
    dailyBudgetMinor: number;
  }>): Promise<unknown[]>;
  getBudgetSettings(input: { campaignIds: string[]; adSetIds: string[] }): Promise<MetaBudgetSettings>;
}

interface MetaExecutionDependencies {
  preflight(businessId: string, recommendationId: number, proposalHash: string): Promise<MetaExecutionPreflightResult>;
  findExecution(businessId: string, idempotencyKey: string): Promise<ForesightExecutionRow | null>;
  claimExecution(input: Parameters<typeof ForesightExecutionRepository.claim>[0]): ReturnType<typeof ForesightExecutionRepository.claim>;
  completeExecution(input: Parameters<typeof ForesightExecutionRepository.complete>[0]): ReturnType<typeof ForesightExecutionRepository.complete>;
  createMetaClient(businessId: string): Promise<MetaBudgetClient>;
  notifyBudgetChange(input: {
    businessId: string;
    recommendationId: number;
    executionId: number;
    changes: MetaBudgetChangePreview[];
  }): Promise<void>;
}

export interface ForesightMetaExecutionResult {
  execution: ForesightExecutionRow;
  idempotentReplay: boolean;
  mutationSubmitted: boolean;
  notification: 'sent' | 'failed' | 'not_sent';
  notificationError?: string;
}

function idempotencyKey(input: {
  businessId: string;
  recommendationId: number;
  proposalHash: string;
  confirmationFingerprint: string;
}): string {
  return createHash('sha256').update([
    'meta_ads', input.businessId, input.recommendationId, input.proposalHash, input.confirmationFingerprint,
  ].join(':')).digest('hex');
}

function serializable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, child) => (
    typeof child === 'bigint' ? child.toString() : child
  )));
}

function requestChanges(execution: ForesightExecutionRow): MetaBudgetChangePreview[] {
  const changes = execution.request_json.changes;
  if (!Array.isArray(changes)) throw new Error('Stored Meta execution request is invalid.');
  return changes as MetaBudgetChangePreview[];
}

function readBackMatches(settings: MetaBudgetSettings, changes: MetaBudgetChangePreview[], field: 'currentDailyBudgetMinor' | 'proposedDailyBudgetMinor'): boolean {
  return changes.length > 0 && changes.every(change => {
    const live = change.entityType === 'campaign'
      ? settings.campaigns.find(item => item.campaignId === change.entityId)
      : settings.adSets.find(item => item.adSetId === change.entityId);
    return live?.dailyBudgetMinor === change[field];
  });
}

async function readBack(client: MetaBudgetClient, changes: MetaBudgetChangePreview[]): Promise<MetaBudgetSettings> {
  return client.getBudgetSettings({
    campaignIds: changes.filter(change => change.entityType === 'campaign').map(change => change.entityId),
    adSetIds: changes.filter(change => change.entityType === 'adset').map(change => change.entityId),
  });
}

async function defaultMetaClient(businessId: string): Promise<MetaBudgetClient> {
  const connection = await ConnectionsRepository.get(businessId);
  const accountId = connection?.meta_ad_account_id?.trim() ?? '';
  const storedAccessToken = connection?.meta_access_token?.trim() ?? '';
  if (!accountId || !storedAccessToken) {
    throw new Error('Meta ad account ID and tenant access token are required.');
  }
  return new MetaAdsReadService(decrypt(storedAccessToken), accountId);
}

const defaultDependencies: MetaExecutionDependencies = {
  preflight: (...args) => ForesightMetaExecutionPreflightService.preflight(...args),
  findExecution: (...args) => ForesightExecutionRepository.findByIdempotencyKey(...args),
  claimExecution: input => ForesightExecutionRepository.claim(input),
  completeExecution: input => ForesightExecutionRepository.complete(input),
  createMetaClient: defaultMetaClient,
  notifyBudgetChange: async input => {
    const recipient = await getBudgetChangeNotificationEmail(input.businessId);
    await sendMetaBudgetChangeNotification({ ...input, recipient });
  },
};

export function createForesightMetaExecutionService(dependencies: MetaExecutionDependencies = defaultDependencies) {
  async function notify(
    businessId: string,
    recommendationId: number,
    execution: ForesightExecutionRow,
  ): Promise<Pick<ForesightMetaExecutionResult, 'notification' | 'notificationError'>> {
    try {
      await dependencies.notifyBudgetChange({
        businessId,
        recommendationId,
        executionId: execution.id,
        changes: requestChanges(execution),
      });
      return { notification: 'sent' };
    } catch (error) {
      return {
        notification: 'failed',
        notificationError: error instanceof Error ? error.message : 'Budget change email failed.',
      };
    }
  }

  async function reconcile(
    businessId: string,
    actorId: number,
    execution: ForesightExecutionRow,
    client: MetaBudgetClient,
    response: Record<string, unknown> | null,
    mutationError: string | null,
  ): Promise<ForesightExecutionRow> {
    const changes = requestChanges(execution);
    try {
      const live = await readBack(client, changes);
      const matchesProposed = readBackMatches(live, changes, 'proposedDailyBudgetMinor');
      const matchesBefore = readBackMatches(live, changes, 'currentDailyBudgetMinor');
      const state = matchesProposed ? 'succeeded' : 'failed';
      const errorText = matchesProposed
        ? null
        : matchesBefore
          ? mutationError ?? 'Meta Ads budgets remain unchanged after execution.'
          : 'Meta Ads read-back does not match the approved before or proposed values. Manual review is required.';
      return dependencies.completeExecution({
        businessId,
        executionId: execution.id,
        actorId,
        state,
        response,
        after: { settings: live, matchesProposed, matchesBefore },
        errorText,
        platform: 'meta_ads',
      });
    } catch (error) {
      const readBackError = error instanceof Error ? error.message : 'Meta Ads read-back failed.';
      return dependencies.completeExecution({
        businessId,
        executionId: execution.id,
        actorId,
        state: 'failed',
        response,
        after: null,
        errorText: mutationError
          ? `${mutationError} Read-back also failed: ${readBackError}`
          : `Execution state is uncertain because read-back failed: ${readBackError}`,
        platform: 'meta_ads',
      });
    }
  }

  return {
    async execute(input: {
      businessId: string;
      recommendationId: number;
      actorId: number;
      proposalHash: string;
      confirmationFingerprint: string;
    }): Promise<ForesightMetaExecutionResult> {
      const key = idempotencyKey(input);
      const existing = await dependencies.findExecution(input.businessId, key);
      if (existing && existing.state !== 'in_progress') {
        const notification = existing.state === 'succeeded'
          ? await notify(input.businessId, input.recommendationId, existing)
          : { notification: 'not_sent' as const };
        return { execution: existing, idempotentReplay: true, mutationSubmitted: false, ...notification };
      }
      if (existing) {
        const client = await dependencies.createMetaClient(input.businessId);
        const execution = await reconcile(input.businessId, input.actorId, existing, client, null, null);
        return { execution, idempotentReplay: true, mutationSubmitted: false, notification: 'not_sent' };
      }

      const preflight = await dependencies.preflight(input.businessId, input.recommendationId, input.proposalHash);
      const liveFingerprint = metaExecutionPreflightFingerprint(preflight);
      if (!preflight.ready || preflight.blockers.length > 0 || preflight.changes.length === 0) {
        throw new Error('Live execution preflight is blocked; no Meta Ads changes were submitted.');
      }
      if (liveFingerprint !== input.confirmationFingerprint || preflight.confirmationFingerprint !== liveFingerprint) {
        throw new Error('Live Meta Ads settings changed; run preflight and confirm the exact changes again.');
      }

      const request = {
        platform: 'meta_ads',
        operation: 'update_daily_budgets',
        confirmationFingerprint: liveFingerprint,
        changes: preflight.changes,
      };
      const claim = await dependencies.claimExecution({
        businessId: input.businessId,
        recommendationId: input.recommendationId,
        actorId: input.actorId,
        proposalHash: input.proposalHash,
        idempotencyKey: key,
        before: { account: preflight.account, changes: preflight.changes.map(change => ({ ...change, proposedDailyBudgetMinor: undefined })) },
        request,
        platform: 'meta_ads',
      });
      const client = await dependencies.createMetaClient(input.businessId);
      if (!claim.created) {
        if (claim.execution.state !== 'in_progress') {
          return { execution: claim.execution, idempotentReplay: true, mutationSubmitted: false, notification: 'not_sent' };
        }
        const execution = await reconcile(input.businessId, input.actorId, claim.execution, client, null, null);
        return { execution, idempotentReplay: true, mutationSubmitted: false, notification: 'not_sent' };
      }

      let mutationResponse: Record<string, unknown> | null = null;
      let mutationError: string | null = null;
      try {
        const response = await client.updateDailyBudgets(preflight.changes.map(change => ({
          entityType: change.entityType,
          entityId: change.entityId,
          dailyBudgetMinor: change.proposedDailyBudgetMinor,
        })));
        mutationResponse = { metaAds: serializable(response) };
      } catch (error) {
        mutationError = error instanceof Error ? error.message : 'Meta Ads mutation failed.';
        mutationResponse = { metaAdsError: mutationError };
      }
      const execution = await reconcile(input.businessId, input.actorId, claim.execution, client, mutationResponse, mutationError);
      if (execution.state !== 'succeeded') {
        return { execution, idempotentReplay: false, mutationSubmitted: true, notification: 'not_sent' };
      }
      const notification = await notify(input.businessId, input.recommendationId, execution);
      return { execution, idempotentReplay: false, mutationSubmitted: true, ...notification };
    },
  };
}

export const ForesightMetaExecutionService = createForesightMetaExecutionService();
