import { createHash } from 'crypto';
import type { MetaBudgetSettings } from '@/services/MetaAdsReadService';
import type { MetaBudgetChangePreview, MetaPreflightBlocker } from './metaExecutionPreflight';

export interface MetaRollbackChangePreview {
  source: 'meta_ads';
  entityType: 'campaign' | 'adset';
  entityId: string;
  entityName: string;
  campaignId: string;
  currencyCode: string;
  currentDailyBudgetMinor: number;
  proposedDailyBudgetMinor: number;
  operation: 'restore_daily_budget';
}

export interface MetaRollbackPreflightResult {
  mode: 'meta_rollback_preflight';
  executable: false;
  ready: boolean;
  checkedAt: string;
  confirmationFingerprint: string | null;
  originalExecutionId: number;
  account: { source: 'meta_ads'; accountId: string; currencyCode: string } | null;
  changes: MetaRollbackChangePreview[];
  blockers: MetaPreflightBlocker[];
}

export function metaRollbackPreflightFingerprint(result: MetaRollbackPreflightResult): string {
  return createHash('sha256').update(JSON.stringify({
    mode: result.mode,
    executable: result.executable,
    ready: result.ready,
    originalExecutionId: result.originalExecutionId,
    account: result.account,
    changes: [...result.changes]
      .sort((left, right) => `${left.entityType}:${left.entityId}`.localeCompare(`${right.entityType}:${right.entityId}`))
      .map(change => ({
        source: change.source,
        entityType: change.entityType,
        entityId: change.entityId,
        campaignId: change.campaignId,
        currencyCode: change.currencyCode,
        currentDailyBudgetMinor: change.currentDailyBudgetMinor,
        proposedDailyBudgetMinor: change.proposedDailyBudgetMinor,
        operation: change.operation,
      })),
    blockers: result.blockers.map(blocker => ({ code: blocker.code, entityId: blocker.entityId ?? null })),
  })).digest('hex');
}

export function planMetaBudgetRollbackPreflight(input: {
  originalExecutionId: number;
  expectedAccountId: string;
  originalChanges: MetaBudgetChangePreview[];
  liveSettings: MetaBudgetSettings;
  checkedAt: string;
}): MetaRollbackPreflightResult {
  const blockers: MetaPreflightBlocker[] = [];
  const changes: MetaRollbackChangePreview[] = [];
  const expectedAccountId = input.expectedAccountId.replace(/^act_/i, '');
  const liveAccountId = input.liveSettings.account.accountId.replace(/^act_/i, '');

  if (liveAccountId !== expectedAccountId) {
    blockers.push({ code: 'meta_account_mismatch', message: 'The connected Meta account differs from the original execution receipt.' });
  } else if (input.liveSettings.account.accountStatus !== 1) {
    blockers.push({ code: 'meta_account_not_active', message: 'The connected Meta ad account is not active.' });
  }
  if (input.originalChanges.length === 0) {
    blockers.push({ code: 'missing_original_changes', message: 'The original Meta execution has no budget values to restore.' });
  }

  for (const original of input.originalChanges) {
    const live = original.entityType === 'campaign'
      ? input.liveSettings.campaigns.find(item => item.campaignId === original.entityId)
      : input.liveSettings.adSets.find(item => item.adSetId === original.entityId);
    if (!live) {
      blockers.push({ code: 'meta_entity_not_found', entityId: original.entityId, message: `${original.entityName} was not found in the connected Meta account.` });
      continue;
    }
    if (live.dailyBudgetMinor !== original.proposedDailyBudgetMinor) {
      blockers.push({ code: 'meta_live_after_diverged', entityId: original.entityId, message: `${original.entityName} changed after execution, so automatic rollback is blocked.` });
      continue;
    }
    if (!Number.isSafeInteger(original.currentDailyBudgetMinor) || original.currentDailyBudgetMinor <= 0) {
      blockers.push({ code: 'meta_invalid_original_budget', entityId: original.entityId, message: `${original.entityName} has no valid stored original budget.` });
      continue;
    }
    changes.push({
      source: 'meta_ads', entityType: original.entityType, entityId: original.entityId,
      entityName: original.entityName, campaignId: original.campaignId,
      currencyCode: original.currencyCode || input.liveSettings.account.currencyCode,
      currentDailyBudgetMinor: original.proposedDailyBudgetMinor,
      proposedDailyBudgetMinor: original.currentDailyBudgetMinor,
      operation: 'restore_daily_budget',
    });
  }

  const result: MetaRollbackPreflightResult = {
    mode: 'meta_rollback_preflight', executable: false,
    ready: changes.length > 0 && blockers.length === 0 && changes.length === input.originalChanges.length,
    checkedAt: input.checkedAt, confirmationFingerprint: null, originalExecutionId: input.originalExecutionId,
    account: { source: 'meta_ads', accountId: expectedAccountId, currencyCode: input.liveSettings.account.currencyCode },
    changes, blockers,
  };
  result.confirmationFingerprint = result.ready ? metaRollbackPreflightFingerprint(result) : null;
  return result;
}
