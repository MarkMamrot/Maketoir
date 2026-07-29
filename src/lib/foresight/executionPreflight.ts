import type { PaidMediaContributorEvidence } from './types';

export interface GoogleCampaignSetting {
  customerId: string;
  currencyCode: string;
  campaignId: string;
  campaignName: string;
  status: string;
  budgetId: string;
  budgetName: string;
  amountMicros: number;
  explicitlyShared: boolean;
  referenceCount: number;
}

export interface ExecutionPreflightBlocker {
  code: string;
  message: string;
  entityId?: string;
}

export interface BudgetChangePreview {
  source: 'google_ads';
  entityType: 'campaign_budget';
  campaignId: string;
  campaignName: string;
  budgetId: string;
  budgetName: string;
  currencyCode: string;
  currentAmountMicros: number;
  proposedAmountMicros: number;
  reductionPercent: number;
  operation: 'update_campaign_budget';
}

export interface ExecutionPreflightResult {
  mode: 'read_only_preflight';
  executable: false;
  ready: boolean;
  checkedAt: string;
  account: { source: 'google_ads'; customerId: string } | null;
  changes: BudgetChangePreview[];
  blockers: ExecutionPreflightBlocker[];
}

function micros(value: number): number {
  return Math.max(0, Math.round(value));
}

export function planGoogleBudgetReductionPreflight(input: {
  contributors: PaidMediaContributorEvidence[];
  liveCampaigns: GoogleCampaignSetting[];
  maximumReductionPercent: number;
  expectedCustomerId: string;
  checkedAt: string;
}): ExecutionPreflightResult {
  const reductionPercent = Math.max(0, Math.min(50, input.maximumReductionPercent));
  const blockers: ExecutionPreflightBlocker[] = [];
  const changes: BudgetChangePreview[] = [];
  const liveById = new Map(input.liveCampaigns.map((item) => [item.campaignId, item]));
  const candidates = input.contributors.filter((item) =>
    item.source === 'google_ads'
    && item.entityType === 'campaign'
    && item.signals.some((signal) => signal === 'platform_roas_decline' || signal === 'spend_without_platform_revenue'),
  );

  if (reductionPercent <= 0) {
    blockers.push({ code: 'invalid_reduction_guardrail', message: 'The approved reduction guardrail is not greater than zero.' });
  }
  if (candidates.length === 0) {
    blockers.push({
      code: 'no_supported_google_campaign_candidates',
      message: 'No diagnosed Google campaign has a supported deterioration signal. Meta and ad-set changes are not enabled for preflight.',
    });
  }

  for (const contributor of candidates) {
    const live = liveById.get(contributor.entityId);
    if (!live) {
      blockers.push({ code: 'campaign_not_found', entityId: contributor.entityId, message: `${contributor.entityName} was not found in the connected Google Ads account.` });
      continue;
    }
    if (live.customerId.replace(/-/g, '') !== input.expectedCustomerId.replace(/-/g, '')) {
      blockers.push({ code: 'account_mismatch', entityId: contributor.entityId, message: `${live.campaignName} belongs to a different Google Ads customer.` });
      continue;
    }
    if (live.status.toUpperCase() !== 'ENABLED') {
      blockers.push({ code: 'campaign_not_enabled', entityId: contributor.entityId, message: `${live.campaignName} is ${live.status.toLowerCase()}, so no budget change was prepared.` });
      continue;
    }
    if (live.explicitlyShared || live.referenceCount > 1) {
      blockers.push({ code: 'shared_campaign_budget', entityId: contributor.entityId, message: `${live.campaignName} uses a shared budget; changing it could affect other campaigns.` });
      continue;
    }
    if (!Number.isFinite(live.amountMicros) || live.amountMicros <= 0) {
      blockers.push({ code: 'invalid_live_budget', entityId: contributor.entityId, message: `${live.campaignName} has no usable live campaign budget.` });
      continue;
    }

    const proposedAmountMicros = micros(live.amountMicros * (1 - reductionPercent / 100));
    if (proposedAmountMicros >= live.amountMicros) {
      blockers.push({ code: 'no_budget_change', entityId: contributor.entityId, message: `${live.campaignName} did not produce a lower guarded budget.` });
      continue;
    }
    changes.push({
      source: 'google_ads',
      entityType: 'campaign_budget',
      campaignId: live.campaignId,
      campaignName: live.campaignName,
      budgetId: live.budgetId,
      budgetName: live.budgetName,
      currencyCode: live.currencyCode,
      currentAmountMicros: micros(live.amountMicros),
      proposedAmountMicros,
      reductionPercent,
      operation: 'update_campaign_budget',
    });
  }

  return {
    mode: 'read_only_preflight',
    executable: false,
    ready: changes.length > 0 && blockers.length === 0,
    checkedAt: input.checkedAt,
    account: { source: 'google_ads', customerId: input.expectedCustomerId },
    changes,
    blockers,
  };
}