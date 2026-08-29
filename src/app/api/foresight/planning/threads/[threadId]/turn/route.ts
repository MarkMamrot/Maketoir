import { NextResponse } from 'next/server';
import { createGeminiPlannerModelGateway } from '@/lib/foresight/assistant/PlannerModelGateway';
import { ForesightPlannerDialogueService } from '@/lib/foresight/assistant/ForesightPlannerDialogueService';
import { PlanningThreadConflictError } from '@/lib/foresight/repositories/ForesightPlanningRepository';
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
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return NextResponse.json({ error: 'expectedRevision must be a positive integer.' }, { status: 400 });
  }
  if (!content || content.length > 8_000) {
    return NextResponse.json({ error: 'content must be between 1 and 8000 characters.' }, { status: 400 });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Planner AI is not configured.' }, { status: 503 });
  const modelId = process.env.FORESIGHT_PLANNER_MODEL?.trim() || 'gemini-2.5-flash';
  try {
    const turn = await ForesightPlannerDialogueService.runTurn({
      businessId: user.businessId,
      threadId,
      expectedRevision,
      actorUserId: user.userId,
      content,
      modelId,
      model: createGeminiPlannerModelGateway(apiKey, { businessId: user.businessId, area: 'foresight', operation: 'planning_turn', actorType: 'user', actorUserId: user.userId, referenceType: 'planning_thread', referenceId: threadId }),
    });
    return NextResponse.json({ success: true, turn });
  } catch (error) {
    if (error instanceof PlanningThreadConflictError) {
      return NextResponse.json({ error: error.message, code: 'THREAD_CONFLICT' }, { status: 409 });
    }
    throw error;
  }
}