import { NextResponse } from 'next/server';
import {
  FORESIGHT_DELIVERABLE_CHANNELS,
  ForesightDeliverableService,
} from '@/lib/foresight/assistant/ForesightDeliverableService';
import { createGeminiPlannerModelGateway } from '@/lib/foresight/assistant/PlannerModelGateway';
import {
  ForesightDeliverableValidationError,
  type DeliverableChannel,
} from '@/lib/foresight/planning/deliverableDocument';
import {
  DeliverableTransitionError,
  ForesightDeliverableRepository,
  type DeliverableReviewAction,
} from '@/lib/foresight/repositories/ForesightDeliverableRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function threadId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const id = threadId(context.params.threadId);
  if (id == null) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const [deliverable, review] = await Promise.all([
    ForesightDeliverableRepository.latest(user.businessId, id),
    ForesightDeliverableRepository.latestReview(user.businessId, id),
  ]);
  return NextResponse.json({
    success: true,
    deliverable,
    review: review && deliverable
      && review.deliverable_version_id === deliverable.id
      && review.document_hash === deliverable.document_hash
      ? review
      : null,
  });
}

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const id = threadId(context.params.threadId);
  if (id == null) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const operation = body?.operation;
  try {
    if (operation === 'generate') {
      const channels = Array.isArray(body?.channels)
        ? body.channels.filter((channel): channel is DeliverableChannel => FORESIGHT_DELIVERABLE_CHANNELS.includes(channel as DeliverableChannel))
        : [];
      const changeReason = typeof body?.changeReason === 'string' ? body.changeReason.trim() : '';
      if (changeReason.length > 1_000) return NextResponse.json({ error: 'changeReason is too long.' }, { status: 400 });
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'Planner AI is not configured.' }, { status: 503 });
      const modelId = process.env.FORESIGHT_PLANNER_MODEL?.trim() || 'gemini-2.5-flash';
      const deliverable = await ForesightDeliverableService.generate({
        businessId: user.businessId, threadId: id, actorUserId: user.userId, modelId,
        model: createGeminiPlannerModelGateway(apiKey, { businessId: user.businessId, area: 'foresight', operation: 'generate_deliverables', actorType: 'user', actorUserId: user.userId, referenceType: 'planning_thread', referenceId: id }), channels, changeReason: changeReason || null,
      });
      return NextResponse.json({ success: true, deliverable }, { status: 201 });
    }
    if (operation === 'review') {
      const deliverableVersionId = Number(body?.deliverableVersionId);
      const documentHash = typeof body?.documentHash === 'string' ? body.documentHash.trim() : '';
      const action = body?.action as DeliverableReviewAction;
      const note = typeof body?.note === 'string' ? body.note.trim() : '';
      if (!Number.isInteger(deliverableVersionId) || deliverableVersionId <= 0 || !/^[a-f0-9]{64}$/.test(documentHash)) {
        return NextResponse.json({ error: 'An exact deliverable version and hash are required.' }, { status: 400 });
      }
      if (!['accepted', 'rejected', 'revision_requested'].includes(action)) {
        return NextResponse.json({ error: 'Invalid deliverable review action.' }, { status: 400 });
      }
      if (note.length > 1_000) return NextResponse.json({ error: 'note is too long.' }, { status: 400 });
      const reviewId = await ForesightDeliverableRepository.review(user.businessId, id, {
        deliverableVersionId, documentHash, action, actorId: user.userId, note: note || null,
      });
      return NextResponse.json({ success: true, reviewId });
    }
    return NextResponse.json({ error: 'Invalid deliverable operation.' }, { status: 400 });
  } catch (error) {
    if (error instanceof DeliverableTransitionError) {
      return NextResponse.json({ error: error.message, code: 'DELIVERABLE_REJECTED' }, { status: 422 });
    }
    if (error instanceof ForesightDeliverableValidationError) {
      return NextResponse.json({ error: 'The model returned an invalid deliverable document.', code: 'INVALID_DELIVERABLE', issues: error.issues }, { status: 422 });
    }
    throw error;
  }
}