import { createHash } from 'crypto';
import type { ExecutionPreflightBlocker, GoogleCampaignSetting } from './executionPreflight';

export interface StoredBudgetValue {
  campaignId: string;
  budgetId: string;
  amountMicros: number;
  currencyCode: string;
}

export interface RollbackChangePreview {
  source: 'google_ads';
  entityType: 'campaign_budget';
  campaignId: string;
  campaignName: string;
  budgetId: string;
  budgetName: string;
  currencyCode: string;
  currentAmountMicros: number;
  proposedAmountMicros: number;
  operation: 'restore_campaign_budget';
}

export interface RollbackPreflightResult {
  mode: 'rollback_preflight';
  executable: false;
  ready: boolean;
  checkedAt: string;
  confirmationFingerprint: string | null;
  originalExecutionId: number;
  account: { source: 'google_ads'; customerId: string } | null;
  changes: RollbackChangePreview[];
  blockers: ExecutionPreflightBlocker[];
}

export function rollbackPreflightFingerprint(result: RollbackPreflightResult): string {
  const confirmation = {
    mode: result.mode,
    executable: result.executable,
    ready: result.ready,
    originalExecutionId: result.originalExecutionId,
    account: result.account,
    changes: [...result.changes]
      .sort((left, right) => left.budgetId.localeCompare(right.budgetId))
      .map((change) => ({
        source: change.source,
        entityType: change.entityType,
        campaignId: change.campaignId,
        budgetId: change.budgetId,
        currencyCode: change.currencyCode,
        currentAmountMicros: change.currentAmountMicros,
        proposedAmountMicros: change.proposedAmountMicros,
        operation: change.operation,
      })),
    blockers: result.blockers.map((blocker) => ({ code: blocker.code, entityId: blocker.entityId ?? null })),
  };
  return createHash('sha256').update(JSON.stringify(confirmation)).digest('hex');
}

export function planGoogleBudgetRollbackPreflight(input: {
  originalExecutionId: number;
  expectedCustomerId: string;
  beforeValues: StoredBudgetValue[];
  verifiedAfterValues: GoogleCampaignSetting[];
  liveCampaigns: GoogleCampaignSetting[];
  checkedAt: string;
}): RollbackPreflightResult {
  const blockers: ExecutionPreflightBlocker[] = [];
  const changes: RollbackChangePreview[] = [];
  const afterByBudget = new Map(input.verifiedAfterValues.map((value) => [value.budgetId, value]));
  const liveByBudget = new Map(input.liveCampaigns.map((value) => [value.budgetId, value]));

  if (input.beforeValues.length === 0) {
    blockers.push({ code: 'missing_before_state', message: 'The original execution has no stored budget values to restore.' });
  }

  for (const before of input.beforeValues) {
    const after = afterByBudget.get(before.budgetId);
    const live = liveByBudget.get(before.budgetId);
    if (!after) {
      blockers.push({ code: 'missing_verified_after_state', entityId: before.campaignId, message: `Budget ${before.budgetId} has no verified execution read-back.` });
      continue;
    }
    if (!live) {
      blockers.push({ code: 'campaign_not_found', entityId: before.campaignId, message: `Campaign ${before.campaignId} was not found in the connected Google Ads account.` });
      continue;
    }
    if (live.customerId.replace(/-/g, '') !== input.expectedCustomerId.replace(/-/g, '')) {
      blockers.push({ code: 'account_mismatch', entityId: before.campaignId, message: `${live.campaignName} belongs to a different Google Ads customer.` });
      continue;
    }
    if (live.status.toUpperCase() !== 'ENABLED') {
      blockers.push({ code: 'campaign_not_enabled', entityId: before.campaignId, message: `${live.campaignName} is ${live.status.toLowerCase()}, so rollback was not prepared.` });
      continue;
    }
    if (live.explicitlyShared || live.referenceCount > 1) {
      blockers.push({ code: 'shared_campaign_budget', entityId: before.campaignId, message: `${live.campaignName} now uses a shared budget; rollback could affect other campaigns.` });
      continue;
    }
    if (live.amountMicros !== after.amountMicros) {
      blockers.push({
        code: 'live_after_diverged',
        entityId: before.campaignId,
        message: `${live.campaignName} changed after execution. Current live budget no longer matches the verified execution receipt.`,
      });
      continue;
    }
    if (!Number.isSafeInteger(before.amountMicros) || before.amountMicros <= 0) {
      blockers.push({ code: 'invalid_before_budget', entityId: before.campaignId, message: `${live.campaignName} has no valid stored budget to restore.` });
      continue;
    }
    if (before.amountMicros === live.amountMicros) {
      blockers.push({ code: 'already_restored', entityId: before.campaignId, message: `${live.campaignName} already matches its original budget.` });
      continue;
    }
    changes.push({
      source: 'google_ads',
      entityType: 'campaign_budget',
      campaignId: live.campaignId,
      campaignName: live.campaignName,
      budgetId: live.budgetId,
      budgetName: live.budgetName,
      currencyCode: before.currencyCode || live.currencyCode,
      currentAmountMicros: live.amountMicros,
      proposedAmountMicros: before.amountMicros,
      operation: 'restore_campaign_budget',
    });
  }

  const result: RollbackPreflightResult = {
    mode: 'rollback_preflight',
    executable: false,
    ready: changes.length > 0 && blockers.length === 0 && changes.length === input.beforeValues.length,
    checkedAt: input.checkedAt,
    confirmationFingerprint: null,
    originalExecutionId: input.originalExecutionId,
    account: { source: 'google_ads', customerId: input.expectedCustomerId },
    changes,
    blockers,
  };
  return result.ready
    ? { ...result, confirmationFingerprint: rollbackPreflightFingerprint(result) }
    : result;
}