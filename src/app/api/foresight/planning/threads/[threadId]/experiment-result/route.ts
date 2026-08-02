import { NextResponse } from 'next/server';
import { CampaignExperimentResultTransitionError, ForesightCampaignExperimentResultRepository, type CampaignExperimentResultReviewAction } from '@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function threadId(value: string): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const [result, review] = await Promise.all([
    ForesightCampaignExperimentResultRepository.getForThread(user.businessId, id),
    ForesightCampaignExperimentResultRepository.latestReview(user.businessId, id),
  ]);
  return NextResponse.json({ success: true, result, review: result && review?.result_id === result.id
    && review.experiment_version_id === result.experiment_version_id && review.experiment_hash === result.experiment_hash
    && review.launch_id === result.launch_id ? review : null });
}

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const resultId = Number(body?.resultId); const experimentVersionId = Number(body?.experimentVersionId); const launchId = Number(body?.launchId);
  const experimentHash = typeof body?.experimentHash === 'string' ? body.experimentHash.trim() : '';
  const action = body?.action as CampaignExperimentResultReviewAction;
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (![resultId, experimentVersionId, launchId].every((value) => Number.isInteger(value) && value > 0) || !/^[a-f0-9]{64}$/.test(experimentHash)) {
    return NextResponse.json({ error: 'The exact result, launch, experiment version, and hash are required.' }, { status: 400 });
  }
  if (!['acknowledged', 'rejected'].includes(action)) return NextResponse.json({ error: 'Invalid conclusion review action.' }, { status: 400 });
  try {
    const reviewId = await ForesightCampaignExperimentResultRepository.review(user.businessId, id, {
      resultId, experimentVersionId, experimentHash, launchId, action, actorId: user.userId, note,
    });
    return NextResponse.json({ success: true, reviewId });
  } catch (error) {
    if (error instanceof CampaignExperimentResultTransitionError) {
      return NextResponse.json({ error: error.message, code: 'EXPERIMENT_CONCLUSION_REVIEW_REJECTED' }, { status: 422 });
    }
    throw error;
  }
}
