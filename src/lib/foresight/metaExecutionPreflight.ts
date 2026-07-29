import type { PaidMediaContributorEvidence } from './types';

export interface MetaAdAccountSetting {
  accountId: string;
  accountStatus: number;
  currencyCode: string;
}

export interface MetaCampaignSetting {
  accountId: string;
  campaignId: string;
  campaignName: string;
  configuredStatus: string;
  effectiveStatus: string;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
}

export interface MetaAdSetSetting {
  accountId: string;
  adSetId: string;
  adSetName: string;
  campaignId: string;
  configuredStatus: string;
  effectiveStatus: string;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
}

export interface MetaPreflightBlocker {
  code: string;
  message: string;
  entityId?: string;
}

export interface MetaBudgetChangePreview {
  source: 'meta_ads';
  entityType: 'campaign' | 'adset';
  entityId: string;
  entityName: string;
  campaignId: string;
  currencyCode: string;
  currentDailyBudgetMinor: number;
  proposedDailyBudgetMinor: number;
  reductionPercent: number;
  operation: 'preview_daily_budget_reduction';
}

export interface MetaExecutionPreflightResult {
  mode: 'read_only_meta_preflight';
  executable: false;
  ready: boolean;
  checkedAt: string;
  account: { source: 'meta_ads'; accountId: string; currencyCode: string } | null;
  changes: MetaBudgetChangePreview[];
  blockers: MetaPreflightBlocker[];
}

function normalizedAccountId(value: string): string {
  return value.trim().replace(/^act_/i, '');
}

function positiveBudget(value: number | null): boolean {
  return value != null && Number.isSafeInteger(value) && value > 0;
}

function hasSupportedSignal(contributor: PaidMediaContributorEvidence): boolean {
  return contributor.signals.some((signal) =>
    signal === 'platform_roas_decline' || signal === 'spend_without_platform_revenue',
  );
}

export function planMetaBudgetReductionPreflight(input: {
  contributors: PaidMediaContributorEvidence[];
  account: MetaAdAccountSetting | null;
  liveCampaigns: MetaCampaignSetting[];
  liveAdSets: MetaAdSetSetting[];
  maximumReductionPercent: number;
  expectedAccountId: string;
  checkedAt: string;
}): MetaExecutionPreflightResult {
  const blockers: MetaPreflightBlocker[] = [];
  const changes: MetaBudgetChangePreview[] = [];
  const reductionPercent = Math.max(0, Math.min(50, input.maximumReductionPercent));
  const expectedAccountId = normalizedAccountId(input.expectedAccountId);
  const candidates = input.contributors.filter((contributor) =>
    contributor.source === 'meta_ads' && hasSupportedSignal(contributor),
  );
  const campaignsById = new Map(input.liveCampaigns.map((campaign) => [campaign.campaignId, campaign]));
  const adSetsById = new Map(input.liveAdSets.map((adSet) => [adSet.adSetId, adSet]));

  if (!input.account) {
    blockers.push({ code: 'meta_account_not_found', message: 'The connected Meta ad account could not be read.' });
  } else if (normalizedAccountId(input.account.accountId) !== expectedAccountId) {
    blockers.push({ code: 'meta_account_mismatch', message: 'The live Meta account does not match the connected ad account.' });
  } else if (input.account.accountStatus !== 1) {
    blockers.push({ code: 'meta_account_not_active', message: 'The connected Meta ad account is not active.' });
  } else if (!input.account.currencyCode) {
    blockers.push({ code: 'meta_account_currency_missing', message: 'The Meta ad account currency could not be read.' });
  }
  if (reductionPercent <= 0) {
    blockers.push({ code: 'invalid_reduction_guardrail', message: 'The approved reduction guardrail is not greater than zero.' });
  }
  if (candidates.length === 0) {
    blockers.push({ code: 'no_supported_meta_candidates', message: 'No diagnosed Meta campaign or ad set has a supported deterioration signal.' });
  }

  const accountUsable = blockers.every((blocker) => !blocker.code.startsWith('meta_account_'));
  if (accountUsable && reductionPercent > 0 && input.account) {
    for (const contributor of candidates) {
      if (contributor.entityType === 'campaign') {
        const campaign = campaignsById.get(contributor.entityId);
        if (!campaign) {
          blockers.push({ code: 'meta_campaign_not_found', entityId: contributor.entityId, message: `${contributor.entityName} was not found in the connected Meta ad account.` });
          continue;
        }
        if (normalizedAccountId(campaign.accountId) !== expectedAccountId) {
          blockers.push({ code: 'meta_entity_account_mismatch', entityId: contributor.entityId, message: `${campaign.campaignName} belongs to a different Meta ad account.` });
          continue;
        }
        if (campaign.configuredStatus.toUpperCase() !== 'ACTIVE' || campaign.effectiveStatus.toUpperCase() !== 'ACTIVE') {
          blockers.push({ code: 'meta_campaign_not_active', entityId: contributor.entityId, message: `${campaign.campaignName} is not active, so no budget proposal was prepared.` });
          continue;
        }
        if (positiveBudget(campaign.lifetimeBudgetMinor)) {
          blockers.push({ code: 'meta_lifetime_budget_unsupported', entityId: contributor.entityId, message: `${campaign.campaignName} uses a lifetime budget, which this preflight does not change.` });
          continue;
        }
        if (!positiveBudget(campaign.dailyBudgetMinor)) {
          blockers.push({ code: 'meta_campaign_budget_not_owned', entityId: contributor.entityId, message: `${campaign.campaignName} does not own a usable daily budget; its ad sets may control spend.` });
          continue;
        }
        const change = buildChange({
          entityType: 'campaign', entityId: campaign.campaignId, entityName: campaign.campaignName,
          campaignId: campaign.campaignId, currencyCode: input.account.currencyCode,
          currentDailyBudgetMinor: campaign.dailyBudgetMinor!, reductionPercent,
        });
        if (change.proposedDailyBudgetMinor <= 0 || change.proposedDailyBudgetMinor >= change.currentDailyBudgetMinor) {
          blockers.push({ code: 'meta_no_valid_budget_change', entityId: contributor.entityId, message: `${campaign.campaignName} did not produce a positive lower budget after minor-unit rounding.` });
          continue;
        }
        changes.push(change);
        continue;
      }

      const adSet = adSetsById.get(contributor.entityId);
      if (!adSet) {
        blockers.push({ code: 'meta_adset_not_found', entityId: contributor.entityId, message: `${contributor.entityName} was not found in the connected Meta ad account.` });
        continue;
      }
      const campaign = campaignsById.get(adSet.campaignId);
      if (!campaign) {
        blockers.push({ code: 'meta_parent_campaign_not_found', entityId: contributor.entityId, message: `The parent campaign for ${adSet.adSetName} could not be read.` });
        continue;
      }
      if (normalizedAccountId(adSet.accountId) !== expectedAccountId || normalizedAccountId(campaign.accountId) !== expectedAccountId) {
        blockers.push({ code: 'meta_entity_account_mismatch', entityId: contributor.entityId, message: `${adSet.adSetName} or its parent campaign belongs to a different Meta ad account.` });
        continue;
      }
      if (campaign.configuredStatus.toUpperCase() !== 'ACTIVE' || campaign.effectiveStatus.toUpperCase() !== 'ACTIVE'
        || adSet.configuredStatus.toUpperCase() !== 'ACTIVE' || adSet.effectiveStatus.toUpperCase() !== 'ACTIVE') {
        blockers.push({ code: 'meta_adset_not_active', entityId: contributor.entityId, message: `${adSet.adSetName} or its parent campaign is not active.` });
        continue;
      }
      if (positiveBudget(campaign.dailyBudgetMinor) || positiveBudget(campaign.lifetimeBudgetMinor)) {
        blockers.push({ code: 'meta_campaign_budget_controls_adset', entityId: contributor.entityId, message: `${adSet.adSetName} inherits budget control from ${campaign.campaignName}; an ad-set-level proposal would not be truthful.` });
        continue;
      }
      if (positiveBudget(adSet.lifetimeBudgetMinor)) {
        blockers.push({ code: 'meta_lifetime_budget_unsupported', entityId: contributor.entityId, message: `${adSet.adSetName} uses a lifetime budget, which this preflight does not change.` });
        continue;
      }
      if (!positiveBudget(adSet.dailyBudgetMinor)) {
        blockers.push({ code: 'meta_adset_budget_missing', entityId: contributor.entityId, message: `${adSet.adSetName} has no usable independent daily budget.` });
        continue;
      }
      const change = buildChange({
        entityType: 'adset', entityId: adSet.adSetId, entityName: adSet.adSetName,
        campaignId: adSet.campaignId, currencyCode: input.account.currencyCode,
        currentDailyBudgetMinor: adSet.dailyBudgetMinor!, reductionPercent,
      });
      if (change.proposedDailyBudgetMinor <= 0 || change.proposedDailyBudgetMinor >= change.currentDailyBudgetMinor) {
        blockers.push({ code: 'meta_no_valid_budget_change', entityId: contributor.entityId, message: `${adSet.adSetName} did not produce a positive lower budget after minor-unit rounding.` });
        continue;
      }
      changes.push(change);
    }
  }

  return {
    mode: 'read_only_meta_preflight', executable: false,
    ready: changes.length > 0 && blockers.length === 0,
    checkedAt: input.checkedAt,
    account: input.account ? { source: 'meta_ads', accountId: expectedAccountId, currencyCode: input.account.currencyCode } : null,
    changes, blockers,
  };
}

function buildChange(input: Omit<MetaBudgetChangePreview, 'source' | 'proposedDailyBudgetMinor' | 'operation'>): MetaBudgetChangePreview {
  return {
    source: 'meta_ads', ...input,
    proposedDailyBudgetMinor: Math.max(0, Math.round(input.currentDailyBudgetMinor * (1 - input.reductionPercent / 100))),
    operation: 'preview_daily_budget_reduction',
  };
}