import { NextResponse } from 'next/server';
import {
  ForesightPlanningRepository,
  PlanReviewTransitionError,
  PlanningThreadConflictError,
  type PlanReviewAction,
} from '@/lib/foresight/repositories/ForesightPlanningRepository';
import { requireAdminTier } from '@/lib/sessionUtils';

const ACTIONS: PlanReviewAction[] = ['submitted', 'accepted', 'rejected', 'revision_requested'];

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const threadId = Number(context.params.threadId);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ error: 'threadId must be a positive integer.' }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const expectedRevision = Number(body?.expectedRevision);
  const planVersionId = Number(body?.planVersionId);
  const planHash = typeof body?.planHash === 'string' ? body.planHash.trim() : '';
  const action = typeof body?.action === 'string' ? body.action as PlanReviewAction : null;
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return NextResponse.json({ error: 'expectedRevision must be a positive integer.' }, { status: 400 });
  }
  if (!Number.isInteger(planVersionId) || planVersionId <= 0 || !/^[a-f0-9]{64}$/.test(planHash)) {
    return NextResponse.json({ error: 'An exact plan version and hash are required.' }, { status: 400 });
  }
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Invalid plan review action.' }, { status: 400 });
  }
  if (note.length > 1_000) {
    return NextResponse.json({ error: 'note must be no more than 1000 characters.' }, { status: 400 });
  }
  try {
    const review = await ForesightPlanningRepository.reviewPlan(
      user.businessId,
      threadId,
      expectedRevision,
      { planVersionId, planHash, action, actorId: user.userId, note: note || null },
    );
    return NextResponse.json({ success: true, review });
  } catch (error) {
    if (error instanceof PlanningThreadConflictError) {
      return NextResponse.json({ error: error.message, code: 'THREAD_CONFLICT' }, { status: 409 });
    }
    if (error instanceof PlanReviewTransitionError) {
      return NextResponse.json({ error: error.message, code: 'PLAN_REVIEW_REJECTED' }, { status: 422 });
    }
    throw error;
  }
}