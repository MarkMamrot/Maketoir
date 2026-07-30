import { createHash } from 'crypto';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import {
  executionPreflightFingerprint,
  type BudgetChangePreview,
  type ExecutionPreflightResult,
  type GoogleCampaignSetting,
} from './executionPreflight';
import {
  ForesightExecutionPreflightService,
  normalizeCampaignSetting,
} from './ForesightExecutionPreflightService';
import {
  ForesightExecutionRepository,
  type ForesightExecutionRow,
} from './repositories/ForesightExecutionRepository';
import {
  getBudgetChangeNotificationEmail,
  sendBudgetChangeNotification,
} from './budgetChangeNotification';

interface GoogleBudgetClient {
  updateCampaignBudgets(changes: Array<{ budgetId: string; amountMicros: number }>): Promise<unknown>;
  getCampaignSettings(campaignIds: string[]): Promise<unknown[]>;
}

interface ExecutionDependencies {
  preflight(businessId: string, recommendationId: number, proposalHash: string): Promise<ExecutionPreflightResult>;
  findExecution(businessId: string, idempotencyKey: string): Promise<ForesightExecutionRow | null>;
  claimExecution(input: Parameters<typeof ForesightExecutionRepository.claim>[0]): ReturnType<typeof ForesightExecutionRepository.claim>;
  completeExecution(input: Parameters<typeof ForesightExecutionRepository.complete>[0]): ReturnType<typeof ForesightExecutionRepository.complete>;
  createGoogleClient(businessId: string): Promise<GoogleBudgetClient>;
  notifyBudgetChange(input: {
    businessId: string;
    recommendationId: number;
    executionId: number;
    changes: BudgetChangePreview[];
  }): Promise<void>;
}

export interface ForesightExecutionResult {
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
    input.businessId,
    input.recommendationId,
    input.proposalHash,
    input.confirmationFingerprint,
  ].join(':')).digest('hex');
}

function serializable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, child) => (
    typeof child === 'bigint' ? child.toString() : child
  )));
}

function expectedValues(changes: BudgetChangePreview[], field: 'currentAmountMicros' | 'proposedAmountMicros') {
  return new Map(changes.map((change) => [change.budgetId, change[field]]));
}

function valuesMatch(live: GoogleCampaignSetting[], expected: Map<string, number>): boolean {
  return expected.size > 0 && [...expected].every(([budgetId, amountMicros]) => (
    live.some((setting) => setting.budgetId === budgetId && setting.amountMicros === amountMicros)
  ));
}

function requestChanges(execution: ForesightExecutionRow): BudgetChangePreview[] {
  const changes = execution.request_json.changes;
  if (!Array.isArray(changes)) throw new Error('Stored Foresight execution request is invalid.');
  return changes as BudgetChangePreview[];
}

async function readBack(client: GoogleBudgetClient, changes: BudgetChangePreview[]) {
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

const defaultDependencies: ExecutionDependencies = {
  preflight: (...args) => ForesightExecutionPreflightService.preflight(...args),
  findExecution: (...args) => ForesightExecutionRepository.findByIdempotencyKey(...args),
  claimExecution: (input) => ForesightExecutionRepository.claim(input),
  completeExecution: (input) => ForesightExecutionRepository.complete(input),
  createGoogleClient: defaultGoogleClient,
  notifyBudgetChange: async input => {
    const recipient = await getBudgetChangeNotificationEmail(input.businessId);
    await sendBudgetChangeNotification({ ...input, recipient });
  },
};

export function createForesightExecutionService(dependencies: ExecutionDependencies = defaultDependencies) {
  async function notify(
    businessId: string,
    recommendationId: number,
    execution: ForesightExecutionRow,
  ): Promise<Pick<ForesightExecutionResult, 'notification' | 'notificationError'>> {
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
    client: GoogleBudgetClient,
    response: Record<string, unknown> | null,
    mutationError: string | null,
  ): Promise<ForesightExecutionRow> {
    const changes = requestChanges(execution);
    try {
      const live = await readBack(client, changes);
      const matchesProposed = valuesMatch(live, expectedValues(changes, 'proposedAmountMicros'));
      const matchesBefore = valuesMatch(live, expectedValues(changes, 'currentAmountMicros'));
      const state = matchesProposed ? 'succeeded' : 'failed';
      const errorText = matchesProposed
        ? null
        : matchesBefore
          ? mutationError ?? 'Google Ads budgets remain unchanged after execution.'
          : 'Google Ads read-back does not match the approved before or proposed values. Manual review is required.';
      return dependencies.completeExecution({
        businessId,
        executionId: execution.id,
        actorId,
        state,
        response,
        after: { campaigns: live, matchesProposed, matchesBefore },
        errorText,
      });
    } catch (error) {
      const readBackError = error instanceof Error ? error.message : 'Google Ads read-back failed.';
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
    }): Promise<ForesightExecutionResult> {
      const key = idempotencyKey(input);
      const existing = await dependencies.findExecution(input.businessId, key);
      if (existing && existing.state !== 'in_progress') {
        const notification = existing.state === 'succeeded'
          ? await notify(input.businessId, input.recommendationId, existing)
          : { notification: 'not_sent' as const };
        return { execution: existing, idempotentReplay: true, mutationSubmitted: false, ...notification };
      }
      if (existing) {
        const client = await dependencies.createGoogleClient(input.businessId);
        const execution = await reconcile(input.businessId, input.actorId, existing, client, null, null);
        return { execution, idempotentReplay: true, mutationSubmitted: false, notification: 'not_sent' };
      }

      const preflight = await dependencies.preflight(
        input.businessId,
        input.recommendationId,
        input.proposalHash,
      );
      const liveFingerprint = executionPreflightFingerprint(preflight);
      if (!preflight.ready || preflight.blockers.length > 0 || preflight.changes.length === 0) {
        throw new Error('Live execution preflight is blocked; no Google Ads changes were submitted.');
      }
      if (liveFingerprint !== input.confirmationFingerprint) {
        throw new Error('Live Google Ads settings changed; run preflight and confirm the exact changes again.');
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
        operation: 'update_campaign_budgets',
        confirmationFingerprint: liveFingerprint,
        changes: preflight.changes,
      };
      const claim = await dependencies.claimExecution({
        businessId: input.businessId,
        recommendationId: input.recommendationId,
        actorId: input.actorId,
        proposalHash: input.proposalHash,
        idempotencyKey: key,
        before,
        request,
      });
      const client = await dependencies.createGoogleClient(input.businessId);
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
        const response = await client.updateCampaignBudgets(preflight.changes.map((change) => ({
          budgetId: change.budgetId,
          amountMicros: change.proposedAmountMicros,
        })));
        mutationResponse = { googleAds: serializable(response) };
      } catch (error) {
        mutationError = error instanceof Error ? error.message : 'Google Ads mutation failed.';
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
      if (execution.state !== 'succeeded') {
        return { execution, idempotentReplay: false, mutationSubmitted: true, notification: 'not_sent' };
      }
      const notification = await notify(input.businessId, input.recommendationId, execution);
      return { execution, idempotentReplay: false, mutationSubmitted: true, ...notification };
    },
  };
}

export const ForesightExecutionService = createForesightExecutionService();