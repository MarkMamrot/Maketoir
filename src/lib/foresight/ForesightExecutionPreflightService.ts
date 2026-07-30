import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import {
  executionPreflightFingerprint,
  planGoogleBudgetIncreasePreflight,
  planGoogleBudgetReductionPreflight,
  type ExecutionPreflightResult,
  type GoogleCampaignSetting,
} from './executionPreflight';
import { ForesightRepository } from './repositories/ForesightRepository';
import { getBudgetChangeNotificationEmail, isValidNotificationEmail } from './budgetChangeNotification';
import {
  DEFAULT_FORESIGHT_MARKETING_STRATEGY,
  parseMarketingStrategy,
} from './marketingStrategy';

function blocked(code: string, message: string): ExecutionPreflightResult {
  return {
    mode: 'read_only_preflight',
    executable: false,
    ready: false,
    checkedAt: new Date().toISOString(),
    confirmationFingerprint: null,
    account: null,
    changes: [],
    blockers: [{ code, message }],
  };
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCampaignStatus(value: unknown): string {
  if (typeof value === 'number' || /^\d+$/.test(String(value ?? '').trim())) {
    const status = Number(value);
    return ({ 0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'ENABLED', 3: 'PAUSED', 4: 'REMOVED' } as Record<number, string>)[status]
      ?? `UNKNOWN_${status}`;
  }
  return stringValue(value).trim().toUpperCase();
}

export function normalizeCampaignSetting(row: any): GoogleCampaignSetting {
  return {
    customerId: stringValue(row?.customer?.id),
    currencyCode: stringValue(row?.customer?.currency_code),
    campaignId: stringValue(row?.campaign?.id),
    campaignName: stringValue(row?.campaign?.name),
    status: normalizeCampaignStatus(row?.campaign?.status),
    budgetId: stringValue(row?.campaign_budget?.id),
    budgetName: stringValue(row?.campaign_budget?.name),
    amountMicros: numberValue(row?.campaign_budget?.amount_micros),
    explicitlyShared: Boolean(row?.campaign_budget?.explicitly_shared),
    referenceCount: numberValue(row?.campaign_budget?.reference_count),
  };
}

export const ForesightExecutionPreflightService = {
  async preflight(
    businessId: string,
    recommendationId: number,
    proposalHash: string,
  ): Promise<ExecutionPreflightResult> {
    const recommendation = await ForesightRepository.getRecommendation(businessId, recommendationId);
    if (!recommendation) return blocked('recommendation_not_found', 'The recommendation was not found.');
    if (recommendation.state !== 'approved') {
      return blocked('recommendation_not_approved', 'Only approved recommendations can run a live execution preflight.');
    }
    if (!recommendation.proposal_hash || recommendation.proposal_hash !== proposalHash) {
      return blocked('proposal_hash_mismatch', 'The proposal changed; refresh before running preflight.');
    }
    const actionType = recommendation.proposed_action_json?.type;
    if (actionType !== 'review_budget_reduction' && actionType !== 'review_capped_budget_increase') {
      return blocked('unsupported_action', 'This recommendation does not yet map to a supported exact platform change.');
    }

    const contributors = recommendation.evidence_json.contributors ?? [];
    const googleCampaignIds = contributors
      .filter((item) => item.source === 'google_ads' && item.entityType === 'campaign')
      .map((item) => item.entityId);
    if (googleCampaignIds.length === 0) {
      return blocked('no_google_campaign_candidates', 'No Google campaign contributor is available for live preflight.');
    }

    const notificationEmail = await getBudgetChangeNotificationEmail(businessId);
    if (!isValidNotificationEmail(notificationEmail)) {
      return blocked('notification_email_required', 'Set a valid Budget Change Alerts email in Marketing Settings before executing Google Ads changes.');
    }
    if (!process.env.RESEND_API_KEY) {
      return blocked('email_service_unavailable', 'Budget changes are blocked because the email notification service is not configured.');
    }

    const connection = await ConnectionsRepository.get(businessId);
    const customerId = connection?.google_ads_customer_id?.trim() ?? '';
    const storedRefreshToken = connection?.google_ads_refresh_token?.trim() ?? '';
    if (!customerId || !storedRefreshToken) {
      return blocked('google_connection_incomplete', 'Google Ads customer ID and tenant refresh token are required.');
    }

    const refreshToken = decrypt(storedRefreshToken);
    const service = new GoogleAdsService(customerId, refreshToken);
    const rows = await service.getCampaignSettings(googleCampaignIds);
    const storedTolerance = numberValue(recommendation.evidence_json.observedValues?.merDeteriorationPercent);
    const storedStrategy = storedTolerance > 0 || actionType !== 'review_capped_budget_increase'
      ? null
      : await ForesightRepository.latestStrategy(businessId);
    const maximumRoasDeclinePercent = storedTolerance > 0
      ? storedTolerance
      : storedStrategy
        ? parseMarketingStrategy(storedStrategy.strategy_json).paidMedia.merDeteriorationPercent
        : DEFAULT_FORESIGHT_MARKETING_STRATEGY.paidMedia.merDeteriorationPercent;
    const common = {
      contributors,
      liveCampaigns: (Array.isArray(rows) ? rows : []).map(normalizeCampaignSetting),
      expectedCustomerId: customerId,
      checkedAt: new Date().toISOString(),
    };
    const result = actionType === 'review_capped_budget_increase'
      ? planGoogleBudgetIncreasePreflight({
        ...common,
        maximumIncreasePercent: numberValue(recommendation.proposed_action_json.maximumIncreasePercent),
        maximumRoasDeclinePercent,
      })
      : planGoogleBudgetReductionPreflight({
        ...common,
        maximumReductionPercent: numberValue(recommendation.proposed_action_json.maximumReductionPercent),
      });
    return result.ready
      ? { ...result, confirmationFingerprint: executionPreflightFingerprint(result) }
      : result;
  },
};