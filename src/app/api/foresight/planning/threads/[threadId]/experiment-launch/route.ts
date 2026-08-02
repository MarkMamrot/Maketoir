import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { ForesightMetaExperimentLaunchPackageService, MetaExperimentLaunchPackageValidationError } from '@/lib/foresight/ForesightMetaExperimentLaunchPackageService';
import { CampaignExperimentLaunchValidationError, ForesightCampaignExperimentLaunchRepository } from '@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository';
import { ForesightMetaExperimentLaunchPackageRepository } from '@/lib/foresight/repositories/ForesightMetaExperimentLaunchPackageRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function threadId(value: string): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
async function businessToday(businessId: string): Promise<string> {
  const timeZone = await runImsForBusiness(businessId, () => getBusinessTimeZone(businessId)).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
  return new Date().toLocaleDateString('sv-SE', { timeZone });
}

export async function GET(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const parameters = new URL(request.url).searchParams;
  if (parameters.get('view') === 'meta-package') {
    const experimentVersionId = Number(parameters.get('experimentVersionId'));
    const experimentHash = parameters.get('experimentHash')?.trim() ?? '';
    if (!Number.isInteger(experimentVersionId) || experimentVersionId <= 0 || !/^[a-f0-9]{64}$/.test(experimentHash)) {
      return NextResponse.json({ error: 'An exact experiment version and hash are required.' }, { status: 400 });
    }
    try {
      const confirmation = await ForesightMetaExperimentLaunchPackageRepository.getForThread(user.businessId, id);
      const packageResult = await ForesightMetaExperimentLaunchPackageService.build(user.businessId, id, {
        experimentVersionId, experimentHash,
        controlCampaignId: parameters.get('controlCampaignId') || confirmation?.control_campaign_id,
        treatmentCampaignId: parameters.get('treatmentCampaignId') || confirmation?.treatment_campaign_id,
      });
      return NextResponse.json({ success: true, package: packageResult, confirmation });
    } catch (error) {
      if (error instanceof MetaExperimentLaunchPackageValidationError) {
        return NextResponse.json({ error: error.message, code: 'META_EXPERIMENT_PACKAGE_REJECTED' }, { status: 422 });
      }
      await reportRuntimeIssue({ businessId: user.businessId, source: 'ForesightPlanner', operation: 'build_meta_experiment_launch_package', severity: 'error',
        title: 'Meta experiment launch package failed', error, reference: { type: 'planning_thread', id }, context: { experimentVersionId } }).catch(() => undefined);
      throw error;
    }
  }
  const launch = await ForesightCampaignExperimentLaunchRepository.getForThread(user.businessId, id);
  return NextResponse.json({ success: true, launch });
}

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const experimentVersionId = Number(body?.experimentVersionId); const experimentHash = typeof body?.experimentHash === 'string' ? body.experimentHash.trim() : '';
  if (!Number.isInteger(experimentVersionId) || experimentVersionId <= 0 || !/^[a-f0-9]{64}$/.test(experimentHash)) return NextResponse.json({ error: 'An exact experiment version and hash are required.' }, { status: 400 });
  if (body?.operation === 'confirm-meta-package') {
    const controlCampaignId = typeof body.controlCampaignId === 'string' ? body.controlCampaignId.trim() : '';
    const treatmentCampaignId = typeof body.treatmentCampaignId === 'string' ? body.treatmentCampaignId.trim() : '';
    const packageFingerprint = typeof body.packageFingerprint === 'string' ? body.packageFingerprint.trim() : '';
    if (!controlCampaignId || !treatmentCampaignId || !/^[a-f0-9]{64}$/.test(packageFingerprint)) {
      return NextResponse.json({ error: 'Exact campaign mappings and package fingerprint are required.' }, { status: 400 });
    }
    try {
      const confirmation = await ForesightMetaExperimentLaunchPackageService.confirm(user.businessId, id, {
        experimentVersionId, experimentHash, controlCampaignId, treatmentCampaignId, packageFingerprint, confirmedBy: user.userId,
      });
      return NextResponse.json({ success: true, confirmation }, { status: 201 });
    } catch (error) {
      if (error instanceof MetaExperimentLaunchPackageValidationError) {
        return NextResponse.json({ error: error.message, code: 'META_EXPERIMENT_PACKAGE_REJECTED' }, { status: 422 });
      }
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        return NextResponse.json({ error: 'A Meta launch package is already confirmed for this experiment.', code: 'META_EXPERIMENT_PACKAGE_EXISTS' }, { status: 422 });
      }
      await reportRuntimeIssue({ businessId: user.businessId, source: 'ForesightPlanner', operation: 'confirm_meta_experiment_launch_package', severity: 'error',
        title: 'Meta experiment launch package confirmation failed', error, reference: { type: 'planning_thread', id }, context: { experimentVersionId } }).catch(() => undefined);
      throw error;
    }
  }
  try {
    const launch = await ForesightCampaignExperimentLaunchRepository.create(user.businessId, id, {
      experimentVersionId, experimentHash, launchedOn: typeof body?.launchedOn === 'string' ? body.launchedOn : '',
      scheduledEndOn: typeof body?.scheduledEndOn === 'string' ? body.scheduledEndOn : '', businessToday: await businessToday(user.businessId),
      channel: body?.channel as 'meta' | 'google_ads' | 'klaviyo', controlExternalId: typeof body?.controlExternalId === 'string' ? body.controlExternalId : '',
      treatmentExternalId: typeof body?.treatmentExternalId === 'string' ? body.treatmentExternalId : '', controlAllocation: Number(body?.controlAllocation),
      treatmentAllocation: Number(body?.treatmentAllocation), targetSamplePerVariant: Number(body?.targetSamplePerVariant),
      randomAssignmentAttested: body?.randomAssignmentAttested === true, singleVariableAttested: body?.singleVariableAttested === true,
      implementationDetails: typeof body?.implementationDetails === 'string' ? body.implementationDetails : '',
      deviationsText: typeof body?.deviationsText === 'string' ? body.deviationsText : null,
      operatorNote: typeof body?.operatorNote === 'string' ? body.operatorNote : '', launchedBy: user.userId,
    });
    return NextResponse.json({ success: true, launch }, { status: 201 });
  } catch (error) {
    if (error instanceof CampaignExperimentLaunchValidationError) return NextResponse.json({ error: error.message, code: 'EXPERIMENT_LAUNCH_REJECTED' }, { status: 422 });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'Launch has already been recorded for this experiment.', code: 'EXPERIMENT_LAUNCH_EXISTS' }, { status: 422 });
    await reportRuntimeIssue({ businessId: user.businessId, source: 'ForesightPlanner', operation: 'record_campaign_experiment_launch', severity: 'error',
      title: 'Campaign experiment launch attestation failed', error, reference: { type: 'planning_thread', id }, context: { experimentVersionId } }).catch(() => undefined);
    throw error;
  }
}