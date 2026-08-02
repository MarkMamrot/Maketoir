import { createHash } from 'node:crypto';
import type { MetaCampaignOption } from '@/services/MetaAdsReadService';
import type { ForesightCampaignExperimentDocument } from './planning/campaignExperimentDocument';

export interface MetaExperimentExecutionPreflight {
  mode: 'read_only_meta_experiment_execution_preflight';
  executable: false;
  ready: boolean;
  checkedAt: string;
  businessToday: string;
  experimentVersionId: number;
  experimentHash: string;
  packageConfirmationId: number;
  packageFingerprint: string;
  accountId: string;
  businessManagerId: string;
  studyName: string;
  launchedOn: string;
  scheduledEndOn: string;
  targetSamplePerVariant: number;
  startTime: number;
  endTime: number;
  control: { campaignId: string; name: string; allocationPercent: number };
  treatment: { campaignId: string; name: string; allocationPercent: number };
  campaigns: MetaCampaignOption[];
  blockers: Array<{ code: string; message: string }>;
  executionFingerprint: string | null;
}

export function metaExperimentExecutionFingerprint(value: MetaExperimentExecutionPreflight): string {
  return createHash('sha256').update(JSON.stringify({
    mode: value.mode,
    experimentVersionId: value.experimentVersionId,
    experimentHash: value.experimentHash,
    packageConfirmationId: value.packageConfirmationId,
    packageFingerprint: value.packageFingerprint,
    accountId: value.accountId,
    businessManagerId: value.businessManagerId,
    studyName: value.studyName,
    launchedOn: value.launchedOn,
    scheduledEndOn: value.scheduledEndOn,
    targetSamplePerVariant: value.targetSamplePerVariant,
    startTime: value.startTime,
    endTime: value.endTime,
    control: value.control,
    treatment: value.treatment,
    campaigns: [...value.campaigns].sort((left, right) => left.campaignId.localeCompare(right.campaignId)),
    blockers: value.blockers.map(({ code }) => code),
  })).digest('hex');
}

export function buildMetaExperimentExecutionPreflight(input: {
  now: Date;
  businessToday: string;
  experimentVersionId: number;
  experimentHash: string;
  design: ForesightCampaignExperimentDocument;
  packageConfirmationId: number;
  packageFingerprint: string;
  accountId: string;
  businessManagerId: string;
  controlCampaignId: string;
  treatmentCampaignId: string;
  campaigns: MetaCampaignOption[];
}): MetaExperimentExecutionPreflight {
  const blockers: MetaExperimentExecutionPreflight['blockers'] = [];
  const startTime = Math.ceil(input.now.getTime() / 300_000) * 300;
  const endTime = Math.floor(Date.parse(`${input.design.endDate}T23:59:59Z`) / 1_000);
  const studyName = `Foresight experiment ${input.experimentVersionId} ${input.packageFingerprint.slice(0, 12)}`;
  if (input.businessToday !== input.design.startDate) blockers.push({ code: 'outside_accepted_start_date', message: 'Execute on the accepted experiment start date for this business.' });
  if (startTime >= endTime) blockers.push({ code: 'invalid_execution_window', message: 'The accepted experiment window has ended.' });
  if (input.design.channel !== 'meta') blockers.push({ code: 'unsupported_channel', message: 'Only Meta experiments can use this execution path.' });
  if (!/^\d+$/.test(input.businessManagerId)) blockers.push({ code: 'invalid_business_manager', message: 'The owning Meta Business Manager ID is invalid.' });
  if (input.design.allocationPercent.control < 10 || input.design.allocationPercent.treatment < 10) blockers.push({ code: 'unsupported_allocation', message: 'Meta requires each split-test cell to receive at least 10 percent.' });
  const expectedIds = [input.controlCampaignId, input.treatmentCampaignId];
  if (new Set(expectedIds).size !== 2) blockers.push({ code: 'duplicate_campaign', message: 'Control and treatment campaigns must be distinct.' });
  for (const campaignId of expectedIds) {
    const campaign = input.campaigns.find((candidate) => candidate.campaignId === campaignId);
    if (!campaign || campaign.accountId.replace(/^act_/, '') !== input.accountId.replace(/^act_/, '')
      || campaign.configuredStatus !== 'PAUSED' || campaign.effectiveStatus !== 'PAUSED') {
      blockers.push({ code: 'campaign_state_drift', message: `Campaign ${campaignId} must still be paused in the confirmed Meta account.` });
    }
  }
  const result: MetaExperimentExecutionPreflight = {
    mode: 'read_only_meta_experiment_execution_preflight', executable: false, ready: blockers.length === 0,
    checkedAt: input.now.toISOString(), businessToday: input.businessToday,
    experimentVersionId: input.experimentVersionId, experimentHash: input.experimentHash,
    packageConfirmationId: input.packageConfirmationId, packageFingerprint: input.packageFingerprint,
    accountId: input.accountId.replace(/^act_/, ''), businessManagerId: input.businessManagerId,
    studyName, launchedOn: input.design.startDate, scheduledEndOn: input.design.endDate,
    targetSamplePerVariant: input.design.minimumSamplePerVariant, startTime, endTime,
    control: { campaignId: input.controlCampaignId, name: input.design.control.name, allocationPercent: input.design.allocationPercent.control },
    treatment: { campaignId: input.treatmentCampaignId, name: input.design.treatment.name, allocationPercent: input.design.allocationPercent.treatment },
    campaigns: input.campaigns, blockers, executionFingerprint: null,
  };
  result.executionFingerprint = result.ready ? metaExperimentExecutionFingerprint(result) : null;
  return result;
}
