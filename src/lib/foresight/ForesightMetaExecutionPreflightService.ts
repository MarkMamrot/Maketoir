import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { MetaAdsReadService } from '@/services/MetaAdsReadService';
import {
  planMetaBudgetReductionPreflight,
  type MetaExecutionPreflightResult,
} from './metaExecutionPreflight';
import { ForesightRepository } from './repositories/ForesightRepository';

function blocked(code: string, message: string): MetaExecutionPreflightResult {
  return {
    mode: 'read_only_meta_preflight', executable: false, ready: false,
    checkedAt: new Date().toISOString(), account: null, changes: [], blockers: [{ code, message }],
  };
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const ForesightMetaExecutionPreflightService = {
  async preflight(
    businessId: string,
    recommendationId: number,
    proposalHash: string,
  ): Promise<MetaExecutionPreflightResult> {
    const recommendation = await ForesightRepository.getRecommendation(businessId, recommendationId);
    if (!recommendation) return blocked('recommendation_not_found', 'The recommendation was not found.');
    if (recommendation.state !== 'approved') {
      return blocked('recommendation_not_approved', 'Only approved recommendations can run a live Meta preflight.');
    }
    if (!recommendation.proposal_hash || recommendation.proposal_hash !== proposalHash) {
      return blocked('proposal_hash_mismatch', 'The proposal changed; refresh before running Meta preflight.');
    }
    if (recommendation.proposed_action_json?.type !== 'review_budget_reduction') {
      return blocked('unsupported_action', 'This recommendation does not map to a supported Meta budget review.');
    }

    const contributors = recommendation.evidence_json.contributors ?? [];
    const metaContributors = contributors.filter((item) => item.source === 'meta_ads');
    if (metaContributors.length === 0) {
      return blocked('no_meta_candidates', 'No Meta campaign or ad-set contributor is available for live preflight.');
    }

    const connection = await ConnectionsRepository.get(businessId);
    const accountId = connection?.meta_ad_account_id?.trim() ?? '';
    const storedAccessToken = connection?.meta_access_token?.trim() ?? '';
    if (!accountId || !storedAccessToken) {
      return blocked('meta_connection_incomplete', 'Meta ad account ID and tenant access token are required.');
    }
    if (!/^\d+$/.test(accountId.replace(/^act_/i, ''))) {
      return blocked('meta_account_id_invalid', 'The connected Meta ad account ID is invalid.');
    }

    const service = new MetaAdsReadService(decrypt(storedAccessToken), accountId);
    const settings = await service.getBudgetSettings({
      campaignIds: metaContributors.filter((item) => item.entityType === 'campaign').map((item) => item.entityId),
      adSetIds: metaContributors.filter((item) => item.entityType === 'adset').map((item) => item.entityId),
    });
    return planMetaBudgetReductionPreflight({
      contributors,
      account: settings.account,
      liveCampaigns: settings.campaigns,
      liveAdSets: settings.adSets,
      maximumReductionPercent: numberValue(recommendation.proposed_action_json.maximumReductionPercent),
      expectedAccountId: accountId,
      checkedAt: new Date().toISOString(),
    });
  },
};