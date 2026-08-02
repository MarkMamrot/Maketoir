import { createHash } from 'node:crypto';
import type { MetaCampaignOption } from '@/services/MetaAdsReadService';
import type { ForesightCampaignExperimentDocument } from './planning/campaignExperimentDocument';

export interface MetaExperimentLaunchCandidate extends MetaCampaignOption {
  controlScore: number;
  treatmentScore: number;
  selectable: boolean;
}

export interface MetaExperimentLaunchPackage {
  mode: 'read_only_meta_experiment_launch_package';
  executable: false;
  ready: boolean;
  checkedAt: string;
  experimentVersionId: number;
  experimentHash: string;
  accountId: string;
  controlCampaignId: string | null;
  treatmentCampaignId: string | null;
  recommendedControlCampaignId: string | null;
  recommendedTreatmentCampaignId: string | null;
  candidates: MetaExperimentLaunchCandidate[];
  measurement: {
    sample: 'impressions';
    conversion: 'meta_purchase_actions';
    guardrail: 'meta_negative_feedback_rate';
  };
  blockers: Array<{ code: string; message: string; campaignId?: string }>;
  confirmationFingerprint: string | null;
}

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1);
}

function nameScore(expected: string, actual: string): number {
  const expectedTokens = tokens(expected);
  const actualTokens = new Set(tokens(actual));
  if (expectedTokens.length === 0) return 0;
  return expectedTokens.filter((token) => actualTokens.has(token)).length / expectedTokens.length;
}

function normalizedAccount(value: string): string {
  return value.trim().replace(/^act_/i, '');
}

function selectable(campaign: MetaCampaignOption, accountId: string): boolean {
  const status = campaign.effectiveStatus.toUpperCase();
  return normalizedAccount(campaign.accountId) === normalizedAccount(accountId)
    && ['PAUSED', 'ACTIVE'].includes(status);
}

export function metaExperimentLaunchPackageFingerprint(value: MetaExperimentLaunchPackage): string {
  const selectedCampaignIds = new Set([value.controlCampaignId, value.treatmentCampaignId]);
  return createHash('sha256').update(JSON.stringify({
    mode: value.mode,
    executable: value.executable,
    experimentVersionId: value.experimentVersionId,
    experimentHash: value.experimentHash,
    accountId: normalizedAccount(value.accountId),
    controlCampaignId: value.controlCampaignId,
    treatmentCampaignId: value.treatmentCampaignId,
    selectedCampaigns: value.candidates.filter(({ campaignId }) => selectedCampaignIds.has(campaignId))
      .map(({ campaignId, campaignName, accountId, objective, configuredStatus, effectiveStatus }) => ({
        campaignId, campaignName, accountId: normalizedAccount(accountId), objective, configuredStatus, effectiveStatus,
      })).sort((left, right) => left.campaignId.localeCompare(right.campaignId)),
    measurement: value.measurement,
    blockers: value.blockers.map(({ code, campaignId }) => ({ code, campaignId: campaignId ?? null })),
  })).digest('hex');
}

export function buildMetaExperimentLaunchPackage(input: {
  experimentVersionId: number;
  experimentHash: string;
  design: ForesightCampaignExperimentDocument;
  accountId: string;
  campaigns: MetaCampaignOption[];
  controlCampaignId?: string | null;
  treatmentCampaignId?: string | null;
  checkedAt: string;
}): MetaExperimentLaunchPackage {
  const blockers: MetaExperimentLaunchPackage['blockers'] = [];
  if (input.design.channel !== 'meta') blockers.push({ code: 'unsupported_channel', message: 'This launch package supports Meta experiments only.' });
  if (input.design.primaryMetric !== 'conversion_rate'
    || input.design.guardrails.length === 0
    || input.design.guardrails.some(({ metric }) => metric !== 'meta_negative_feedback_rate')) {
    blockers.push({ code: 'unsupported_measurement_contract', message: 'The accepted design must use purchase conversion rate and Meta negative-feedback guardrails.' });
  }

  const candidates = input.campaigns.map((campaign) => ({
    ...campaign,
    controlScore: nameScore(input.design.control.name, campaign.campaignName),
    treatmentScore: nameScore(input.design.treatment.name, campaign.campaignName),
    selectable: selectable(campaign, input.accountId),
  })).sort((left, right) => Math.max(right.controlScore, right.treatmentScore) - Math.max(left.controlScore, left.treatmentScore)
    || left.campaignName.localeCompare(right.campaignName));
  const available = candidates.filter((candidate) => candidate.selectable);
  const recommendedControl = [...available].sort((left, right) => right.controlScore - left.controlScore)[0] ?? null;
  const recommendedTreatment = [...available]
    .filter((candidate) => candidate.campaignId !== recommendedControl?.campaignId)
    .sort((left, right) => right.treatmentScore - left.treatmentScore)[0] ?? null;
  const controlCampaignId = input.controlCampaignId?.trim() || null;
  const treatmentCampaignId = input.treatmentCampaignId?.trim() || null;

  if (available.length < 2) blockers.push({ code: 'insufficient_campaign_candidates', message: 'At least two readable active or paused campaigns are required.' });
  if ((controlCampaignId == null) !== (treatmentCampaignId == null)) blockers.push({ code: 'incomplete_variant_mapping', message: 'Select both control and treatment campaigns.' });
  if (controlCampaignId && treatmentCampaignId && controlCampaignId === treatmentCampaignId) {
    blockers.push({ code: 'duplicate_variant_campaign', message: 'Control and treatment must use different campaigns.', campaignId: controlCampaignId });
  }
  for (const [role, campaignId] of [['control', controlCampaignId], ['treatment', treatmentCampaignId]] as const) {
    if (campaignId && !available.some((candidate) => candidate.campaignId === campaignId)) {
      blockers.push({ code: `${role}_campaign_unavailable`, message: `The selected ${role} campaign is not available in the connected Meta account.`, campaignId });
    }
  }

  const ready = Boolean(controlCampaignId && treatmentCampaignId && blockers.length === 0);
  const result: MetaExperimentLaunchPackage = {
    mode: 'read_only_meta_experiment_launch_package', executable: false, ready, checkedAt: input.checkedAt,
    experimentVersionId: input.experimentVersionId, experimentHash: input.experimentHash, accountId: normalizedAccount(input.accountId),
    controlCampaignId, treatmentCampaignId,
    recommendedControlCampaignId: recommendedControl?.controlScore ? recommendedControl.campaignId : null,
    recommendedTreatmentCampaignId: recommendedTreatment?.treatmentScore ? recommendedTreatment.campaignId : null,
    candidates, measurement: { sample: 'impressions', conversion: 'meta_purchase_actions', guardrail: 'meta_negative_feedback_rate' },
    blockers, confirmationFingerprint: null,
  };
  result.confirmationFingerprint = ready ? metaExperimentLaunchPackageFingerprint(result) : null;
  return result;
}
