import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { ExperimentResultValidationError, type ExperimentObservationPackage } from '@/lib/foresight/experimentResults';
import { ExperimentEvidenceCsvError, importExperimentEvidenceCsv } from '@/lib/foresight/experimentEvidenceCsv';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { CampaignExperimentResultTransitionError, ForesightCampaignExperimentResultRepository } from '@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository';
import { ForesightCampaignExperimentRepository } from '@/lib/foresight/repositories/ForesightCampaignExperimentRepository';
import { ForesightCampaignExperimentLaunchRepository } from '@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function threadId(value: string): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
async function businessToday(businessId: string): Promise<string> {
  const timeZone = await runImsForBusiness(businessId, () => getBusinessTimeZone(businessId)).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
  return new Date().toLocaleDateString('sv-SE', { timeZone });
}
function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, Number(item)]));
}
function variant(value: unknown) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { sampleSize: Number(input.sampleSize), conversions: input.conversions == null ? undefined : Number(input.conversions),
    metricSum: input.metricSum == null ? undefined : Number(input.metricSum), metricSumSquares: input.metricSumSquares == null ? undefined : Number(input.metricSumSquares),
    guardrailEvents: numberRecord(input.guardrailEvents) };
}

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  return NextResponse.json({ success: true, result: await ForesightCampaignExperimentResultRepository.getForThread(user.businessId, id) });
}

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const launchId = Number(body?.launchId); const experimentVersionId = Number(body?.experimentVersionId);
  const experimentHash = typeof body?.experimentHash === 'string' ? body.experimentHash.trim() : '';
  if (!Number.isInteger(launchId) || launchId <= 0 || !Number.isInteger(experimentVersionId) || experimentVersionId <= 0 || !/^[a-f0-9]{64}$/.test(experimentHash)) {
    return NextResponse.json({ error: 'An exact launch, experiment version, and hash are required.' }, { status: 400 });
  }
  if (body?.operation === 'preview_csv') {
    const csv = typeof body.csv === 'string' ? body.csv : '';
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) : '';
    if (!csv || !fileName) return NextResponse.json({ error: 'A named CSV file is required.' }, { status: 400 });
    try {
      const [experiment, review, launch] = await Promise.all([
        ForesightCampaignExperimentRepository.latest(user.businessId, id),
        ForesightCampaignExperimentRepository.latestReview(user.businessId, id),
        ForesightCampaignExperimentLaunchRepository.getForThread(user.businessId, id),
      ]);
      if (!experiment || !review || !launch || review.action !== 'accepted'
        || experiment.id !== experimentVersionId || experiment.experiment_hash !== experimentHash
        || review.experiment_version_id !== experiment.id || review.experiment_hash !== experiment.experiment_hash
        || launch.id !== launchId || launch.experiment_version_id !== experiment.id || launch.experiment_hash !== experiment.experiment_hash) {
        return NextResponse.json({ error: 'CSV preview requires the exact accepted experiment and launch.', code: 'EXPERIMENT_EVIDENCE_REJECTED' }, { status: 422 });
      }
      const observations = importExperimentEvidenceCsv({ csv, design: experiment.experiment_json,
        controlExternalId: launch.control_external_id, treatmentExternalId: launch.treatment_external_id,
        observedFrom: launch.launched_on, observedThrough: launch.scheduled_end_on, source: `verified_csv:${fileName}` });
      return NextResponse.json({ success: true, observations });
    } catch (error) {
      if (error instanceof ExperimentEvidenceCsvError || error instanceof ExperimentResultValidationError) {
        return NextResponse.json({ error: error.message, code: 'EXPERIMENT_EVIDENCE_REJECTED' }, { status: 422 });
      }
      await reportRuntimeIssue({ businessId: user.businessId, source: 'ForesightPlanner', operation: 'preview_campaign_experiment_evidence', severity: 'error',
        title: 'Campaign experiment evidence preview failed', error, reference: { type: 'planning_thread', id }, context: { launchId, experimentVersionId } }).catch(() => undefined);
      throw error;
    }
  }
  const qualityIssues = Array.isArray(body?.qualityIssues) ? body.qualityIssues.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
  const observations: ExperimentObservationPackage = {
    source: typeof body?.source === 'string' ? body.source.trim() : '', observedFrom: typeof body?.observedFrom === 'string' ? body.observedFrom : '',
    observedThrough: typeof body?.observedThrough === 'string' ? body.observedThrough : '', qualityIssues,
    control: variant(body?.control), treatment: variant(body?.treatment),
  };
  try {
    const result = await ForesightCampaignExperimentResultRepository.create(user.businessId, id, {
      launchId, experimentVersionId, experimentHash, businessToday: await businessToday(user.businessId), observations, evaluatedBy: user.userId,
    });
    return NextResponse.json({ success: true, result }, { status: 201 });
  } catch (error) {
    if (error instanceof CampaignExperimentResultTransitionError || error instanceof ExperimentResultValidationError) {
      return NextResponse.json({ error: error.message, code: 'EXPERIMENT_RESULT_REJECTED' }, { status: 422 });
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'A result already exists for this experiment launch.', code: 'EXPERIMENT_RESULT_EXISTS' }, { status: 422 });
    await reportRuntimeIssue({ businessId: user.businessId, source: 'ForesightPlanner', operation: 'record_campaign_experiment_result', severity: 'error',
      title: 'Campaign experiment result recording failed', error, reference: { type: 'planning_thread', id }, context: { launchId, experimentVersionId } }).catch(() => undefined);
    throw error;
  }
}