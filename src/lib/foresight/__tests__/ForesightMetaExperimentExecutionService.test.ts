import { describe, expect, it, vi } from 'vitest';
import { createForesightMetaExperimentExecutionService } from '../ForesightMetaExperimentExecutionService';
import { buildMetaExperimentExecutionPreflight, metaExperimentExecutionFingerprint } from '../metaExperimentExecutionPreflight';
import type { ForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';
import type { CampaignExperimentExecutionRow } from '../repositories/ForesightCampaignExperimentExecutionRepository';

const design: ForesightCampaignExperimentDocument = {
  schemaVersion: 1, lessonVersionId: 3, lessonHash: 'a'.repeat(64), title: 'Offer test',
  hypothesis: { text: 'Offer improves conversion.', citationFactIds: ['lesson:3'] }, channel: 'meta', audience: 'Visitors',
  control: { name: 'Control', description: 'Baseline.' }, treatment: { name: 'Treatment', description: 'Offer.' },
  allocationPercent: { control: 50, treatment: 50 }, startDate: '2026-08-01', endDate: '2026-08-07',
  minimumSamplePerVariant: 500, primaryMetric: 'conversion_rate', minimumDetectableLiftPercent: 10,
  guardrails: [{ metric: 'meta_negative_feedback_rate', maximumAdverseChangePercent: 20 }],
  analysis: { method: 'frequentist_two_sided', confidenceLevel: 0.95, inconclusiveWhenUnderpowered: true },
  limitations: ['Meta attribution applies.'], executable: false,
};
const paused = [
  { campaignId: 'c1', campaignName: 'Control', accountId: '123', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
  { campaignId: 'c2', campaignName: 'Treatment', accountId: '123', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
];
const preflight = buildMetaExperimentExecutionPreflight({ now: new Date('2026-08-01T00:01:00Z'), businessToday: '2026-08-01',
  experimentVersionId: 7, experimentHash: 'b'.repeat(64), design, packageConfirmationId: 9, packageFingerprint: 'c'.repeat(64),
  accountId: '123', businessManagerId: '456', controlCampaignId: 'c1', treatmentCampaignId: 'c2', campaigns: paused });
const snapshot = { studyId: 'study-1', businessId: '456', name: preflight.studyName, type: 'SPLIT_TEST',
  startTime: new Date(preflight.startTime * 1_000).toISOString(), endTime: new Date(preflight.endTime * 1_000).toISOString(), canceledTime: null,
  cells: [
    { cellId: 'cell-1', name: 'Control', allocationPercent: 50, campaignIds: ['c1'] },
    { cellId: 'cell-2', name: 'Treatment', allocationPercent: 50, campaignIds: ['c2'] },
  ] };
const active = paused.map((campaign) => ({ ...campaign, configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE' }));
function row(state: CampaignExperimentExecutionRow['state']): CampaignExperimentExecutionRow {
  return { id: 11, business_id: 'business-1', thread_id: 4, experiment_version_id: 7, package_confirmation_id: 9,
    package_fingerprint: preflight.packageFingerprint, execution_fingerprint: preflight.executionFingerprint as string,
    idempotency_key: 'key', execution_kind: 'launch', state, meta_study_id: state === 'succeeded' ? 'study-1' : null,
    before_json: { campaigns: paused }, request_json: { operation: 'create_meta_split_test', plan: preflight },
    response_json: null, after_json: null, error_text: null, compensates_execution_id: null, actor_id: 5,
    created_at: '2026-08-01T00:00:00Z', completed_at: state === 'in_progress' ? null : '2026-08-01T00:06:00Z' };
}
function setup(existing: CampaignExperimentExecutionRow | null = null, compensation: CampaignExperimentExecutionRow | null = null) {
  let canceled = false;
  const createSplitTest = vi.fn().mockResolvedValue(snapshot);
  const findSplitTestByName = vi.fn().mockImplementation(async () => canceled ? null : snapshot);
  const updateCampaignStatuses = vi.fn().mockResolvedValue([{ success: true }, { success: true }]);
  const getCampaignStatuses = vi.fn().mockImplementation(async () => canceled ? paused : active);
  const cancelSplitTest = vi.fn().mockImplementation(async () => { canceled = true; return { success: true }; });
  const complete = vi.fn().mockImplementation(async input => ({ ...row(input.state), meta_study_id: input.metaStudyId }));
  const claim = vi.fn().mockResolvedValue({ created: true, execution: row('in_progress') });
  const createLaunch = vi.fn().mockResolvedValue({ id: 20 });
  const claimCompensation = vi.fn().mockResolvedValue({ created: compensation == null, execution: compensation ?? { ...row('in_progress'), id: 12, execution_kind: 'compensation', compensates_execution_id: 11 } });
  const service = createForesightMetaExperimentExecutionService({
    preflight: vi.fn().mockResolvedValue(preflight), getExecution: vi.fn().mockResolvedValue(existing), claim, complete,
    createClient: vi.fn().mockResolvedValue({ createSplitTest, findSplitTestByName, updateCampaignStatuses, getCampaignStatuses, cancelSplitTest }),
    getLaunch: vi.fn().mockResolvedValue(null), createLaunch, claimCompensation,
  });
  return { service, createSplitTest, findSplitTestByName, updateCampaignStatuses, getCampaignStatuses, cancelSplitTest, claim, complete, createLaunch, claimCompensation };
}
const input = { businessId: 'business-1', threadId: 4, experimentVersionId: 7, actorId: 5,
  executionFingerprint: metaExperimentExecutionFingerprint(preflight) };

describe('ForesightMetaExperimentExecutionService', () => {
  it('creates once and records launch only after exact study and campaign read-back', async () => {
    const context = setup();
    const result = await context.service.execute(input);
    expect(context.createSplitTest).toHaveBeenCalledOnce();
    expect(context.updateCampaignStatuses).toHaveBeenCalledWith([{ campaignId: 'c1', status: 'ACTIVE' }, { campaignId: 'c2', status: 'ACTIVE' }]);
    expect(context.complete).toHaveBeenCalledWith(expect.objectContaining({ state: 'succeeded', metaStudyId: 'study-1', errorText: null }));
    expect(context.createLaunch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ idempotentReplay: false, mutationSubmitted: true });
  });

  it('rejects stale final confirmation before claim or mutation', async () => {
    const context = setup();
    await expect(context.service.execute({ ...input, executionFingerprint: 'stale' })).rejects.toThrow('state changed');
    expect(context.claim).not.toHaveBeenCalled();
    expect(context.createSplitTest).not.toHaveBeenCalled();
  });

  it('reconciles an interrupted claim without repeating platform mutations', async () => {
    const context = setup(row('in_progress'));
    const result = await context.service.execute(input);
    expect(context.findSplitTestByName).toHaveBeenCalledWith('456', preflight.studyName);
    expect(context.createSplitTest).not.toHaveBeenCalled();
    expect(context.updateCampaignStatuses).not.toHaveBeenCalled();
    expect(result).toMatchObject({ idempotentReplay: true, mutationSubmitted: false });
  });

  it('cancels the exact study and pauses only its two campaigns with verified compensation', async () => {
    const context = setup(row('succeeded'));
    const result = await context.service.rollback({ businessId: 'business-1', threadId: 4, experimentVersionId: 7, actorId: 5 });
    expect(context.cancelSplitTest).toHaveBeenCalledWith('study-1');
    expect(context.updateCampaignStatuses).toHaveBeenCalledWith([{ campaignId: 'c1', status: 'PAUSED' }, { campaignId: 'c2', status: 'PAUSED' }]);
    expect(context.complete).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'compensated', errorText: null }));
    expect(result).toMatchObject({ idempotentReplay: false, mutationSubmitted: true });
  });

  it('does not repeat a completed compensation', async () => {
    const compensation = { ...row('compensated'), id: 12, execution_kind: 'compensation' as const, compensates_execution_id: 11 };
    const context = setup(row('succeeded'), compensation);
    const result = await context.service.rollback({ businessId: 'business-1', threadId: 4, experimentVersionId: 7, actorId: 5 });
    expect(context.cancelSplitTest).not.toHaveBeenCalled();
    expect(context.updateCampaignStatuses).not.toHaveBeenCalled();
    expect(result).toMatchObject({ idempotentReplay: true, mutationSubmitted: false });
  });
});
