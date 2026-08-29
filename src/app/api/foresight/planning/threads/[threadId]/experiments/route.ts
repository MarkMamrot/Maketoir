import { NextResponse } from 'next/server';
import { ForesightCampaignExperimentService } from '@/lib/foresight/assistant/ForesightCampaignExperimentService';
import { createGeminiPlannerModelGateway } from '@/lib/foresight/assistant/PlannerModelGateway';
import { ForesightCampaignExperimentValidationError } from '@/lib/foresight/planning/campaignExperimentDocument';
import { CampaignExperimentTransitionError, ForesightCampaignExperimentRepository, type CampaignExperimentReviewAction } from '@/lib/foresight/repositories/ForesightCampaignExperimentRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function threadId(value: string): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const [experiment, review] = await Promise.all([ForesightCampaignExperimentRepository.latest(user.businessId, id), ForesightCampaignExperimentRepository.latestReview(user.businessId, id)]);
  return NextResponse.json({ success: true, experiment, review: experiment && review?.experiment_version_id === experiment.id && review.experiment_hash === experiment.experiment_hash ? review : null });
}

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    if (body?.operation === 'generate') {
      const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) return NextResponse.json({ error: 'Planner AI is not configured.' }, { status: 503 });
      const experiment = await ForesightCampaignExperimentService.generate({ businessId: user.businessId, threadId: id, actorUserId: user.userId,
        modelId: process.env.FORESIGHT_PLANNER_MODEL?.trim() || 'gemini-2.5-flash', model: createGeminiPlannerModelGateway(apiKey, { businessId: user.businessId, area: 'foresight', operation: 'generate_experiment', actorType: 'user', actorUserId: user.userId, referenceType: 'planning_thread', referenceId: id }),
        changeReason: typeof body.changeReason === 'string' ? body.changeReason : null });
      return NextResponse.json({ success: true, experiment }, { status: 201 });
    }
    if (body?.operation === 'review') {
      const experimentVersionId = Number(body.experimentVersionId); const experimentHash = typeof body.experimentHash === 'string' ? body.experimentHash.trim() : '';
      const action = body.action as CampaignExperimentReviewAction; const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!Number.isInteger(experimentVersionId) || experimentVersionId <= 0 || !/^[a-f0-9]{64}$/.test(experimentHash)) return NextResponse.json({ error: 'An exact experiment version and hash are required.' }, { status: 400 });
      if (!['accepted', 'rejected', 'revision_requested'].includes(action)) return NextResponse.json({ error: 'Invalid experiment review action.' }, { status: 400 });
      const reviewId = await ForesightCampaignExperimentRepository.review(user.businessId, id, { experimentVersionId, experimentHash, action, actorId: user.userId, note });
      return NextResponse.json({ success: true, reviewId });
    }
    return NextResponse.json({ error: 'Invalid experiment operation.' }, { status: 400 });
  } catch (error) {
    if (error instanceof CampaignExperimentTransitionError) return NextResponse.json({ error: error.message, code: 'EXPERIMENT_REJECTED' }, { status: 422 });
    if (error instanceof ForesightCampaignExperimentValidationError) return NextResponse.json({ error: 'The model returned an invalid campaign experiment.', code: 'INVALID_EXPERIMENT', issues: error.issues }, { status: 422 });
    throw error;
  }
}