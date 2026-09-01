import { NextResponse } from 'next/server';
import { ForesightPlanDraftingService, PlanDraftRejectedError } from '@/lib/foresight/assistant/ForesightPlanDraftingService';
import { createGeminiPlannerModelGateway } from '@/lib/foresight/assistant/PlannerModelGateway';
import { ForesightPlanValidationError } from '@/lib/foresight/planning/planDocument';
import { PlanReviewTransitionError, PlanningThreadConflictError } from '@/lib/foresight/repositories/ForesightPlanningRepository';
import { requireAdminSession } from '@/lib/sessionUtils';

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const threadId = Number(context.params.threadId);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ error: 'threadId must be a positive integer.' }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const expectedRevision = Number(body?.expectedRevision);
  const changeReason = typeof body?.changeReason === 'string' ? body.changeReason.trim() : '';
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return NextResponse.json({ error: 'expectedRevision must be a positive integer.' }, { status: 400 });
  }
  if (changeReason.length > 500) {
    return NextResponse.json({ error: 'changeReason must be no more than 500 characters.' }, { status: 400 });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Planner AI is not configured.' }, { status: 503 });
  const modelId = process.env.FORESIGHT_PLANNER_MODEL?.trim() || 'gemini-3.7-flash';
  try {
    const draft = await ForesightPlanDraftingService.draft({
      businessId: user.businessId,
      threadId,
      expectedRevision,
      actorUserId: user.userId,
      modelId,
      model: createGeminiPlannerModelGateway(apiKey, { businessId: user.businessId, area: 'foresight', operation: 'generate_plan', actorType: 'user', actorUserId: user.userId, referenceType: 'planning_thread', referenceId: id }),
      changeReason: changeReason || null,
    });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    if (error instanceof PlanningThreadConflictError) {
      return NextResponse.json({ error: error.message, code: 'THREAD_CONFLICT' }, { status: 409 });
    }
    if (error instanceof PlanDraftRejectedError) {
      return NextResponse.json({ error: error.message, code: 'PLAN_REJECTED', validation: error.validation }, { status: 422 });
    }
    if (error instanceof PlanReviewTransitionError) {
      return NextResponse.json({ error: error.message, code: 'PLAN_LOCKED' }, { status: 422 });
    }
    if (error instanceof ForesightPlanValidationError) {
      return NextResponse.json({ error: 'The model returned an invalid plan document.', code: 'INVALID_PLAN', issues: error.issues }, { status: 422 });
    }
    throw error;
  }
}