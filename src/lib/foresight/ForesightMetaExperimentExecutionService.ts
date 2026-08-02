import { createHash } from 'node:crypto';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { MetaAdsReadService, type MetaCampaignOption, type MetaSplitTestSnapshot } from '@/services/MetaAdsReadService';
import { metaExperimentExecutionFingerprint, type MetaExperimentExecutionPreflight } from './metaExperimentExecutionPreflight';
import { ForesightMetaExperimentExecutionPreflightService } from './ForesightMetaExperimentExecutionPreflightService';
import { ForesightCampaignExperimentExecutionRepository, type CampaignExperimentExecutionRow } from './repositories/ForesightCampaignExperimentExecutionRepository';
import { ForesightCampaignExperimentLaunchRepository } from './repositories/ForesightCampaignExperimentLaunchRepository';

interface MetaExperimentClient {
  createSplitTest(input: {
    businessId: string; name: string; description: string; startTime: number; endTime: number;
    control: { campaignId: string; name: string; allocationPercent: number };
    treatment: { campaignId: string; name: string; allocationPercent: number };
  }): Promise<MetaSplitTestSnapshot>;
  findSplitTestByName(businessId: string, name: string): Promise<MetaSplitTestSnapshot | null>;
  getCampaignStatuses(campaignIds: string[]): Promise<MetaCampaignOption[]>;
  updateCampaignStatuses(changes: Array<{ campaignId: string; status: 'ACTIVE' | 'PAUSED' }>): Promise<unknown[]>;
  cancelSplitTest(studyId: string): Promise<unknown>;
}

interface Dependencies {
  preflight(businessId: string, threadId: number): Promise<MetaExperimentExecutionPreflight>;
  getExecution(businessId: string, experimentVersionId: number): Promise<CampaignExperimentExecutionRow | null>;
  claim(input: Parameters<typeof ForesightCampaignExperimentExecutionRepository.claimLaunch>[0]): ReturnType<typeof ForesightCampaignExperimentExecutionRepository.claimLaunch>;
  complete(input: Parameters<typeof ForesightCampaignExperimentExecutionRepository.complete>[0]): ReturnType<typeof ForesightCampaignExperimentExecutionRepository.complete>;
  claimCompensation(input: Parameters<typeof ForesightCampaignExperimentExecutionRepository.claimCompensation>[0]): ReturnType<typeof ForesightCampaignExperimentExecutionRepository.claimCompensation>;
  createClient(businessId: string): Promise<MetaExperimentClient>;
  getLaunch(businessId: string, threadId: number): ReturnType<typeof ForesightCampaignExperimentLaunchRepository.getForThread>;
  createLaunch(businessId: string, threadId: number, input: Parameters<typeof ForesightCampaignExperimentLaunchRepository.create>[2]): ReturnType<typeof ForesightCampaignExperimentLaunchRepository.create>;
}

function key(businessId: string, experimentVersionId: number, fingerprint: string): string {
  return createHash('sha256').update(`meta_experiment:${businessId}:${experimentVersionId}:${fingerprint}`).digest('hex');
}

function plan(execution: CampaignExperimentExecutionRow): MetaExperimentExecutionPreflight {
  const value = execution.request_json.plan;
  if (!value || typeof value !== 'object') throw new Error('Stored Meta experiment execution plan is invalid.');
  return value as MetaExperimentExecutionPreflight;
}

function epoch(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : null;
}

function verifiedStudy(snapshot: MetaSplitTestSnapshot, expected: MetaExperimentExecutionPreflight): boolean {
  if (snapshot.businessId !== expected.businessManagerId || snapshot.name !== expected.studyName || snapshot.type !== 'SPLIT_TEST'
    || snapshot.canceledTime || epoch(snapshot.startTime) !== expected.startTime || epoch(snapshot.endTime) !== expected.endTime) return false;
  const expectedCells = [expected.control, expected.treatment].map((variant) => ({
    name: variant.name, allocationPercent: variant.allocationPercent, campaignIds: [variant.campaignId],
  })).sort((left, right) => left.name.localeCompare(right.name));
  const actualCells = snapshot.cells.map(({ name, allocationPercent, campaignIds }) => ({ name, allocationPercent, campaignIds: [...campaignIds].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return JSON.stringify(actualCells) === JSON.stringify(expectedCells);
}

function activeCampaigns(campaigns: MetaCampaignOption[], expected: MetaExperimentExecutionPreflight): boolean {
  return [expected.control.campaignId, expected.treatment.campaignId].every((id) => {
    const campaign = campaigns.find((value) => value.campaignId === id);
    return campaign?.configuredStatus === 'ACTIVE' && ['ACTIVE', 'PENDING_REVIEW', 'PENDING_PROCESSING'].includes(campaign.effectiveStatus);
  });
}

async function defaultClient(businessId: string): Promise<MetaExperimentClient> {
  const connection = await ConnectionsRepository.get(businessId);
  const accountId = connection?.meta_ad_account_id?.trim() ?? '';
  const token = connection?.meta_access_token?.trim() ?? '';
  if (!accountId || !token) throw new Error('Meta ad account ID and tenant access token are required.');
  return new MetaAdsReadService(decrypt(token), accountId);
}

const defaultDependencies: Dependencies = {
  preflight: (businessId, threadId) => ForesightMetaExperimentExecutionPreflightService.preflight(businessId, threadId),
  getExecution: (businessId, experimentVersionId) => ForesightCampaignExperimentExecutionRepository.getForExperiment(businessId, experimentVersionId),
  claim: input => ForesightCampaignExperimentExecutionRepository.claimLaunch(input),
  complete: input => ForesightCampaignExperimentExecutionRepository.complete(input),
  claimCompensation: input => ForesightCampaignExperimentExecutionRepository.claimCompensation(input),
  createClient: defaultClient,
  getLaunch: (businessId, threadId) => ForesightCampaignExperimentLaunchRepository.getForThread(businessId, threadId),
  createLaunch: (businessId, threadId, input) => ForesightCampaignExperimentLaunchRepository.create(businessId, threadId, input),
};

export function createForesightMetaExperimentExecutionService(dependencies: Dependencies = defaultDependencies) {
  async function reconcile(businessId: string, execution: CampaignExperimentExecutionRow, client: MetaExperimentClient, snapshot: MetaSplitTestSnapshot | null) {
    const expected = plan(execution);
    const study = snapshot ?? await client.findSplitTestByName(expected.businessManagerId, expected.studyName);
    const campaigns = await client.getCampaignStatuses([expected.control.campaignId, expected.treatment.campaignId]);
    const studyMatches = Boolean(study && verifiedStudy(study, expected));
    const campaignsActive = activeCampaigns(campaigns, expected);
    return dependencies.complete({
      businessId, executionId: execution.id, state: studyMatches && campaignsActive ? 'succeeded' : 'failed',
      metaStudyId: study?.studyId ?? null, response: study ? { study } : null,
      after: { studyMatches, campaignsActive, campaigns },
      errorText: studyMatches && campaignsActive ? null : 'Meta read-back did not prove the exact split test and active campaign pair. Rollback or manual review is required.',
    });
  }

  async function ensureLaunch(businessId: string, threadId: number, actorId: number, execution: CampaignExperimentExecutionRow) {
    if (execution.state !== 'succeeded') return null;
    const existing = await dependencies.getLaunch(businessId, threadId);
    if (existing) return existing;
    const expected = plan(execution);
    return dependencies.createLaunch(businessId, threadId, {
      experimentVersionId: expected.experimentVersionId, experimentHash: expected.experimentHash,
      launchedOn: expected.launchedOn, scheduledEndOn: expected.scheduledEndOn, businessToday: expected.businessToday,
      channel: 'meta', controlExternalId: expected.control.campaignId, treatmentExternalId: expected.treatment.campaignId,
      controlAllocation: expected.control.allocationPercent, treatmentAllocation: expected.treatment.allocationPercent,
      targetSamplePerVariant: expected.targetSamplePerVariant, randomAssignmentAttested: true, singleVariableAttested: true,
      implementationDetails: `Meta SPLIT_TEST ${execution.meta_study_id} verified by exact API read-back.`,
      deviationsText: null, operatorNote: `Automated governed execution ${execution.id}.`, launchedBy: actorId,
    });
  }

  return {
    async execute(input: { businessId: string; threadId: number; experimentVersionId: number; actorId: number; executionFingerprint: string }) {
      const existing = await dependencies.getExecution(input.businessId, input.experimentVersionId);
      if (existing) {
        const execution = existing.state === 'in_progress'
          ? await reconcile(input.businessId, existing, await dependencies.createClient(input.businessId), null)
          : existing;
        const launch = await ensureLaunch(input.businessId, input.threadId, input.actorId, execution);
        return { execution, launch, idempotentReplay: true, mutationSubmitted: false };
      }
      const preflight = await dependencies.preflight(input.businessId, input.threadId);
      const fingerprint = metaExperimentExecutionFingerprint(preflight);
      if (!preflight.ready || !preflight.executionFingerprint || preflight.executionFingerprint !== fingerprint) {
        throw new Error('Live Meta experiment execution preflight is blocked.');
      }
      if (input.experimentVersionId !== preflight.experimentVersionId || input.executionFingerprint !== fingerprint) {
        throw new Error('Live Meta experiment state changed; refresh and confirm the exact execution again.');
      }
      const claim = await dependencies.claim({
        businessId: input.businessId, threadId: input.threadId, experimentVersionId: preflight.experimentVersionId,
        experimentHash: preflight.experimentHash, packageConfirmationId: preflight.packageConfirmationId,
        packageFingerprint: preflight.packageFingerprint, executionFingerprint: fingerprint,
        idempotencyKey: key(input.businessId, preflight.experimentVersionId, fingerprint), actorId: input.actorId,
        before: { campaigns: preflight.campaigns }, request: { operation: 'create_meta_split_test', plan: preflight },
      });
      const client = await dependencies.createClient(input.businessId);
      if (!claim.created) {
        const execution = claim.execution.state === 'in_progress'
          ? await reconcile(input.businessId, claim.execution, client, null)
          : claim.execution;
        return { execution, launch: await ensureLaunch(input.businessId, input.threadId, input.actorId, execution), idempotentReplay: true, mutationSubmitted: false };
      }
      let snapshot: MetaSplitTestSnapshot | null = null;
      try {
        snapshot = await client.createSplitTest({
          businessId: preflight.businessManagerId, name: preflight.studyName,
          description: `Foresight accepted experiment ${preflight.experimentVersionId}`,
          startTime: preflight.startTime, endTime: preflight.endTime,
          control: preflight.control, treatment: preflight.treatment,
        });
        await client.updateCampaignStatuses([
          { campaignId: preflight.control.campaignId, status: 'ACTIVE' },
          { campaignId: preflight.treatment.campaignId, status: 'ACTIVE' },
        ]);
      } catch (error) {
        await reportRuntimeIssue({ businessId: input.businessId, source: 'ForesightPlanner', operation: 'execute_meta_campaign_experiment',
          severity: 'error', title: 'Meta campaign experiment execution failed', error,
          reference: { type: 'campaign_experiment_execution', id: claim.execution.id },
          context: { experimentVersionId: preflight.experimentVersionId, metaStudyId: snapshot?.studyId ?? null } }).catch(() => undefined);
      }
      const execution = await reconcile(input.businessId, claim.execution, client, snapshot);
      const launch = await ensureLaunch(input.businessId, input.threadId, input.actorId, execution);
      return { execution, launch, idempotentReplay: false, mutationSubmitted: true };
    },

    async rollback(input: { businessId: string; threadId: number; experimentVersionId: number; actorId: number }) {
      const original = await dependencies.getExecution(input.businessId, input.experimentVersionId);
      if (!original || original.thread_id !== input.threadId || !['succeeded', 'failed'].includes(original.state) || !original.meta_study_id) {
        throw new Error('Only the exact Meta experiment execution with a recorded study can be rolled back.');
      }
      const expected = plan(original);
      const client = await dependencies.createClient(input.businessId);
      const reconcileCompensation = async (execution: CampaignExperimentExecutionRow) => {
        const [study, campaigns] = await Promise.all([
          client.findSplitTestByName(expected.businessManagerId, expected.studyName),
          client.getCampaignStatuses([expected.control.campaignId, expected.treatment.campaignId]),
        ]);
        const paused = [expected.control.campaignId, expected.treatment.campaignId].every((id) => {
          const campaign = campaigns.find((value) => value.campaignId === id);
          return campaign?.configuredStatus === 'PAUSED' && campaign.effectiveStatus === 'PAUSED';
        });
        return dependencies.complete({ businessId: input.businessId, executionId: execution.id,
          state: !study && paused ? 'compensated' : 'failed', metaStudyId: original.meta_study_id,
          response: null, after: { studyAbsent: !study, campaignsPaused: paused, campaigns },
          errorText: !study && paused ? null : 'Meta rollback read-back did not prove study deletion and both campaigns paused.' });
      };
      const claim = await dependencies.claimCompensation({
        businessId: input.businessId, originalExecutionId: original.id,
        idempotencyKey: key(input.businessId, original.experiment_version_id, `rollback:${original.execution_fingerprint}`),
        actorId: input.actorId, before: { metaStudyId: original.meta_study_id },
        request: { operation: 'cancel_meta_split_test', campaignIds: [expected.control.campaignId, expected.treatment.campaignId] },
      });
      if (!claim.created) {
        const execution = claim.execution.state === 'in_progress' ? await reconcileCompensation(claim.execution) : claim.execution;
        return { execution, idempotentReplay: true, mutationSubmitted: false };
      }
      const liveStudy = await client.findSplitTestByName(expected.businessManagerId, expected.studyName);
      if (!liveStudy || liveStudy.studyId !== original.meta_study_id || !verifiedStudy(liveStudy, expected)) {
        const execution = await dependencies.complete({ businessId: input.businessId, executionId: claim.execution.id,
          state: 'failed', metaStudyId: original.meta_study_id, response: null, after: { liveStudy },
          errorText: 'Live Meta study no longer matches the exact original execution; no rollback mutation was submitted.' });
        return { execution, idempotentReplay: false, mutationSubmitted: false };
      }
      try {
        await client.cancelSplitTest(original.meta_study_id);
        await client.updateCampaignStatuses([
          { campaignId: expected.control.campaignId, status: 'PAUSED' },
          { campaignId: expected.treatment.campaignId, status: 'PAUSED' },
        ]);
      } catch (error) {
        await reportRuntimeIssue({ businessId: input.businessId, source: 'ForesightPlanner', operation: 'rollback_meta_campaign_experiment',
          severity: 'error', title: 'Meta campaign experiment rollback failed', error,
          reference: { type: 'campaign_experiment_execution', id: claim.execution.id },
          context: { experimentVersionId: input.experimentVersionId, metaStudyId: original.meta_study_id } }).catch(() => undefined);
      }
      return { execution: await reconcileCompensation(claim.execution), idempotentReplay: false, mutationSubmitted: true };
    },
  };
}

export const ForesightMetaExperimentExecutionService = createForesightMetaExperimentExecutionService();
