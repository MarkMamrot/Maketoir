import { NextResponse } from 'next/server';
import { ForesightCampaignLessonService } from '@/lib/foresight/assistant/ForesightCampaignLessonService';
import { createGeminiPlannerModelGateway } from '@/lib/foresight/assistant/PlannerModelGateway';
import { ForesightCampaignLessonValidationError } from '@/lib/foresight/planning/campaignLessonDocument';
import {
  CampaignLessonTransitionError, ForesightCampaignLessonRepository,
  type CampaignLessonReviewAction,
} from '@/lib/foresight/repositories/ForesightCampaignLessonRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function threadId(value: string): number | null {
  const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const [lesson, review] = await Promise.all([
    ForesightCampaignLessonRepository.latest(user.businessId, id),
    ForesightCampaignLessonRepository.latestReview(user.businessId, id),
  ]);
  return NextResponse.json({ success: true, lesson, review: lesson && review?.lesson_version_id === lesson.id && review.lesson_hash === lesson.lesson_hash ? review : null });
}

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    if (body?.operation === 'generate') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'Planner AI is not configured.' }, { status: 503 });
      const lesson = await ForesightCampaignLessonService.generate({
        businessId: user.businessId, threadId: id, actorUserId: user.userId,
        modelId: process.env.FORESIGHT_PLANNER_MODEL?.trim() || 'gemini-2.5-flash',
        model: createGeminiPlannerModelGateway(apiKey),
        changeReason: typeof body.changeReason === 'string' ? body.changeReason : null,
      });
      return NextResponse.json({ success: true, lesson }, { status: 201 });
    }
    if (body?.operation === 'review') {
      const lessonVersionId = Number(body.lessonVersionId);
      const lessonHash = typeof body.lessonHash === 'string' ? body.lessonHash.trim() : '';
      const action = body.action as CampaignLessonReviewAction;
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!Number.isInteger(lessonVersionId) || lessonVersionId <= 0 || !/^[a-f0-9]{64}$/.test(lessonHash)) return NextResponse.json({ error: 'An exact lesson version and hash are required.' }, { status: 400 });
      if (!['accepted', 'rejected', 'revision_requested'].includes(action)) return NextResponse.json({ error: 'Invalid lesson review action.' }, { status: 400 });
      const reviewId = await ForesightCampaignLessonRepository.review(user.businessId, id, { lessonVersionId, lessonHash, action, actorId: user.userId, note });
      return NextResponse.json({ success: true, reviewId });
    }
    return NextResponse.json({ error: 'Invalid lesson operation.' }, { status: 400 });
  } catch (error) {
    if (error instanceof CampaignLessonTransitionError) return NextResponse.json({ error: error.message, code: 'LESSON_REJECTED' }, { status: 422 });
    if (error instanceof ForesightCampaignLessonValidationError) return NextResponse.json({ error: 'The model returned an invalid campaign lesson.', code: 'INVALID_LESSON', issues: error.issues }, { status: 422 });
    throw error;
  }
}