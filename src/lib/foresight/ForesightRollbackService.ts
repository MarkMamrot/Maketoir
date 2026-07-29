import { createHash } from 'crypto';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { normalizeCampaignSetting } from './ForesightExecutionPreflightService';
import { ForesightRollbackPreflightService } from './ForesightRollbackPreflightService';
import type { GoogleCampaignSetting } from './executionPreflight';
import {
  rollbackPreflightFingerprint,
  type RollbackChangePreview,
  type RollbackPreflightResult,
} from './rollbackPreflight';
import {
  ForesightExecutionRepository,
  type ForesightExecutionRow,
} from './repositories/ForesightExecutionRepository';

interface GoogleBudgetClient {
  updateCampaignBudgets(changes: Array<{ budgetId: string; amountMicros: number }>): Promise<unknown>;
  getCampaignSettings(campaignIds: string[]): Promise<unknown[]>;
}

interface RollbackDependencies {
  preflight(
    businessId: string,
    recommendationId: number,
    originalExecutionId: number,
    proposalHash: string,
  ): Promise<RollbackPreflightResult>;
  findExecution(businessId: string, idempotencyKey: string): Promise<ForesightExecutionRow | null>;
  claimCompensation(input: Parameters<typeof ForesightExecutionRepository.claimCompensation>[0]): ReturnType<typeof ForesightExecutionRepository.claimCompensation>;
  completeCompensation(input: Parameters<typeof ForesightExecutionRepository.completeCompensation>[0]): ReturnType<typeof ForesightExecutionRepository.completeCompensation>;
  createGoogleClient(businessId: string): Promise<GoogleBudgetClient>;
}

export interface ForesightRollbackResult {
  execution: ForesightExecutionRow;
  idempotentReplay: boolean;
  mutationSubmitted: boolean;
}

function idempotencyKey(input: {
  businessId: string;
  recommendationId: number;
  originalExecutionId: number;
  proposalHash: string;
  confirmationFingerprint: string;
}): string {
  return createHash('sha256').update([
    input.businessId,
    input.recommendationId,
    input.originalExecutionId,
    'rollback',
    input.proposalHash,
    input.confirmationFingerprint,
  ].join(':')).digest('hex');
}

function serializable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, child) => (
    typeof child === 'bigint' ? child.toString() : child
  )));
}

function storedChanges(execution: ForesightExecutionRow): RollbackChangePreview[] {
  const changes = execution.request_json.changes;
  if (!Array.isArray(changes)) throw new Error('Stored Foresight compensation request is invalid.');
  return changes as RollbackChangePreview[];
}

function valuesMatch(live: GoogleCampaignSetting[], changes: RollbackChangePreview[], field: 'currentAmountMicros' | 'proposedAmountMicros') {
  return changes.length > 0 && changes.every((change) => (
    live.some((setting) => setting.budgetId === change.budgetId && setting.amountMicros === change[field])
  ));
}

async function readBack(client: GoogleBudgetClient, changes: RollbackChangePreview[]) {
  const rows = await client.getCampaignSettings(changes.map((change) => change.campaignId));
  return rows.map(normalizeCampaignSetting);
}

async function defaultGoogleClient(businessId: string): Promise<GoogleBudgetClient> {
  const connection = await ConnectionsRepository.get(businessId);
  const customerId = connection?.google_ads_customer_id?.trim() ?? '';
  const storedRefreshToken = connection?.google_ads_refresh_token?.trim() ?? '';
  if (!customerId || !storedRefreshToken) {
    throw new Error('Google Ads customer ID and tenant refresh token are required.');
  }
  return new GoogleAdsService(customerId, decrypt(storedRefreshToken));
}

const defaultDependencies: RollbackDependencies = {
  preflight: (...args) => ForesightRollbackPreflightService.preflight(...args),
  findExecution: (...args) => ForesightExecutionRepository.findByIdempotencyKey(...args),
  claimCompensation: (input) => ForesightExecutionRepository.claimCompensation(input),
  completeCompensation: (input) => ForesightExecutionRepository.completeCompensation(input),
  createGoogleClient: defaultGoogleClient,
};

export function createForesightRollbackService(dependencies: RollbackDependencies = defaultDependencies) {
  async function reconcile(
    businessId: string,
    actorId: number,
    execution: ForesightExecutionRow,
    client: GoogleBudgetClient,
    response: Record<string, unknown> | null,
    mutationError: string | null,
  ): Promise<ForesightExecutionRow> {
    const changes = storedChanges(execution);
    try {
      const live = await readBack(client, changes);
      const matchesRestored = valuesMatch(live, changes, 'proposedAmountMicros');
      const matchesPreRollback = valuesMatch(live, changes, 'currentAmountMicros');
      const state = matchesRestored ? 'succeeded' : 'failed';
      const errorText = matchesRestored
        ? null
        : matchesPreRollback
          ? mutationError ?? 'Google Ads budgets remain unchanged after rollback.'
          : 'Google Ads rollback read-back matches neither the pre-rollback nor restored values. Manual review is required.';
      return dependencies.completeCompensation({
        businessId,
        executionId: execution.id,
        actorId,
        state,
        response,
        after: { campaigns: live, matchesRestored, matchesPreRollback },
        errorText,
      });
    } catch (error) {
      const readBackError = error instanceof Error ? error.message : 'Google Ads rollback read-back failed.';
      return dependencies.completeCompensation({
        businessId,
        executionId: execution.id,
        actorId,
        state: 'failed',
        response,
        after: null,
        errorText: mutationError
          ? `${mutationError} Rollback read-back also failed: ${readBackError}`
          : `Rollback state is uncertain because read-back failed: ${readBackError}`,
      });
    }
  }

  return {
    async rollback(input: {
      businessId: string;
      recommendationId: number;
      originalExecutionId: number;
      actorId: number;
      proposalHash: string;
      confirmationFingerprint: string;
    }): Promise<ForesightRollbackResult> {
      const key = idempotencyKey(input);
      const existing = await dependencies.findExecution(input.businessId, key);
      if (existing && existing.state !== 'in_progress') {
        return { execution: existing, idempotentReplay: true, mutationSubmitted: false };
      }
      if (existing) {
        const client = await dependencies.createGoogleClient(input.businessId);
        const execution = await reconcile(input.businessId, input.actorId, existing, client, null, null);
        return { execution, idempotentReplay: true, mutationSubmitted: false };
      }

      const preflight = await dependencies.preflight(
        input.businessId,
        input.recommendationId,
        input.originalExecutionId,
        input.proposalHash,
      );
      const liveFingerprint = rollbackPreflightFingerprint(preflight);
      if (!preflight.ready || preflight.blockers.length > 0 || preflight.changes.length === 0) {
        throw new Error('Live rollback preflight is blocked; no Google Ads changes were submitted.');
      }
      if (liveFingerprint !== input.confirmationFingerprint) {
        throw new Error('Live Google Ads settings changed; run rollback preflight and confirm the exact restoration again.');
      }

      const before = {
        account: preflight.account,
        campaigns: preflight.changes.map((change) => ({
          campaignId: change.campaignId,
          budgetId: change.budgetId,
          amountMicros: change.currentAmountMicros,
          currencyCode: change.currencyCode,
        })),
      };
      const request = {
        platform: 'google_ads',
        operation: 'restore_campaign_budgets',
        confirmationFingerprint: liveFingerprint,
        changes: preflight.changes,
      };
      const claim = await dependencies.claimCompensation({
        businessId: input.businessId,
        recommendationId: input.recommendationId,
        originalExecutionId: input.originalExecutionId,
        actorId: input.actorId,
        proposalHash: input.proposalHash,
        idempotencyKey: key,
        before,
        request,
      });
      const client = await dependencies.createGoogleClient(input.businessId);
      if (!claim.created) {
        if (claim.execution.state !== 'in_progress') {
          return { execution: claim.execution, idempotentReplay: true, mutationSubmitted: false };
        }
        const execution = await reconcile(input.businessId, input.actorId, claim.execution, client, null, null);
        return { execution, idempotentReplay: true, mutationSubmitted: false };
      }

      let mutationResponse: Record<string, unknown> | null = null;
      let mutationError: string | null = null;
      try {
        const response = await client.updateCampaignBudgets(preflight.changes.map((change) => ({
          budgetId: change.budgetId,
          amountMicros: change.proposedAmountMicros,
        })));
        mutationResponse = { googleAds: serializable(response) };
      } catch (error) {
        mutationError = error instanceof Error ? error.message : 'Google Ads rollback mutation failed.';
        mutationResponse = { googleAdsError: mutationError };
      }
      const execution = await reconcile(
        input.businessId,
        input.actorId,
        claim.execution,
        client,
        mutationResponse,
        mutationError,
      );
      return { execution, idempotentReplay: false, mutationSubmitted: true };
    },
  };
}

export const ForesightRollbackService = createForesightRollbackService();