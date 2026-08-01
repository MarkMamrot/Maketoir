import { NextResponse } from 'next/server';
import { ForesightPlanningRepository } from '@/lib/foresight/repositories/ForesightPlanningRepository';
import { requireAdminSession } from '@/lib/sessionUtils';

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const threadId = Number(context.params.threadId);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ error: 'threadId must be a positive integer.' }, { status: 400 });
  }
  const thread = await ForesightPlanningRepository.getThread(user.businessId, threadId);
  if (!thread) return NextResponse.json({ error: 'Planning thread not found.' }, { status: 404 });
  const [messages, latestPlan] = await Promise.all([
    ForesightPlanningRepository.listMessages(user.businessId, threadId, 200),
    ForesightPlanningRepository.latestPlanVersion(user.businessId, threadId),
  ]);
  return NextResponse.json({ success: true, thread, messages, latestPlan });
}